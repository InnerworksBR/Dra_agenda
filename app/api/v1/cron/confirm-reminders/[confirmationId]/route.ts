import { authorizeN8n } from '@/lib/magic-links/service';
import { apiError, apiOk } from '@/lib/api/response';
import { prisma } from '@/lib/db/prisma';
import { formatPtBrDate, formatPtBrTime } from '@/lib/time/sao-paulo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Revalida um lembrete imediatamente antes do n8n enviá-lo ao paciente.
 * Impede o envio de dados antigos se a consulta foi cancelada ou respondida
 * depois da criação do lote das 20h.
 */
export async function GET(
  req: Request,
  { params }: { params: { confirmationId: string } },
): Promise<Response> {
  try {
    await authorizeN8n(req);
  } catch {
    return apiError(401, 'UNAUTHORIZED', 'Credencial inválida');
  }

  const confirmation = await prisma.appointmentConfirmation.findUnique({
    where: { id: params.confirmationId },
    include: {
      appointment: {
        include: {
          patient: { select: { phoneE164: true, name: true } },
        },
      },
    },
  });

  if (!confirmation) {
    return apiOk({ send: false, reason: 'CONFIRMATION_NOT_FOUND' });
  }

  const { appointment } = confirmation;
  if (appointment.status !== 'CONFIRMED') {
    return apiOk({ send: false, reason: 'APPOINTMENT_NOT_CONFIRMED' });
  }
  if (confirmation.respondedAt) {
    return apiOk({ send: false, reason: 'ALREADY_RESPONDED' });
  }
  if (appointment.startsAt <= new Date()) {
    return apiOk({ send: false, reason: 'APPOINTMENT_ALREADY_STARTED' });
  }

  return apiOk({
    send: true,
    confirmation_id: confirmation.id,
    appointment_id: appointment.id,
    patient_phone: appointment.patient.phoneE164,
    patient_name: appointment.patient.name ?? '',
    data: formatPtBrDate(appointment.startsAt),
    hora: formatPtBrTime(appointment.startsAt),
  });
}
