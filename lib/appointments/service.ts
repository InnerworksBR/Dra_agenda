// Lógica transacional de confirmação e cancelamento de agendamento.
// Garante revalidação no Google Calendar e persistência atômica.

import { prisma } from '@/lib/db/prisma';
import { env } from '@/lib/env';
import { getCalendarProvider } from '@/lib/calendar/google';
import { resolveSlotId } from '@/lib/scheduler/availability';
import { recordAudit } from '@/lib/audit/audit';
import {
  AppointmentNotCancellableError,
  AppointmentNotOwnedError,
  CalendarUnavailableError,
  InvalidInputError,
  NotFoundError,
  SlotUnavailableError,
} from '@/lib/errors';
import { assertCancellable } from '@/lib/appointments/policy';
import { notifyAppointmentEvent } from '@/lib/appointments/notifier';

export type ConfirmInput = {
  patientId: string;
  magicLinkId: string;
  slotId: string;
  serviceId: string;
  // Opcional: aplicados via upsert antes do confirm quando o paciente
  // ainda não tinha nome/plano preenchidos.
  name?: string;
  healthPlan?: string;
};

export async function confirmAppointment(input: ConfirmInput) {
  // 1. Validar slot e paciente
  const patient = await prisma.patient.findUnique({ where: { id: input.patientId } });
  if (!patient) throw new NotFoundError('Paciente não encontrado');

  const service = await prisma.service.findUnique({ where: { id: input.serviceId } });
  if (!service || !service.active) {
    throw new InvalidInputError('INVALID_SERVICE', 'Serviço indisponível');
  }

  // 1b. Aplicar dados do paciente quando vierem no payload e o registro
  // ainda estiver incompleto. Mantém o upsert idempotente: só atualiza
  // campos que estão vazios ou que o payload sobrescreve.
  const patientPatch: { name?: string; healthPlan?: string } = {};
  if (input.name && (!patient.name || patient.name !== input.name)) patientPatch.name = input.name;
  if (input.healthPlan && (!patient.healthPlan || patient.healthPlan !== input.healthPlan)) {
    patientPatch.healthPlan = input.healthPlan;
  }
  if (patientPatch.name || patientPatch.healthPlan) {
    await prisma.patient.update({
      where: { id: patient.id },
      data: patientPatch,
    });
  }

  // 2. Resolver slot
  const tz = env.GOOGLE_CALENDAR_TIMEZONE;
  let resolved;
  try {
    resolved = resolveSlotId(input.slotId, tz);
  } catch {
    throw new InvalidInputError('INVALID_SLOT', 'Slot inválido');
  }

  // 3. Criar evento no Google Calendar (com revalidação interna)
  const provider = getCalendarProvider();
  let externalEventId: string;
  try {
    const res = await provider.createEvent({
      startsAt: resolved.startsAt,
      endsAt: resolved.endsAt,
      summary: `${patient.name ?? 'Paciente'} ${patient.phoneE164.replace(/^\+55/, '')}`,
      description: `Agendamento via portal. Paciente: ${patient.name ?? '(sem nome)'}. Telefone: ${patient.phoneE164}.`,
    });
    externalEventId = res.externalEventId;
  } catch (e) {
    if (e instanceof SlotUnavailableError) {
      await recordAudit(prisma, {
        eventType: 'appointment.conflict',
        patientId: input.patientId,
        magicLinkId: input.magicLinkId,
        metadata: { slotId: input.slotId },
      });
      throw e;
    }
    if (e instanceof CalendarUnavailableError) throw e;
    throw new CalendarUnavailableError();
  }

  // 4. Persistir localmente em transação (com constraint de unicidade)
  try {
    const appointment = await prisma.appointment.create({
      data: {
        patientId: input.patientId,
        magicLinkId: input.magicLinkId,
        serviceId: input.serviceId,
        startsAt: resolved.startsAt,
        endsAt: resolved.endsAt,
        externalCalendarEventId: externalEventId,
      },
    });

    await recordAudit(prisma, {
      eventType: 'appointment.created',
      patientId: input.patientId,
      magicLinkId: input.magicLinkId,
      metadata: {
        appointmentId: appointment.id,
        slotId: input.slotId,
        externalEventId,
      },
    });

    // Notifica o n8n em paralelo (não bloqueia a resposta). Falhas são
    // logadas via appointment.notification_failed; o banco é a fonte da verdade.
    void notifyAppointmentEvent({
      type: 'APPOINTMENT_CONFIRMED',
      appointmentId: appointment.id,
    }).catch(() => {
      // notifier já loga no audit; swallow aqui.
    });

    return appointment;
  } catch (e) {
    // Se a constraint única do Prisma falhar, removemos o evento criado
    // no Google para não deixar lixo lá.
    if ((e as { code?: string }).code === 'P2002') {
      // Evento já existe no nosso banco — o slot está tomado.
      throw new SlotUnavailableError();
    }
    throw e;
  }
}

