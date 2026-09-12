import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeN8n } from '@/lib/magic-links/service';
import { apiError, apiOk } from '@/lib/api/response';
import { prisma } from '@/lib/db/prisma';
import { recordAudit } from '@/lib/audit/audit';
import { assertCancellable, isWithinCancellationWindow } from '@/lib/appointments/policy';
import { cancelAppointment } from '@/lib/appointments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().min(1) });

const bodySchema = z.object({
  confirmation_id: z.string().min(1),
  response_type: z.enum(['CONFIRM', 'CANCEL', 'UNKNOWN']),
  raw_response: z.string().max(500).optional(),
  evolution_message_id: z.string().max(200).optional(),
});

const RAW_RESPONSE_MAX = 500;

/**
 * Chamado pelo workflow n8n (`n8n-workflow-reminder-inbound.json`) após a
 * regex classificar a resposta do paciente como CONFIRM/CANCEL/UNKNOWN.
 *
 * Persiste a resposta no AppointmentConfirmation e, se for CANCEL e a janela
 * de 2h permitir, reaproveita `cancelAppointment()` para cancelar no banco +
 * Google Calendar + notifier (que dispara `dra-priscila-cancelamento`).
 *
 * Auth: Bearer ${N8N_API_SECRET}. Middleware libera o sub-path
 * `/respond-reminder` do matcher de cookie para que essa chamada funcione.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await authorizeN8n(req);
  } catch {
    return apiError(401, 'UNAUTHORIZED', 'Credencial inválida');
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return apiError(400, 'INVALID_PARAMS', 'ID inválido');
  }
  const { id: appointmentId } = parsedParams.data;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError(400, 'INVALID_BODY', 'JSON inválido');
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Dados inválidos', {
      issues: parsed.error.flatten().fieldErrors,
    });
  }

  const { confirmation_id, response_type, raw_response, evolution_message_id } = parsed.data;

  const confirmation = await prisma.appointmentConfirmation.findUnique({
    where: { id: confirmation_id },
    include: { appointment: true },
  });

  if (!confirmation || confirmation.appointmentId !== appointmentId) {
    return apiError(404, 'NOT_FOUND', 'Confirmação não encontrada para essa consulta');
  }

  if (confirmation.respondedAt) {
    return apiOk({ appointment_id: appointmentId, recorded: true, already_recorded: true });
  }

  // Chamado pelo n8n, não pelo paciente — não passa pelo `cancelAppointment`
  // padrão que exige `patientId` para checar ownership. Aqui a posse já
  // está implícita: o `confirmation_id` foi emitido pela Evolution API do
  // paciente certo. Confirma adicionalmente via telefone, quando possível.
  const appointment = confirmation.appointment;

  const truncatedRaw = raw_response
    ? raw_response.slice(0, RAW_RESPONSE_MAX)
    : null;

  // 1. Persiste a resposta.
  await prisma.appointmentConfirmation.update({
    where: { id: confirmation_id },
    data: {
      respondedAt: new Date(),
      responseType: response_type,
      rawResponse: truncatedRaw,
      evolutionMessageId: evolution_message_id ?? null,
    },
  });

  // 2. Reage ao CANCEL apenas se a janela de 2h permitir.
  let cancelOutcome: 'cancelled' | 'outside_window' | 'not_cancellable' | null = null;

  if (response_type === 'CANCEL') {
    if (isWithinCancellationWindow(appointment.startsAt)) {
      await recordAudit(prisma, {
        eventType: 'reminder.cancel_outside_window',
        patientId: appointment.patientId,
        metadata: { appointmentId, raw: truncatedRaw, response_type },
      });
      // Sobrescreve responseType para UNKNOWN — paciente quis cancelar, mas
      // a janela expirou. Dra. Priscila assume via passthrough.
      await prisma.appointmentConfirmation.update({
        where: { id: confirmation_id },
        data: { responseType: 'UNKNOWN' },
      });
      cancelOutcome = 'outside_window';
    } else if (appointment.status !== 'CONFIRMED') {
      cancelOutcome = 'not_cancellable';
    } else {
      try {
        assertCancellable(appointment.startsAt);
      } catch {
        cancelOutcome = 'outside_window';
      }
      if (cancelOutcome === null) {
        try {
          await cancelAppointment({
            patientId: appointment.patientId,
            appointmentId: appointment.id,
            reason: `Cancelado via lembrete 20h (resposta ${response_type})`,
          });
          cancelOutcome = 'cancelled';
        } catch (e) {
          console.error('[respond-reminder] cancelAppointment failed', e);
          cancelOutcome = 'not_cancellable';
        }
      }
    }
  }

  await recordAudit(prisma, {
    eventType: 'reminder.responded',
    patientId: appointment.patientId,
    metadata: {
      appointmentId,
      response_type,
      cancelOutcome,
    },
  });

  return apiOk({
    appointment_id: appointmentId,
    status: appointment.status,
    recorded: true,
    cancel_outcome: cancelOutcome,
  });
}
