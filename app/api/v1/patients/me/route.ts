// API para salvar nome + plano do paciente (primeiro acesso).
// Não é exposto fora do flow autenticado — a checagem é feita via sessão.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { apiError, apiOk } from '@/lib/api/response';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  patient_id: z.string().min(1),
  name: z.string().min(2).max(120),
  health_plan: z.string().min(2).max(60),
  service_id: z.string().max(60).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session.patientId) return apiError(401, 'UNAUTHORIZED', 'Sessão ausente') as NextResponse;

  const ct = req.headers.get('content-type') ?? '';
  let payload: Record<string, string> = {};
  if (ct.includes('application/json')) {
    payload = (await req.json()) as Record<string, string>;
  } else {
    const form = await req.formData();
    payload = Object.fromEntries(form.entries()) as Record<string, string>;
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Dados inválidos') as NextResponse;
  }

  // Verificação de segurança — o paciente da sessão precisa coincidir.
  if (parsed.data.patient_id !== session.patientId) {
    return apiError(403, 'FORBIDDEN', 'Paciente divergente da sessão') as NextResponse;
  }

  await prisma.patient.update({
    where: { id: session.patientId },
    data: { name: parsed.data.name, healthPlan: parsed.data.health_plan },
  });

  if (parsed.data.service_id) {
    session.serviceId = parsed.data.service_id;
    await session.save();
  }

  // Redireciona de volta para a página de agenda (no caso de form action).
  if (!ct.includes('application/json')) {
    return NextResponse.redirect(new URL('/agendar', env.APP_BASE_URL), { status: 303 });
  }
  return apiOk({ ok: true }) as NextResponse;
}
