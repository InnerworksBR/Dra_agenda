// POST /api/v1/magic-links — endpoint autenticado para o n8n.
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { issueMagicLink, authorizeN8n } from '@/lib/magic-links/service';
import { apiError, apiOk } from '@/lib/api/response';
import { env } from '@/lib/env';
import { rateLimit } from '@/lib/security/rate-limit';
import { recordAudit } from '@/lib/audit/audit';
import { prisma } from '@/lib/db/prisma';
import { InvalidInputError, ServiceError, UnauthorizedError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  phone: z.string().min(8).max(20),
  patient_name: z.string().max(120).optional(),
  service_id: z.string().max(60).optional(),
  conversation_id: z.string().max(120).optional(),
  source: z.string().max(60).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  // 1. Rate limit por credencial — chave estável já que o bearer é fixo por n8n.
  const rl = rateLimit({
    key: `n8n:${req.headers.get('authorization') ?? 'anon'}`,
    perMinute: env.RATE_LIMIT_N8N_PER_MINUTE,
  });
  if (!rl.allowed) {
    await recordAudit(prisma, { eventType: 'n8n.rate_limited', metadata: { resetAt: rl.resetAt } });
    return apiError(429, 'RATE_LIMITED', 'Muitas requisições. Tente novamente em instantes.') as NextResponse;
  }

  // 2. Autenticação.
  try {
    await authorizeN8n(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      await recordAudit(prisma, { eventType: 'n8n.unauthorized' });
      return apiError(e.status, e.code, 'Não autorizado') as NextResponse;
    }
    return apiError(500, 'INTERNAL_ERROR', 'Falha interna') as NextResponse;
  }

  // 3. Parse + validação.
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

  // 4. Headers úteis.
  const idempotencyKey = req.headers.get('idempotency-key') ?? undefined;

  // 5. Emite o link.
  try {
    const result = await issueMagicLink({
      phone: parsed.data.phone,
      patientName: parsed.data.patient_name,
      serviceId: parsed.data.service_id,
      conversationId: parsed.data.conversation_id,
      source: parsed.data.source,
      idempotencyKey,
    });

    return apiOk(
      {
        patient_id: result.patientId,
        magic_link_id: result.magicLinkId,
        booking_url: result.bookingUrl,
        expires_at: result.expiresAt.toISOString(),
      },
      { status: 201 },
    ) as NextResponse;
  } catch (e) {
    if (e instanceof InvalidInputError) {
      return apiError(e.status, e.code, 'Telefone inválido') as NextResponse;
    }
    if (e instanceof ServiceError) {
      return apiError(e.status, e.code, e.message) as NextResponse;
    }
    if (e instanceof Error && e.message === 'Telefone fora do padrão E.164 esperado') {
      return apiError(400, 'INVALID_PHONE', 'Telefone inválido') as NextResponse;
    }
    console.error('magic-links error', e);
    return apiError(500, 'INTERNAL_ERROR', 'Falha ao gerar link') as NextResponse;
  }
}
