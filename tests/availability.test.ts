import { describe, it, expect } from 'vitest';
import { addDays } from 'date-fns';

process.env.MAGIC_LINK_HASH_SECRET ||= 'test-hash-secret-1234567890abcdef';
process.env.N8N_API_SECRET ||= 'test-n8n-secret-1234567890';
process.env.SESSION_SECRET ||= 'test-session-secret-1234567890abcdef-32';
process.env.DATABASE_URL ||= 'postgresql://localhost/test';
process.env.GOOGLE_CALENDAR_ID ||= 'primary';
process.env.GOOGLE_CALENDAR_CREDENTIALS ||= '{"type":"service_account"}';
process.env.APP_BASE_URL ||= 'http://localhost:3000';

const { computeAvailability, resolveSlotId } = await import('@/lib/scheduler/availability');
const tz = 'America/Sao_Paulo';

describe('computeAvailability', () => {
  it('retorna até 7 dias com pelo menos um slot livre, pulando dias ocupados', async () => {
    const now = new Date('2026-01-05T08:00:00Z'); // segunda
    // Dia 0 totalmente ocupado
    const d0Start = new Date('2026-01-05T08:00:00Z');
    const d0End = new Date('2026-01-05T20:00:00Z');
    const result = await computeAvailability({
      now,
      busy: [{ start: d0Start, end: d0End }],
    });

    expect(result.windowDays.length).toBeGreaterThan(0);
    expect(result.windowDays.length).toBeLessThanOrEqual(7);
    // Nenhum dia retornado deve ter 0 slots.
    for (const d of result.windowDays) {
      expect(d.slots.length).toBeGreaterThan(0);
    }
  });

  it('respeita o limite de maxSearchDays', async () => {
    const now = new Date('2026-01-05T08:00:00Z');
    // 21 dias seguidos totalmente ocupados
    const busy = Array.from({ length: 21 }).map((_, i) => ({
      start: addDays(now, i),
      end: addDays(now, i + 1),
    }));
    const result = await computeAvailability({ now, busy });
    expect(result.windowDays.length).toBe(0);
  });

  it('remove slots específicos ocupados por eventos do Google Calendar', async () => {
    // 15/09/2026 é terça. now = 07:00 SP = 10:00 UTC.
    // Com a regra D+2 úteis, terça não aparece — primeiro dia é quinta 17/09.
    const now = new Date('2026-09-15T10:00:00Z');
    // Bloqueia 10:00–11:15 SP na quinta (17/09) = 13:00–14:15 UTC
    const busy = [
      { start: new Date('2026-09-17T13:00:00Z'), end: new Date('2026-09-17T14:15:00Z') },
    ];
    const result = await computeAvailability({ now, busy });
    const thu = result.windowDays.find((d) => d.date === '2026-09-17');
    expect(thu).toBeDefined();
    // Slots ocupados entre 10:00 e 11:00 SP NÃO devem aparecer
    expect(thu!.slots).not.toContain('10:00');
    expect(thu!.slots).not.toContain('10:15');
    expect(thu!.slots).not.toContain('10:30');
    expect(thu!.slots).not.toContain('10:45');
    expect(thu!.slots).not.toContain('11:00');
    // Slots antes do evento E depois devem aparecer
    expect(thu!.slots).toContain('08:00');
    expect(thu!.slots).toContain('09:45');
    expect(thu!.slots).toContain('11:15');
  });

  describe('janela ≥ D+2 dias úteis', () => {
    // As regras padrão (mon–sex 08–12 e 14–18; sex só 08–12) vêm de
    // lib/scheduler/rules.ts (DEFAULT_RULES) e são injetadas via
    // getSchedulingRules(). Os testes assumem essas defaults.

    it('segunda-feira 10:00 SP → primeiro dia é quarta', async () => {
      // 2026-01-05 é segunda. 10:00 SP = 13:00 UTC (BRT, sem DST em janeiro).
      const now = new Date('2026-01-05T13:00:00Z');
      const result = await computeAvailability({ now, busy: [] });
      expect(result.windowDays.length).toBeGreaterThan(0);
      // D+2 úteis após segunda = quarta (pula terça).
      expect(result.windowDays[0]!.date).toBe('2026-01-07'); // quarta
    });

    it('quarta-feira 20:00 SP → primeiro dia é sexta', async () => {
      // 2026-01-07 é quarta. 20:00 SP = 23:00 UTC. Quarta já passou; pula quinta → sexta.
      const now = new Date('2026-01-07T23:00:00Z');
      const result = await computeAvailability({ now, busy: [] });
      expect(result.windowDays.length).toBeGreaterThan(0);
      expect(result.windowDays[0]!.date).toBe('2026-01-09'); // sexta
    });

    it('quinta-feira 10:00 SP → primeiro dia é segunda', async () => {
      // 2026-01-08 é quinta. D+2 úteis = segunda (pula sexta + fim de semana).
      const now = new Date('2026-01-08T13:00:00Z');
      const result = await computeAvailability({ now, busy: [] });
      expect(result.windowDays.length).toBeGreaterThan(0);
      expect(result.windowDays[0]!.date).toBe('2026-01-12'); // segunda
    });

    it('sábado 08:00 SP → primeiro dia é terça', async () => {
      // 2026-01-10 é sábado. D+2 úteis = terça (pula segunda → terça).
      const now = new Date('2026-01-10T11:00:00Z');
      const result = await computeAvailability({ now, busy: [] });
      expect(result.windowDays.length).toBeGreaterThan(0);
      expect(result.windowDays[0]!.date).toBe('2026-01-13'); // terça
    });
  });
});

describe('resolveSlotId', () => {
  it('parseia slot_id e devolve datas válidas', () => {
    const r = resolveSlotId('slot_2026-01-05T09:00', tz);
    expect(r.hhmm).toBe('09:00');
    expect(r.dayKey).toBe('2026-01-05');
    expect(r.endsAt.getTime() - r.startsAt.getTime()).toBe(15 * 60 * 1000);
  });

  it('rejeita formato inválido', () => {
    expect(() => resolveSlotId('qualquer-coisa', tz)).toThrow();
  });
});
