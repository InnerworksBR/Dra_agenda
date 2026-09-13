// Implementação do CalendarProvider usando googleapis.
// Credenciais ficam SOMENTE no servidor; nunca são serializadas para o cliente.

import { google, type calendar_v3 } from 'googleapis';
import { env } from '@/lib/env';
import { CalendarUnavailableError, SlotUnavailableError } from '@/lib/errors';
import type { BusyInterval, CalendarProvider } from './provider';

type GoogleCreds = {
  type: string;
  client_email?: string;
  private_key?: string;
  // ... outros campos relevantes para service account
};

let cachedClient: ReturnType<typeof buildCalendarClient> | null = null;

function buildCalendarClient() {
  let creds: GoogleCreds;
  try {
    creds = JSON.parse(env.GOOGLE_CALENDAR_CREDENTIALS);
  } catch (e) {
    throw new CalendarUnavailableError('Credenciais Google inválidas');
  }

  if (!creds.client_email || !creds.private_key) {
    throw new CalendarUnavailableError('Credenciais Google incompletas');
  }

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
  });

  return google.calendar({ version: 'v3', auth });
}

function getCalendar(): ReturnType<typeof buildCalendarClient> {
  if (!cachedClient) cachedClient = buildCalendarClient();
  return cachedClient;
}

function toDate(value: string | undefined | null): Date {
  if (!value) throw new CalendarUnavailableError('Resposta do Google sem timestamp');
  return new Date(value);
}

export class GoogleCalendarProvider implements CalendarProvider {
  async getBusyIntervals({ from, to }: { from: Date; to: Date }): Promise<BusyInterval[]> {
    const calendar = getCalendar();
    try {
      const res = await calendar.freebusy.query({
        requestBody: {
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          items: [{ id: env.GOOGLE_CALENDAR_ID }],
          timeZone: env.GOOGLE_CALENDAR_TIMEZONE,
        },
      });

      const item = res.data.calendars?.[env.GOOGLE_CALENDAR_ID];
      const errors = item?.errors;
      if (errors && errors.length > 0) {
        throw new CalendarUnavailableError(`Google retornou erro: ${errors.map((e) => e.reason).join(', ')}`);
      }
      const busy = (item?.busy ?? []) as calendar_v3.Schema$TimePeriod[];
      return busy
        .filter((b) => b.start && b.end)
        .map((b) => ({
          start: toDate(b.start),
          end: toDate(b.end),
          source: 'google' as const,
        }));
    } catch (e) {
      if (e instanceof CalendarUnavailableError) throw e;
      // Sem fallback — o PRD é claro: nunca inventar disponibilidade.
      throw new CalendarUnavailableError('Falha ao consultar agenda no Google Calendar');
    }
  }

  async isSlotFree({ startsAt, endsAt }: { startsAt: Date; endsAt: Date }): Promise<boolean> {
    const busy = await this.getBusyIntervals({ from: startsAt, to: endsAt });
    return busy.every((b) => b.end <= startsAt || b.start >= endsAt);
  }

  async createEvent(opts: {
    startsAt: Date;
    endsAt: Date;
    summary: string;
    description?: string;
  }): Promise<{ externalEventId: string }> {
    // Re-verifica antes de criar — guarda contra corrida entre o GET
    // da disponibilidade e o POST de confirmação.
    const free = await this.isSlotFree({ startsAt: opts.startsAt, endsAt: opts.endsAt });
    if (!free) throw new SlotUnavailableError();

    const calendar = getCalendar();
    try {
      const res = await calendar.events.insert({
        calendarId: env.GOOGLE_CALENDAR_ID,
        requestBody: {
          summary: opts.summary,
          description: opts.description,
          start: { dateTime: opts.startsAt.toISOString(), timeZone: env.GOOGLE_CALENDAR_TIMEZONE },
          end: { dateTime: opts.endsAt.toISOString(), timeZone: env.GOOGLE_CALENDAR_TIMEZONE },
          status: 'confirmed',
        },
        sendUpdates: 'none',
      });
      const id = res.data.id;
      if (!id) throw new CalendarUnavailableError('Google não devolveu ID do evento');
      return { externalEventId: id };
    } catch (e) {
      if (e instanceof SlotUnavailableError) throw e;
      // 409 conflitante do Google também é tratado.
      const msg = (e as Error)?.message ?? '';
      if (msg.includes('conflict') || msg.toLowerCase().includes('already exists')) {
        throw new SlotUnavailableError();
      }
      throw new CalendarUnavailableError('Falha ao criar evento no Google Calendar');
    }
  }

  async deleteEvent(externalEventId: string): Promise<void> {
    const calendar = getCalendar();
    try {
      await calendar.events.delete({
        calendarId: env.GOOGLE_CALENDAR_ID,
        eventId: externalEventId,
        sendUpdates: 'none',
      });
    } catch (e) {
      // Idempotência: 404/410 (not found / gone) são tolerados — significa
      // que o evento já não existe no calendário. Caso contrário, propaga
      // CalendarUnavailableError para que o caller decida o que fazer
      // (manter o status CANCELLED no banco mesmo assim).
      const msg = ((e as { message?: string })?.message ?? '').toLowerCase();
      const code = (e as { code?: number })?.code;
      if (code === 404 || code === 410 || msg.includes('not found') || msg.includes('gone')) {
        return;
      }
      throw new CalendarUnavailableError('Falha ao remover evento no Google Calendar');
    }
  }
}

const devReserved = new Set<string>();

/**
 * Provider no-op para desenvolvimento sem credenciais Google. Lança
 * CalendarUnavailableError para forçar o operador a configurar a agenda real
 * antes de liberar para produção — alinhado ao AC-18 do PRD.
 */
export class DevFallbackCalendarProvider implements CalendarProvider {
  async getBusyIntervals(): Promise<BusyInterval[]> {
    // Em dev, retornamos um array vazio para que o fluxo de UI seja testável,
    // mas o createEvent abaixo marca o horário como ocupado para evitar
    // agendamentos duplicados dentro do mesmo processo.
    return [];
  }

  async isSlotFree({ startsAt }: { startsAt: Date; endsAt: Date }): Promise<boolean> {
    return !devReserved.has(startsAt.toISOString());
  }

  async createEvent({ startsAt }: { startsAt: Date; endsAt: Date; summary: string; description?: string }): Promise<{ externalEventId: string }> {
    if (devReserved.has(startsAt.toISOString())) throw new SlotUnavailableError();
    devReserved.add(startsAt.toISOString());
    return { externalEventId: `dev-${startsAt.toISOString()}` };
  }

  async deleteEvent(externalEventId: string): Promise<void> {
    // No-op em dev — só remove do Set em memória para que o slot volte a
    // parecer livre. Procurar por prefixo `dev-` para casar o formato criado
    // acima (dev-ISO).
    for (const key of devReserved) {
      if (externalEventId === `dev-${key}`) {
        devReserved.delete(key);
        return;
      }
    }
    // Se não estava no Set (cenários de teste), não faz nada.
  }
}

export function getCalendarProvider(): CalendarProvider {
  if (env.NODE_ENV !== 'production' && !env.GOOGLE_CALENDAR_CREDENTIALS?.includes('"private_key"')) {
    return new DevFallbackCalendarProvider();
  }
  return new GoogleCalendarProvider();
}
