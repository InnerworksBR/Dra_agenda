// Configuração da janela absoluta de atendimento por dia e parâmetros de
// geração de slots. A disponibilidade real vem dos eventos do Google Calendar
// (lib/calendar/google.ts -> listEvents); as regras aqui só definem:
//   - limites mínimo e máximo do dia em horário local da clínica;
//   - granularidade do slot (15 min);
//   - quantos dias com agenda mostrar (windowDays);
//   - até onde buscar (maxSearchDays).
//
// Sobrescrita opcional via SCHEDULING_RULES_JSON no ambiente.

export type DailyRange = { start: string; end: string }; // HH:mm

export type SchedulingRules = {
  // Janela absoluta do dia que limita onde os slots podem aparecer.
  // Slots nunca são oferecidos antes de `start` nem depois de `end` (em
  // horário local da clínica). Tudo entre eventos que estiver fora desse
  // intervalo é descartado.
  dayWindow: DailyRange;
  // Granularidade do slot em minutos.
  slotMinutes: number;
  // Quantos dias com disponibilidade devem ser entregues. Padrão: 7.
  windowDays: number;
  // Quantos dias futuros no máximo serão inspecionados ao buscar a janela.
  // Necessário porque podemos pular dias cheios.
  maxSearchDays: number;
};

export const DEFAULT_RULES: SchedulingRules = {
  dayWindow: { start: '06:00', end: '23:00' },
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
    cached = { ...DEFAULT_RULES, ...parsed };
    return cached;
  } catch {
    // Fallback silencioso para o default — loga para o operador.
    console.warn('SCHEDULING_RULES_JSON inválido; usando regras padrão.');
    cached = DEFAULT_RULES;
    return cached;
  }
}
