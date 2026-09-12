import { NextResponse } from 'next/server';
import { authorizeN8n } from '@/lib/magic-links/service';
import { apiError, apiOk } from '@/lib/api/response';
import { runConfirmationRemindersBatch } from '@/lib/reminders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chamado pelo Schedule Trigger do n8n às 20h (America/Sao_Paulo).
 * Lista appointments nas próximas 12–24h, persiste um AppointmentConfirmation
 * por consulta (idempotente por dia via @@unique) e dispara o webhook n8n
 * de envio.
 *
 * Auth: Authorization: Bearer ${N8N_API_SECRET}. Replay-safe: o upsert por
 * (appointmentId, sentDay) torna a chamada idempotente — segunda execução no
 * mesmo dia retorna skipped > 0 sem criar registros novos.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    await authorizeN8n(req);
  } catch {
    return apiError(401, 'UNAUTHORIZED', 'Credencial inválida');
  }

  try {
    const result = await runConfirmationRemindersBatch(new Date());
    return apiOk(result);
  } catch (e) {
    console.error('[cron/confirm-reminders] batch failed', e);
    return apiError(500, 'INTERNAL_ERROR', 'Falha ao processar lote de lembretes');
  }
}
