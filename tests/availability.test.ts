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

// Helper: cria um evento no fuso America/Sao_Paulo a partir de strings HH:mm.
function evOn(dayKey: string, startHHmm: string, endHHmm: string) {
  return {
    start: new Date(`${dayKey}T${startHHmm}:00-03:00`),
    end: new Date(`${dayKey}T${endHHmm}:00-03:00`),
  };
}

describe('computeAvailability', () => {
  it('retorna até 7 dias com pelo menos um slot livre, pulando dias sem eventos', async () => {
    // now = segunda 2026-01-05 08:00 SP = 11:00 UTC (janeiro, sem DST).
    const now = new Date('2026-01-05T11:00:00Z');
    const result = await computeAvailability({
      now,
      events: [
        // Evento só na quarta 07 — pula segunda e terça.
        evOn('2026-01-07', '10:00', '11:00'),
      ],
    });
    expect(result.windowDays.length).toBeGreaterThan(0);
    expect(result.windowDays.length).toBeLessThanOrEqual(7);
    for (const d of result.windowDays) {
      expect(d.slots.length).toBeGreaterThan(0);
    }
  });

  it('respeita o limite de maxSearchDays', async () => {
    const now = new Date('2026-01-05T11:00:00Z');
    // 21 dias seguidos, cada um com 1 evento curto em horário diferente
    // pra garantir que o dia conta como "tem evento" e cair no limite de busca.
    const events = Array.from({ length: 21 }).map((_, i) =>
      evOn(
        new Date(addDays(new Date('2026-01-06T12:00:00-03:00'), i)).toISOString().slice(0, 10),
        '12:00',
        '12:15',
      ),
    );
    const result = await computeAvailability({ now, events });
    // Janela D+2 = quarta 07. De quarta até 21 dias depois.
    expect(result.windowDays.length).toBeLessThanOrEqual(7);
  });

  it('gera slots nos buracos entre eventos do dia', async () => {
    // now = quarta 2026-01-07 08:00 SP. D+2 = sexta 09.
    // Janela absoluta: 06:00–23:00. Evento 10:00–11:00 na sexta 09.
    const now = new Date('2026-01-07T11:00:00Z'); // 08:00 SP da qui 07
    const result = await computeAvailability({
      now,
      events: [evOn('2026-01-09', '10:00', '11:00')],
    });
    const fri = result.windowDays.find((d) => d.date === '2026-01-09');
    expect(fri).toBeDefined();
    // Antes do evento: 06:00..09:45.
    expect(fri!.slots).toContain('06:00');
    expect(fri!.slots).toContain('09:45');
    expect(fri!.slots).not.toContain('10:00');
    expect(fri!.slots).not.toContain('10:45');
    // Depois do evento: 11:00 até 22:45.
    expect(fri!.slots).toContain('11:00');
    expect(fri!.slots).toContain('22:45');
  });

  it('não gera slot que começa colado em evento (buraco de 15 min só permite 1 slot)', async () => {
    // Eventos justapostos 10:00–11:00 e 11:00–12:00 na sexta 09. Com D+2 a
    // partir de quarta 07, primeiro dia mostrado é sexta 09.
    const now = new Date('2026-01-07T11:00:00Z');
    const result = await computeAvailability({
      now,
      events: [
        evOn('2026-01-09', '10:00', '11:00'),
        evOn('2026-01-09', '11:00', '12:00'),
      ],
    });
    const fri = result.windowDays.find((d) => d.date === '2026-01-09');
    expect(fri).toBeDefined();
    // Buraco entre eventos tem 0 min, então 11:00 não pode aparecer.
    expect(fri!.slots).not.toContain('10:45');
    expect(fri!.slots).not.toContain('11:00');
    // Slot 12:00 aparece logo depois do segundo evento.
    expect(fri!.slots).toContain('12:00');
  });

  it('respeita transparência do evento (Mostrar como: Livre)', async () => {
    const now = new Date('2026-01-07T11:00:00Z');
    const result = await computeAvailability({
      now,
      events: [
        { ...evOn('2026-01-09', '10:00', '11:00'), transparent: true },
      ],
    });
    const fri = result.windowDays.find((d) => d.date === '2026-01-09');
    expect(fri).toBeDefined();
    // Como o evento é transparente, é ignorado — slots 10:00–10:45 aparecem.
    expect(fri!.slots).toContain('10:00');
    expect(fri!.slots).toContain('10:45');
  });

  it('descarta slots no passado', async () => {
    // now = sexta 2026-01-09 11:30 SP. Sem eventos futuros nesse dia,
    // então sexta (já passada parcialmente) some da janela D+2.
    const now = new Date('2026-01-09T14:30:00Z'); // 11:30 SP
    const result = await computeAvailability({
      now,
      events: [evOn('2026-01-09', '14:00', '15:00')], // já em andamento
    });
    // O dia 09 não deve aparecer (passou do D+2 e tem só evento atual).
    const fri = result.windowDays.find((d) => d.date === '2026-01-09');
    expect(fri).toBeUndefined();
  });

  it('faz merge de eventos sobrepostos', async () => {
    const now = new Date('2026-01-07T11:00:00Z');
    const result = await computeAvailability({
      now,
      events: [
        evOn('2026-01-09', '10:00', '11:30'),
        evOn('2026-01-09', '11:00', '12:00'),
      ],
    });
    const fri = result.windowDays.find((d) => d.date === '2026-01-09');
    expect(fri).toBeDefined();
    // Junção: 10:00–12:00 ocupado. Slots dentro não podem aparecer.
    expect(fri!.slots).not.toContain('10:45');
    expect(fri!.slots).not.toContain('11:00');
    expect(fri!.slots).not.toContain('11:45');
    // Antes (06:00–09:45) e depois (12:00+) sim.
    expect(fri!.slots).toContain('09:45');
    expect(fri!.slots).toContain('12:00');
  });

  describe('janela ≥ D+2 dias corridos', () => {
    it('segunda 08:00 SP → primeiro dia é quarta (D+2 corridos)', async () => {
      // 2026-01-05 segunda. Evento só na quarta 07.
      const now = new Date('2026-01-05T11:00:00Z');
      const result = await computeAvailability({
        now,
        events: [evOn('2026-01-07', '10:00', '11:00')],
      });
      expect(result.windowDays.length).toBeGreaterThan(0);
      expect(result.windowDays[0]!.date).toBe('2026-01-07');
    });

    it('quarta 20:00 SP → primeiro dia é sexta (D+2 corridos)', async () => {
      // 2026-01-07 quarta. Eventos só na sexta 09.
      const now = new Date('2026-01-07T23:00:00Z');
      const result = await computeAvailability({
        now,
        events: [evOn('2026-01-09', '10:00', '11:00')],
      });
      expect(result.windowDays.length).toBeGreaterThan(0);
      expect(result.windowDays[0]!.date).toBe('2026-01-09');
    });

    it('sexta 08:00 SP → primeiro dia é domingo (D+2 corridos)', async () => {
      // 2026-01-09 sexta. D+2 = domingo 11.
      const now = new Date('2026-01-09T11:00:00Z');
      const result = await computeAvailability({
        now,
        events: [evOn('2026-01-11', '10:00', '11:00')],
      });
      expect(result.windowDays.length).toBeGreaterThan(0);
      expect(result.windowDays[0]!.date).toBe('2026-01-11');
    });

    it('sábado 08:00 SP → primeiro dia é segunda (D+2 corridos)', async () => {
      // 2026-01-10 sábado. D+2 = segunda 12.
      const now = new Date('2026-01-10T11:00:00Z');
      const result = await computeAvailability({
        now,
        events: [evOn('2026-01-12', '10:00', '11:00')],
      });
      expect(result.windowDays.length).toBeGreaterThan(0);
      expect(result.windowDays[0]!.date).toBe('2026-01-12');
    });

    it('D+2 respeita o fuso SP mesmo quando o servidor está em UTC', async () => {
      // Bug conhecido: startOfDay da date-fns usa o fuso local do processo.
      // Quando o servidor roda em UTC e now é quarta 16 14:18 UTC (=
      // quarta 16 11:18 SP), sem a correção via fromZonedTime o D+2 virava
      // D+1 e oferecia quinta 17 como primeiro dia.
      const now = new Date('2026-09-16T14:18:00Z'); // qua 11:18 SP
      const result = await computeAvailability({
        now,
        events: [
          evOn('2026-09-18', '08:00', '12:00'), // sex 18 com evento
        ],
      });
      expect(result.windowDays.length).toBeGreaterThan(0);
      expect(result.windowDays[0]!.date).toBe('2026-09-18');
    });
  });

  it('respeita a janela absoluta (não oferece antes do dayWindow.start nem depois do end)', async () => {
    // now = quarta 07/01 08:00 SP. D+2 = sexta 09. dayWindow 06:00–23:00.
    const now = new Date('2026-01-07T11:00:00Z');
    const result = await computeAvailability({
      now,
      events: [evOn('2026-01-09', '10:00', '11:00')],
    });
    const fri = result.windowDays.find((d) => d.date === '2026-01-09');
    expect(fri).toBeDefined();
    expect(fri!.slots[0]).toBe('06:00');
    expect(fri!.slots.at(-1)).toBe('22:45');
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