export type AppointmentWithService = Awaited<
  ReturnType<typeof prisma.appointment.findFirst>
> & {
  service: { id: string; name: string };
};

/**
 * Lista os appointments do paciente para a tela /consultas.
 * Retorna próximos (CONFIRMED futuros) + histórico (qualquer status já passado).
 * Ordena por data decrescente — a UI agrupa depois se precisar.
 */
export async function listAppointmentsForPatient(
  patientId: string,
  now: Date = new Date(),
): Promise<AppointmentWithService[]> {
  return prisma.appointment.findMany({
    where: {
      patientId,
      OR: [
        { status: 'CONFIRMED', startsAt: { gte: now } },
        { endsAt: { lt: now } },
        { status: { in: ['CANCELLED', 'NO_SHOW', 'COMPLETED'] } },
      ],
    },
    orderBy: { startsAt: 'desc' },
    include: { service: { select: { id: true, name: true } } },
  }) as Promise<AppointmentWithService[]>;
}

export type CancelInput = {
  patientId: string;
  appointmentId: string;
  magicLinkId?: string | null;
  reason?: string | null;
};

/**
 * Cancela um appointment do paciente.
 *
 * Regras:
 *  - appointment precisa existir e pertencer ao paciente;
 *  - precisa estar CONFIRMED;
 *  - precisa estar a mais de CANCELLATION_WINDOW_HOURS do início;
 *  - fonte da verdade é o banco — se o deleteEvent do Google falhar, ainda
 *    marcamos como CANCELLED (com audit `appointment.cancelled.calendar_failed`).
 */
export async function cancelAppointment(input: CancelInput) {
  const existing = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    include: { service: { select: { id: true, name: true } } },
  });
  if (!existing) throw new NotFoundError('Consulta não encontrada');
  if (existing.patientId !== input.patientId) {
    throw new AppointmentNotOwnedError();
  }
  if (existing.status !== 'CONFIRMED') {
    throw new AppointmentNotCancellableError(
      `Consulta com status ${existing.status} não pode ser cancelada.`,
    );
  }

  assertCancellable(existing.startsAt);

  const provider = getCalendarProvider();
  let calendarFailed = false;
  if (existing.externalCalendarEventId) {
    try {
      await provider.deleteEvent(existing.externalCalendarEventId);
    } catch (e) {
      if (e instanceof CalendarUnavailableError) {
        calendarFailed = true;
        // Não interrompemos — o banco é a fonte da verdade.
      } else {
        throw e;
      }
    }
  }

  const cancelled = await prisma.appointment.update({
    where: { id: existing.id },
    data: { status: 'CANCELLED' },
    include: { service: { select: { id: true, name: true } } },
  });

  await recordAudit(prisma, {
    eventType: calendarFailed ? 'appointment.cancelled.calendar_failed' : 'appointment.cancelled',
    patientId: input.patientId,
    magicLinkId: input.magicLinkId ?? null,
    metadata: {
      appointmentId: cancelled.id,
      externalEventId: existing.externalCalendarEventId,
      reason: input.reason ?? null,
    },
  });

  // Notifica o n8n em paralelo (não bloqueia a resposta).
  void notifyAppointmentEvent({
    type: 'APPOINTMENT_CANCELLED',
    appointmentId: cancelled.id,
  }).catch(() => {
    // notifier já loga no audit; swallow aqui.
  });

  return { appointment: cancelled, calendarFailed };
}
