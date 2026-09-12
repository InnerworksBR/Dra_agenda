// Regras de geração de janelas de atendimento (horários disponíveis).
// Mantido em código para o MVP, mas as configurações podem ser sobrescritas
// via SCHEDULING_RULES_JSON no ambiente.

export type DailyRange = { start: string; end: string }; // HH:mm

export type SchedulingRules = {
  // Por dia da semana: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
  weekdays: Partial<Record<
    'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
    DailyRange[]
  >>;
  slotMinutes: number;
  // Quantos dias com disponibilidade devem ser entregues. Padrão do PRD: 7.
  windowDays: number;
  // Quantos dias futuros no máximo serão inspecionados ao buscar janela.
  // Necessário porque podemos pular dias cheios.
  maxSearchDays: number;
};

export const DEFAULT_RULES: SchedulingRules = {
  weekdays: {
    mon: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
    tue: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
    wed: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
    thu: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
    fri: [{ start: '08:00', end: '12:00' }],
  },
  slotMinutes: 15,
  windowDays: 7,
  maxSearchDays: 21,
};

let cached: SchedulingRules | null = null;

export function getSchedulingRules(): SchedulingRules {
  if (cached) return cached;
  const raw = process.env.SCHEDULING_RULES_JSON?.trim();
  if (!raw) {
    cached = DEFAULT_RULES;
    return cached;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SchedulingRules>;
    cached = {
      ...DEFAULT_RULES,
      ...parsed,
      weekdays: { ...DEFAULT_RULES.weekdays, ...(parsed.weekdays ?? {}) },
    };
    return cached;
  } catch {
    // Fallback silencioso para o default — loga para o operador.
    console.warn('SCHEDULING_RULES_JSON inválido; usando regras padrão.');
    cached = DEFAULT_RULES;
    return cached;
  }
}
