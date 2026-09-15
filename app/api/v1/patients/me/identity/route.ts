// PATCH /api/v1/patients/me/identity
// Atualiza campos de identidade (nome e/ou plano) do paciente autenticado.
// Usado pelo cliente para salvar o nome assim que o input perde o foco,
// sem esperar a confirmação do agendamento.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { apiError, apiOk } from '@/lib/api/response';
import { prisma } from '@/lib/db/prisma';
import { healthPlanSchema } from '@/lib/patients/health-plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pelo menos um dos dois campos deve estar presente.
const schema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    health_plan: healthPlanSchema.optional(),
  })
  .refine((d) => d.name !== undefined || d.health_plan !== undefined, {
    message: 'Informe pelo menos name ou health_plan',
  });

export async function PATCH(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await getSession();
  } catch {
    return apiError(500, 'INTERNAL_ERROR', 'Falha interna') as NextResponse;
  }
  if (!session.patientId) {
    return apiError(401, 'UNAUTHORIZED', 'Sessão ausente') as NextResponse;
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return apiError(400, 'INVALID_BODY', 'JSON inválido') as NextResponse;
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Dados inválidos') as NextResponse;
  }

  // Atualiza só os campos enviados — operação idempotente.
  const data: { name?: string; healthPlan?: string } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.health_plan !== undefined) data.healthPlan = parsed.data.health_plan;

  try {
    await prisma.patient.update({
      where: { id: session.patientId },
      data,
    });
  } catch (e) {
    console.error('patient identity update error', e);
    return apiError(500, 'INTERNAL_ERROR', 'Falha ao atualizar') as NextResponse;
  }

  return apiOk({ ok: true }) as NextResponse;
}
