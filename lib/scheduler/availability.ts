// Cálculo de slots disponíveis a partir dos eventos reais do Google Calendar.
// Fonte da verdade: a agenda da Dra. Priscila. O que está no Google é o que vale.
//
// Algoritmo por dia:
//   1. Janela absoluta do dia: [dayStart, dayEnd] no fuso da clínica
//      (definida em `rules.dayWindow`).
//   2. Pega todos os eventos confirmados que cruzam esse dia. Eventos com
//      `transparency === 'transparent'` (Mostrar como: Disponível) são
//      ignorados — equivalente ao que `freebusy.query` já faz.
//   3. Faz merge de sobreposições e ordena por horário.
//   4. Calcula os "buracos" entre eventos (incluindo antes do primeiro e
//      depois do último). Buracos < `slotMinutes` são descartados.
//   5. Gera slots de `slotMinutes` em `slotMinutes` dentro de cada buraco,
//      fazendo snap do início do buraco para o próximo múltiplo de
//      `slotMinutes`.
//   6. Filtra slots no passado.
//   7. Devolve apenas dias que tenham ao menos um slot.
//
// Regra UX "primeiro dia ≥ D+2 dias úteis" continua valendo: chamamos
// `nextBusinessDay` duas vezes para pular hoje e o próximo dia útil.
// "Dia útil" aqui significa "dia que tem ao menos um evento com horário
// definido" — sem eventos o dia some da janela, refletindo o caso real
// (Dra. não atende e a agenda está vazia).

import { addDays, addMinutes, isAfter, isBefore, startOfDay } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { BusyInterval } from '@/lib/calendar/provider';
import { getSchedulingRules, type SchedulingRules } from '@/lib/scheduler/rules';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type EventInterval = {
  start: Date;
  end: Date;
  // Marcado como "Mostrar como: Disponível" no Google. Quando true, é
  // ignorado pelo cálculo (igual ao que o freebusy faz).
  transparent?: boolean;
};

export type DayAvailability = {
  date: string; // yyyy-MM-dd no timezone da clínica
  slots: string[]; // horários HH:mm livres, ordenados
};

export type AvailabilityResult = {
  timezone: string;
  rules: SchedulingRules;
  windowDays: DayAvailability[];
};

function dateKeyOf(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, 'yyyy-MM-dd');
}

function weekdayKeyOf(date: Date, tz: string): WeekdayKey {
  const idx = Number(formatInTimeZone(date, tz, 'i')) % 7; // 1=Mon..7=Sun; queremos 0..6 dom=0
  const map: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return map[idx - 1 < 0 ? 6 : idx - 1]!;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToHhmm(m: number): string {
  const total = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Faz merge de intervalos sobrepostos/adjacentes e devolve ordenado por start.
 * Entrada e saída usam o tipo BusyInterval (start/end em Date).
 */
function mergeIntervals(intervals: BusyInterval[]): BusyInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: BusyInterval[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start.getTime() <= last.end.getTime()) {
      // Sobrepõe ou encosta. Estende o final se preciso.
      if (cur.end.getTime() > last.end.getTime()) last.end = cur.end;
    } else {
      out.push(cur);
    }
  }
  return out;
}

/**
 * Calcula os buracos livres entre eventos dentro de [dayStart, dayEnd].
 * Retorna a lista de gaps com tamanho >= minGapMs (descartando buracos
 * menores que isso, que não cabem nem um slot).
 */
function freeGaps(
  dayStart: Date,
  dayEnd: Date,
  busy: BusyInterval[],
  minGapMs: number,
): Array<{ start: Date; end: Date }> {
  const gaps: Array<{ start: Date; end: Date }> = [];
  let cursor = dayStart;
  for (const b of busy) {
    // Corta o busy pra janela do dia.
    const bStart = b.start < dayStart ? dayStart : b.start;
    const bEnd = b.end > dayEnd ? dayEnd : b.end;
    if (bStart >= bEnd) continue;
    if (bStart.getTime() - cursor.getTime() >= minGapMs) {
      gaps.push({ start: cursor, end: bStart });
    }
    if (bEnd.getTime() > cursor.getTime()) cursor = bEnd;
  }
  if (dayEnd.getTime() - cursor.getTime() >= minGapMs) {
    gaps.push({ start: cursor, end: dayEnd });
  }
  return gaps;
}

/**
 * Avança `from` em N dias corridos. Usado para implementar a regra UX
 * "primeiro dia mostrado ≥ D+2 dias corridos". Não confunde com
 * "dia útil" — é sempre dia do calendário.
 */
