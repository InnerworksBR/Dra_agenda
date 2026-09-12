import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeN8n, issueMagicLink } from '@/lib/magic-links/service';
import { apiError, apiOk } from '@/lib/api/response';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INTENTS = ['mark', 'cancel', 'reschedule'] as const;

const bodySchema = z.object({
  phone: z.string().min(1),
  intent: z.enum(INTENTS),
  // Opcionais repassados a issueMagicLink.
  patient_name: z.string().min(2).max(120).optional(),
  service_id: z.string().max(60).optional(),
  conversation_id: z.string().max(120).optional(),
  idempotency_key: z.string().max(120).optional(),
});

const REDIRECT_BY_INTENT: Record<(typeof INTENTS)[number], string> = {
  mark: '/agendar',
  cancel: '/consultas',
  reschedule: '/consultas',
};

export async function POST(req: Request): Promise<Response> {
  try {
    await authorizeN8n(req);
  } catch {
    return apiError(401, 'UNAUTHORIZED', 'Credencial inválida');
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError(400, 'INVALID_BODY', 'JSON inválido');
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    // Log do body recebido para diagnóstico quando o n8n mandar payload
    // fora do contrato (campos faltando, intent errado, etc.).
    console.warn('[management-link] invalid body', {
      body: raw,
      issues: parsed.error.flatten().fieldErrors,
    });
    return apiError(400, 'INVALID_BODY', 'Dados inválidos', {
      issues: parsed.error.flatten().fieldErrors,
    });
  }

  const { phone, intent, patient_name, service_id, conversation_id, idempotency_key } =
    parsed.data;

  try {
    const result = await issueMagicLink({
      phone,
      patientName: patient_name,
      serviceId: service_id ?? env.DEFAULT_SERVICE_ID,
      conversationId: conversation_id,
      source: 'whatsapp',
      redirectTo: REDIRECT_BY_INTENT[intent],
      idempotencyKey: idempotency_key,
    });

    return apiOk({
      booking_url: result.bookingUrl,
      expires_at: result.expiresAt.toISOString(),
      intent,
      redirect_to: result.redirectTo,
    });
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    if (err.status && err.code) {
      return apiError(err.status, err.code, err.message ?? 'Erro');
    }
    console.error('management-link error', e);
    return apiError(500, 'INTERNAL_ERROR', 'Falha ao gerar link de gestão');
  }
}
