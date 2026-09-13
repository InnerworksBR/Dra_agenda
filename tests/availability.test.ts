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
    const now = new Date('2026-09-15T10:00:00Z');
    // 10:00–11:15 SP = 13:00–14:15 UTC
    const busy = [
      { start: new Date('2026-09-15T13:00:00Z'), end: new Date('2026-09-15T14:15:00Z') },
    ];
    const result = await computeAvailability({ now, busy });
    const tue = result.windowDays.find((d) => d.date === '2026-09-15');
    expect(tue).toBeDefined();
    // Slots ocupados entre 10:00 e 11:00 SP NÃO devem aparecer
    expect(tue!.slots).not.toContain('10:00');
    expect(tue!.slots).not.toContain('10:15');
    expect(tue!.slots).not.toContain('10:30');
    expect(tue!.slots).not.toContain('10:45');
    expect(tue!.slots).not.toContain('11:00');
    // Slots antes do evento E depois devem aparecer
    expect(tue!.slots).toContain('08:00');
    expect(tue!.slots).toContain('09:45');
    expect(tue!.slots).toContain('11:15');
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
