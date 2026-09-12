// GET /api/v1/appointments — lista appointments do paciente autenticado.
// POST /api/v1/appointments — confirma o agendamento do slot escolhido.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { apiError, apiOk } from '@/lib/api/response';
import {
  cancelAppointment,
  confirmAppointment,
  listAppointmentsForPatient,
} from '@/lib/appointments/service';
import { UnauthorizedError } from '@/lib/errors';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  slot_id: z.string().min(8),
  service_id: z.string().min(1),
  // Coletados inline na primeira tela do fluxo (opcional; se enviados, o
  // backend faz upsert antes de confirmar o slot).
  name: z.string().min(2).max(120).optional(),
  health_plan: z.string().min(2).max(60).optional(),
});

export async function GET(): Promise<NextResponse> {
  let session;
  try {
    session = await getSession();
  } catch {
    return apiError(500, 'INTERNAL_ERROR', 'Falha interna') as NextResponse;
  }
  if (!session.patientId) {
    return apiError(401, 'UNAUTHORIZED', 'Sessão ausente') as NextResponse;
  }

  try {
    const items = await listAppointmentsForPatient(session.patientId);
    return apiOk({
      appointments: items.map((a) => ({
        id: a.id,
        starts_at: a.startsAt.toISOString(),
        ends_at: a.endsAt.toISOString(),
        status: a.status,
        service_id: a.serviceId,
        service_name: a.service.name,
      })),
    }) as NextResponse;
  } catch (e) {
    console.error('appointments list error', e);
    return apiError(500, 'INTERNAL_ERROR', 'Falha ao listar consultas') as NextResponse;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await getSession();
  } catch {
    return apiError(500, 'INTERNAL_ERROR', 'Falha interna') as NextResponse;
  }
  if (!session.patientId || !session.magicLinkId) {
    return apiError(401, 'UNAUTHORIZED', 'Sessão ausente') as NextResponse;
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError(400, 'INVALID_BODY', 'JSON inválido') as NextResponse;
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Dados inválidos', {
      issues: parsed.error.flatten().fieldErrors,
    }) as NextResponse;
  }

  try {
    const appointment = await confirmAppointment({
      patientId: session.patientId,
      magicLinkId: session.magicLinkId,
      slotId: parsed.data.slot_id,
      serviceId: parsed.data.service_id ?? session.serviceId ?? env.DEFAULT_SERVICE_ID,
      name: parsed.data.name,
      healthPlan: parsed.data.health_plan,
    });

    return apiOk(
      {
        appointment_id: appointment.id,
        starts_at: appointment.startsAt.toISOString(),
        ends_at: appointment.endsAt.toISOString(),
        status: appointment.status,
        service_id: appointment.serviceId,
      },
      { status: 201 },
    ) as NextResponse;
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    if (err.status && err.code) {
      return apiError(err.status, err.code, err.message ?? 'Erro') as NextResponse;
    }
    console.error('appointment error', e);
    return apiError(500, 'INTERNAL_ERROR', 'Falha ao confirmar agendamento') as NextResponse;
  }
}
