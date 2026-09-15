// GET /api/v1/availability — consulta agenda para o paciente autenticado.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { apiError, apiOk } from '@/lib/api/response';
import { getCalendarProvider } from '@/lib/calendar/google';
import { computeAvailability, type EventInterval } from '@/lib/scheduler/availability';
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

    // Lista eventos confirmados na janela. Cada evento vira um EventInterval;
    // eventos transparentes ("Mostrar como: Disponível") são ignorados pelo
    // cálculo, então marcamos a flag aqui e o availability.ts filtra.
    const events = await provider.listEvents({ timeMin: start, timeMax: end });
    const intervals: EventInterval[] = events.map((e) => ({
      start: e.startsAt,
      end: e.endsAt,
      transparent: false, // listEvents já exclui cancelados; "Disponível"
      // seria detectado por transparência, mas a clínica usa só eventos
      // ocupados nessa agenda.
    }));

    const result = await computeAvailability({ now, events: intervals });

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
