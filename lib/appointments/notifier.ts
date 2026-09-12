// Notificador de eventos de appointment para o n8n. Mantém o contrato
// do webhook de confirmação (docs/n8n-workflow-confirmacao.json) e adiciona
// o campo `type` para que o workflow ramifique por evento.
//
// Falha de rede não derruba o request — logamos e seguimos. A fonte de
// verdade do cancelamento é o banco; o WhatsApp é uma conveniência.

import { env } from '@/lib/env';
import { prisma } from '@/lib/db/prisma';
import { recordAudit } from '@/lib/audit/audit';

export type AppointmentEventType =
  | 'APPOINTMENT_CANCELLED'
  | 'APPOINTMENT_RESCHEDULED'
  | 'APPOINTMENT_CONFIRMED';

export type NotifyInput = {
  type: AppointmentEventType;
  appointmentId: string;
};

export type NotifyPayload = {
  type: AppointmentEventType;
  appointment_id: string;
  patient_id: string;
  patient_phone: string;
  patient_name: string | null;
  service_id: string;
  starts_at: string;
  ends_at: string;
  // Status atual do appointment (CONFIRMED / CANCELLED / ...). O workflow de
  // confirmação no n8n usa esse campo como guarda antes de mandar WhatsApp.
  status: string;
};

async function buildPayload(
  type: AppointmentEventType,
  appointmentId: string,
): Promise<NotifyPayload | null> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { select: { id: true, phoneE164: true, name: true } },
      service: { select: { id: true } },
    },
  });
  if (!appt) return null;

  return {
    type,
    appointment_id: appt.id,
    patient_id: appt.patient.id,
    patient_phone: appt.patient.phoneE164,
    patient_name: appt.patient.name ?? null,
    service_id: appt.service.id,
    starts_at: appt.startsAt.toISOString(),
    ends_at: appt.endsAt.toISOString(),
    status: appt.status,
  };
}

/**
 * Resolve a URL de webhook de acordo com o tipo de evento. Confirmação vai
 * para um workflow dedicado (boas-vindas WhatsApp); cancelamento e
 * remarcação vão para outro workflow. Se a variável correspondente estiver
 * vazia, o notifier apenas loga `notification_failed` e segue.
 */
function webhookUrlFor(type: AppointmentEventType): string {
  return type === 'APPOINTMENT_CONFIRMED'
    ? env.WEBHOOK_CONFIRMATION_URL
    : env.WEBHOOK_NOTIFICATIONS_URL;
}

/**
 * Dispara webhook para o n8n. Não bloqueia o request — se o webhook estiver
 * fora do ar o app segue e o evento vai pro audit log. Worker de retry
 * futuro pode ler os audit events com appointment.notification_failed.
 */
export async function notifyAppointmentEvent(input: NotifyInput): Promise<void> {
  const url = webhookUrlFor(input.type);
  const urlVarName =
    input.type === 'APPOINTMENT_CONFIRMED'
      ? 'WEBHOOK_CONFIRMATION_URL'
      : 'WEBHOOK_NOTIFICATIONS_URL';

  if (!url) {
    await recordAudit(prisma, {
      eventType: 'appointment.notification_failed',
      metadata: { reason: `${urlVarName} ausente`, type: input.type, appointmentId: input.appointmentId },
    });
    return;
  }

  const payload = await buildPayload(input.type, input.appointmentId);
  if (!payload) {
    await recordAudit(prisma, {
      eventType: 'appointment.notification_failed',
      metadata: { reason: 'appointment não encontrado', type: input.type, appointmentId: input.appointmentId },
    });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      await recordAudit(prisma, {
        eventType: 'appointment.notification_failed',
        metadata: { type: input.type, status: res.status, appointmentId: input.appointmentId },
      });
    }
  } catch (e) {
    await recordAudit(prisma, {
      eventType: 'appointment.notification_failed',
      metadata: {
        type: input.type,
        error: (e as Error).message,
        appointmentId: input.appointmentId,
      },
    });
  }
}
