// GET /api/v1/availability — consulta agenda para o paciente autenticado.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { apiError, apiOk } from '@/lib/api/response';
import { getCalendarProvider } from '@/lib/calendar/google';
import { computeAvailability } from '@/lib/scheduler/availability';
import { addDays } from 'date-fns';
import { env } from '@/lib/env';
import { UnauthorizedError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session.patientId) throw new UnauthorizedError('Sessão ausente');
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return apiError(401, 'UNAUTHORIZED', 'Sessão inválida') as NextResponse;
    }
    return apiError(500, 'INTERNAL_ERROR', 'Falha interna') as NextResponse;
  }

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  try {
    const provider = getCalendarProvider();
    const now = new Date();
    const start = from ? new Date(from) : now;
    const end = to ? new Date(to) : addDays(now, 21);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return apiError(400, 'INVALID_RANGE', 'Intervalo de datas inválido') as NextResponse;
    }

    const busy = await provider.getBusyIntervals({ from: start, to: end });
    const result = await computeAvailability({ now, busy });

    // Flatten para o formato consumido pela UI.
    const days = result.windowDays.map((d) => ({
      date: d.date,
      slots: d.slots,
    }));

    return apiOk({
      timezone: result.timezone,
      window_days: days,
      generated_at: new Date().toISOString(),
    }) as NextResponse;
  } catch (e) {
    if ((e as Error).message?.includes('CALENDAR')) {
      return apiError(503, 'CALENDAR_UNAVAILABLE', 'Agenda temporariamente indisponível') as NextResponse;
    }
    console.error('availability error', e);
    return apiError(500, 'INTERNAL_ERROR', 'Falha ao consultar agenda') as NextResponse;
  }
}