function addBusinessDays(from: Date, days: number): Date {
  return addDays(from, days);
}

export async function computeAvailability(opts: {
  now: Date;
  events: EventInterval[];
  rules?: SchedulingRules;
  tz?: string;
}): Promise<AvailabilityResult> {
  const tz = opts.tz ?? process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/Sao_Paulo';
  const rules = opts.rules ?? getSchedulingRules();
  const now = opts.now;

  // Janela absoluta do dia no fuso da clínica (HH:mm -> minutos -> Date do dia).
  const startToday = startOfDay(toZonedTime(now, tz));
  const dayStartMinutes = hhmmToMinutes(rules.dayWindow.start);
  const dayEndMinutes = hhmmToMinutes(rules.dayWindow.end);

  // Pré-organiza eventos por dia (chave local). Eventos transparentes são
  // descartados aqui — equivalente ao filtro que `freebusy.query` aplica.
  const eventsByDay = new Map<string, BusyInterval[]>();
  for (const e of opts.events) {
    if (e.transparent) continue;
    const key = dateKeyOf(e.start, tz);
    const list = eventsByDay.get(key) ?? [];
    list.push({ start: e.start, end: e.end });
    eventsByDay.set(key, list);
  }

  // Regra UX: paciente só vê dias a partir de D+2 dias corridos.
  // Ex.: now = quarta 07:00 SP -> primeiro dia mostrado = sexta 09.
  const searchEnd = addDays(startToday, rules.maxSearchDays);
  const startFrom = addBusinessDays(startToday, 2);

  const slotMinutes = rules.slotMinutes;
  const minGapMs = slotMinutes * 60 * 1000;

  const days: DayAvailability[] = [];
  let cursor = startFrom;
  let safety = 0;
  while (days.length < rules.windowDays && cursor < searchEnd) {
    if (++safety > rules.maxSearchDays + 2) break; // paranoia
    const dayKey = dateKeyOf(cursor, tz);

    // Limites absolutos do dia, no fuso local, em Date UTC.
    const dayStart = fromZonedTime(`${dayKey}T${minutesToHhmm(dayStartMinutes)}:00`, tz);
    const dayEnd = fromZonedTime(`${dayKey}T${minutesToHhmm(dayEndMinutes)}:00`, tz);

    // Filtra eventos do dia que cruzam [dayStart, dayEnd].
    const dayEvents = (eventsByDay.get(dayKey) ?? [])
      .filter((b) => b.end > dayStart && b.start < dayEnd)
      .map((b) => ({
        start: b.start < dayStart ? dayStart : b.start,
        end: b.end > dayEnd ? dayEnd : b.end,
      }));
    const busy = mergeIntervals(dayEvents);
    const gaps = freeGaps(dayStart, dayEnd, busy, minGapMs);

    const slots: string[] = [];
    for (const gap of gaps) {
      const gapStartMs = gap.start.getTime();
      const slotMs = slotMinutes * 60 * 1000;
      const firstSlotMs = Math.ceil(gapStartMs / slotMs) * slotMs;
      for (let t = firstSlotMs; t + slotMs <= gap.end.getTime(); t += slotMs) {
        const slotStart = new Date(t);
        if (!isAfter(slotStart, now)) continue;
        const slotEnd = addMinutes(slotStart, slotMinutes);
        const collided = busy.some((b) => isBefore(slotStart, b.end) && isBefore(b.start, slotEnd));
        if (collided) continue;
        slots.push(formatInTimeZone(slotStart, tz, 'HH:mm'));
      }
    }

    if (slots.length > 0) {
      days.push({ date: dayKey, slots });
    }
    cursor = addDays(cursor, 1);
  }

  return { timezone: tz, rules, windowDays: days };
}

/**
 * Resolve um slot_id (formato `slot_YYYY-MM-DDTHH:mm`) para datas absolutas
 * no timezone configurado. Lança erro se o formato for inválido.
 */
export function resolveSlotId(
  slotId: string,
  tz: string,
): { startsAt: Date; endsAt: Date; dayKey: string; hhmm: string } {
  const match = /^slot_(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(slotId);
  if (!match) throw new Error('INVALID_SLOT_ID');
  const [, dayKey, hhmm] = match;
  const local = `${dayKey}T${hhmm}:00`;
  const startsAt = fromZonedTime(local, tz);
  const endsAt = addMinutes(startsAt, 15);
  return { startsAt, endsAt, dayKey: dayKey!, hhmm: hhmm! };
}

export function buildSlotId(dayKey: string, hhmm: string): string {
  return `slot_${dayKey}T${hhmm}`;
}
