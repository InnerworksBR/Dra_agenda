// DELETE /api/v1/appointments/[id] — cancela um appointment do paciente.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { apiError, apiOk } from '@/lib/api/response';
import { cancelAppointment } from '@/lib/appointments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let session;
  try {
    session = await getSession();
  } catch {
    return apiError(500, 'INTERNAL_ERROR', 'Falha interna') as NextResponse;
  }
  if (!session.patientId) {
    return apiError(401, 'UNAUTHORIZED', 'Sessão ausente') as NextResponse;
  }

  if (!params.id || params.id.length < 8) {
    return apiError(400, 'INVALID_BODY', 'ID inválido') as NextResponse;
  }

  try {
    const result = await cancelAppointment({
      patientId: session.patientId,
      appointmentId: params.id,
      magicLinkId: session.magicLinkId ?? null,
    });

    return apiOk({
      appointment_id: result.appointment.id,
      status: result.appointment.status,
      calendar_warning: result.calendarFailed
        ? 'Slot liberado no app; agenda externa pode levar instantes para sincronizar.'
        : null,
    }) as NextResponse;
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    if (err.status && err.code) {
      return apiError(err.status, err.code, err.message ?? 'Erro') as NextResponse;
    }
    console.error('appointment cancel error', e);
    return apiError(500, 'INTERNAL_ERROR', 'Falha ao cancelar consulta') as NextResponse;
  }
}
