import { NextResponse } from 'next/server';
import { authorizeN8n } from '@/lib/magic-links/service';
import { apiError, apiOk } from '@/lib/api/response';
import { runCalendarSync } from '@/lib/calendar/sync-from-google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chamado pelo Schedule Trigger do n8n a cada 5 minutos. Espelha eventos
 * CONFIRMED do Google Calendar na tabela Appointment. Idempotente.
 *
 * Auth: Authorization: Bearer ${N8N_API_SECRET}.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    await authorizeN8n(req);
  } catch {
    return apiError(401, 'UNAUTHORIZED', 'Credencial inválida');
  }

  try {
    const result = await runCalendarSync(new Date());
    return apiOk(result);
  } catch (e) {
    console.error('[cron/sync-calendar] batch failed', e);
    return apiError(500, 'INTERNAL_ERROR', 'Falha ao sincronizar agenda do Google');
  }
}
