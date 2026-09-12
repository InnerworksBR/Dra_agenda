import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api/response';
import { prisma } from '@/lib/db/prisma';
import { env } from '@/lib/env';
import { normalizeEvolutionPhone } from '@/lib/time/sao-paulo';
import { recordAudit } from '@/lib/audit/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  from: z.string().min(8),
  body: z.string().min(1).max(2000),
  evolutionMessageId: z.string().max(200).optional(),
  timestamp: z.coerce.number().int().optional(),
  instance: z.string().max(120).optional(),
});

/**
 * Recebe webhook da Evolution API (via n8n) com a mensagem que o paciente
 * acabou de mandar no WhatsApp. Identifica se existe um AppointmentConfirmation
 * pendente para esse telefone e devolve ao n8n qual consulta ele está
 * respondendo.
 *
 * Auth: header `apikey: ${EVOLUTION_INBOUND_SECRET}`. Não usa N8N_API_SECRET
 * porque esta chave pode ser exposta no painel da Evolution se você adicionar
 * outra fonte.
 */
export async function POST(req: Request): Promise<Response> {
  const apikey = req.headers.get('apikey') ?? '';
  if (!env.EVOLUTION_INBOUND_SECRET || apikey !== env.EVOLUTION_INBOUND_SECRET) {
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
    return apiError(400, 'INVALID_BODY', 'Dados inválidos', {
      issues: parsed.error.flatten().fieldErrors,
    });
  }

  const phone = normalizeEvolutionPhone(parsed.data.from);

  // Procura confirmações pendentes (sem respondedAt) para esse telefone,
  // ordenadas pela consulta mais próxima. Limita a 1 para evitar ambiguidade
  // no caso comum; se houver mais, devolve todas e o n8n decide.
  const pending = await prisma.appointmentConfirmation.findMany({
    where: {
      respondedAt: null,
      appointment: {
        status: 'CONFIRMED',
        patient: { phoneE164: phone },
      },
    },
    orderBy: { appointment: { startsAt: 'asc' } },
    take: 5,
    include: {
      appointment: {
        select: { id: true, startsAt: true, status: true, patientId: true },
      },
    },
  });

  if (pending.length === 0) {
    return apiOk({ handled: 'passthrough' as const });
  }

  const first = pending[0];
  await recordAudit(prisma, {
    eventType: 'reminder.orphan_response',
    patientId: first.appointment.patientId,
    metadata: {
      phone,
      candidates: pending.length,
      picked: first.appointmentId,
      ambiguous: pending.length > 1,
    },
  });

  return apiOk({
    handled: 'reminder_response' as const,
    ambiguous: pending.length > 1,
    appointment_id: first.appointmentId,
    confirmation_id: first.id,
    appointment_ids: pending.map((p) => ({
      appointment_id: p.appointmentId,
      confirmation_id: p.id,
      starts_at: p.appointment.startsAt.toISOString(),
    })),
  });
}
