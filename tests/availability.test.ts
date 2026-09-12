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
