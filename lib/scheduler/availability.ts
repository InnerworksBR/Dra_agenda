// Cálculo de slots disponíveis com base em regras + intervalos ocupados.
// Recebe uma lista de busy intervals (do provider) e devolve apenas slots
// realmente livres dentro do horizonte pedido.

import { addDays, addMinutes, isAfter, isBefore, startOfDay } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { BusyInterval } from '@/lib/calendar/provider';
import { getSchedulingRules, type SchedulingRules } from '@/lib/scheduler/rules';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type DayAvailability = {
  date: string; // yyyy-MM-dd no timezone da clínica
  slots: string[]; // horários HH:mm livres, ordenados
};

export type AvailabilityResult = {
  timezone: string;
  rules: SchedulingRules;
  windowDays: DayAvailability[];
};

/** Gera todos os slots teóricos (HH:mm) do dia dentro de uma faixa. */
function slotsForRange(
  start: string,
  end: string,
  slotMinutes: number,
): string[] {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const out: string[] = [];
  for (let m = startMin; m + slotMinutes <= endMin; m += slotMinutes) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    out.push(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
  return out;
}

function dateKeyOf(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, 'yyyy-MM-dd');
}

function weekdayKeyOf(date: Date, tz: string): WeekdayKey {
  const idx = Number(formatInTimeZone(date, tz, 'i')) % 7; // 1=Mon..7=Sun; queremos 0..6 dom=0
  const map: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return map[idx - 1 < 0 ? 6 : idx - 1]!;
}

function overlaps(slotStart: Date, slotEnd: Date, busy: BusyInterval): boolean {
  // Sobrepõe se slotStart < busyEnd AND busyStart < slotEnd.
  return isBefore(slotStart, busy.end) && isBefore(busy.start, slotEnd);
}

function dateFromDayKey(dayKey: string, tz: string): Date {
  // Constrói o início do dia a partir de yyyy-MM-dd no timezone.
  return fromZonedTime(`${dayKey}T00:00:00`, tz);
}

export async function computeAvailability(opts: {
  now: Date;
  busy: BusyInterval[];
  rules?: SchedulingRules;
  tz?: string;
}): Promise<AvailabilityResult> {
  const tz = opts.tz ?? process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/Sao_Paulo';
  const rules = opts.rules ?? getSchedulingRules();
  const now = opts.now;

  // Janela de busca: começa em "hoje" (no fuso) e vai até hoje + maxSearchDays.
  const startToday = startOfDay(toZonedTime(now, tz));
  const searchEnd = addDays(startToday, rules.maxSearchDays);

  // Pré-organiza busy intervals por dia (chave local) para reduzir checks.
  const busyByDay = new Map<string, BusyInterval[]>();
  for (const b of opts.busy) {
    const key = dateKeyOf(b.start, tz);
    const list = busyByDay.get(key) ?? [];
    list.push(b);
    busyByDay.set(key, list);
  }

  const days: DayAvailability[] = [];
  let cursor = startToday;
  let safety = 0;
  while (days.length < rules.windowDays && cursor < searchEnd) {
    if (++safety > rules.maxSearchDays + 2) break; // paranoia
    const dayKey = dateKeyOf(cursor, tz);
    const weekday = weekdayKeyOf(cursor, tz);
    const ranges = rules.weekdays[weekday] ?? [];

    const slots: string[] = [];
    for (const range of ranges) {
      const theoretical = slotsForRange(range.start, range.end, rules.slotMinutes);
      const busy = busyByDay.get(dayKey) ?? [];
      for (const hhmm of theoretical) {
        // Constrói o instante absoluto do slot a partir do dia+horário no
        // timezone da clínica. `fromZonedTime` interpreta a string como
        // horário local em `tz` e devolve a data em UTC correspondente.
        const slotStart = fromZonedTime(`${dayKey}T${hhmm}:00`, tz);
        const slotEnd = addMinutes(slotStart, rules.slotMinutes);
        // Não oferecer horários no passado.
        if (!isAfter(slotStart, now)) continue;
        // Sobrepõe algum busy?
        const collided = busy.some((b) => overlaps(slotStart, slotEnd, b));
        if (collided) continue;
        slots.push(hhmm);
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
