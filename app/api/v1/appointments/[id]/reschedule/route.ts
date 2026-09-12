// POST /api/v1/appointments/[id]/reschedule — cancela o atual e emite um
// novo magic link para o paciente escolher outro horário.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { apiError, apiOk } from '@/lib/api/response';
import { cancelAppointment } from '@/lib/appointments/service';
import { issueMagicLink } from '@/lib/magic-links/service';
import { prisma } from '@/lib/db/prisma';
import { recordAudit } from '@/lib/audit/audit';
import {
  AppointmentNotCancellableError,
  AppointmentNotOwnedError,
  NotFoundError,
} from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
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
    // Carrega primeiro para descobrir o magicLink de origem (conversationId)
    // antes de cancelar — assim o novo link herda o contexto.
    const existing = await prisma.appointment.findUnique({
      where: { id: params.id },
      include: { magicLink: { select: { conversationId: true, serviceId: true } } },
    });
    if (!existing) throw new NotFoundError('Consulta não encontrada');
    if (existing.patientId !== session.patientId) {
      throw new AppointmentNotOwnedError();
    }
    if (existing.status !== 'CONFIRMED') {
      throw new AppointmentNotCancellableError(
        `Consulta com status ${existing.status} não pode ser remarcada.`,
      );
    }

    // 1. Cancela o atual (mesma lógica do DELETE).
    await cancelAppointment({
      patientId: session.patientId,
      appointmentId: existing.id,
      magicLinkId: session.magicLinkId ?? null,
      reason: 'remarcacao',
    });

    // 2. Emite novo magic link reaproveitando o contexto do link original.
    const phone = (
      await prisma.patient.findUnique({
        where: { id: session.patientId },
        select: { phoneE164: true },
      })
    )?.phoneE164;
    if (!phone) {
      throw new NotFoundError('Paciente não encontrado');
    }

    const link = await issueMagicLink({
      phone,
      serviceId: existing.magicLink?.serviceId ?? existing.serviceId,
      conversationId: existing.magicLink?.conversationId ?? undefined,
      source: 'whatsapp-reschedule',
    });

    await recordAudit(prisma, {
      eventType: 'appointment.rescheduled',
      patientId: session.patientId,
      magicLinkId: link.magicLinkId,
      metadata: {
        previousAppointmentId: existing.id,
        newMagicLinkId: link.magicLinkId,
      },
    });

    return apiOk({
      booking_url: link.bookingUrl,
      expires_at: link.expiresAt.toISOString(),
    }) as NextResponse;
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    if (err.status && err.code) {
      return apiError(err.status, err.code, err.message ?? 'Erro') as NextResponse;
    }
    console.error('appointment reschedule error', e);
    return apiError(500, 'INTERNAL_ERROR', 'Falha ao remarcar consulta') as NextResponse;
  }
}
