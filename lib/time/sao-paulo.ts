// Helpers para trabalhar com timezone America/Sao_Paulo sem depender de
// bibliotecas extras. Usa Intl.DateTimeFormat nativo do Node.

const TZ = 'America/Sao_Paulo';

/**
 * Retorna a meia-noite de America/Sao_Paulo da data informada (default: agora),
 * serializada como Date em UTC. Isso garante que sentDay (DateTime armazenado
 * em UTC no Postgres) represente um dia civil em SP sem ambiguidade.
 *
 * Ex.: se agora é 2026-09-11 23:30 SP (= 2026-09-12 02:30 UTC), retorna
 * 2026-09-11T03:00:00Z (que é meia-noite 11/09 em SP, expresso em UTC).
 */
export function midnightInSaoPaulo(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value);
  const day = Number(parts.find((p) => p.type === 'day')!.value);
  // Construir a meia-noite SP como se fosse local, depois converter para o
  // instante UTC equivalente usando o offset da própria zona.
  const asIfUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offsetMs = spOffsetMs(asIfUtc);
  return new Date(asIfUtc.getTime() - offsetMs);
}

/**
 * Offset (em ms) entre America/Sao_Paulo e UTC no instante informado.
 * Positivo quando SP está à frente do UTC (verão: -02:00 = +7200000).
 * Negativo quando SP está atrás do UTC (inverno: -03:00 = -10800000).
 */
function spOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    timeZoneName: 'shortOffset',
  }).formatToParts(at);
  const name = parts.find((p) => p.type === 'timeZoneName')!.value;
  // Ex.: "GMT-3" ou "GMT-2".
  const match = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return -3 * 60 * 60 * 1000;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  return hours * 60 * 60 * 1000 + Math.sign(hours) * minutes * 60 * 1000;
}

/** Formata uma data em pt-BR no fuso America/Sao_Paulo. */
export function formatPtBr(
  date: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...options }).format(date);
}

/** Converte um telefone Evolution (ex.: 5513991743380@s.whatsapp.net) para E.164 cru. */
export function normalizeEvolutionPhone(raw: string): string {
  // Evolution manda "5513991743380@s.whatsapp.net" ou já só dígitos.
  const digits = raw.replace(/@.*$/, '').replace(/\D/g, '');
  return `+${digits}`;
}

import { normalizeToE164 } from '@/lib/phone/normalize';

export { normalizeToE164 as normalizeBrPhone } from '@/lib/phone/normalize';

/**
 * Faz o parse do summary do Google Calendar no formato "Nome 13991743380"
 * (a doutora foi treinada a escrever assim). Retorna { name, phone } ou
 * null se não conseguir extrair.
 *
 * Aceita variantes:
 *   - "Cristian 13991743380"
 *   - "Maria Silva (13) 99174-3380"
 *   - "João 55 13 991743380"
 *   - "Avaliação — Pedro 13991743380"  (pega o que vem depois do último traço)
 */
export function parseCalendarSummary(summary: string | null | undefined): {
  name: string;
  phone: string;
} | null {
  if (!summary) return null;
  // Estratégia: procurar separadores NO INÍCIO (serviço —). O resto do
  // summary é "Nome ... Telefone". O telefone é a sequência que contém
  // a maior quantidade de dígitos na string (10+).
  let rest = summary;
  const headSep = summary.search(/[—|]/);
  if (headSep >= 0 && summary.slice(0, headSep).trim().length > 0) {
    rest = summary.slice(headSep + 1);
  }
  // Encontra a posição onde termina a parte textual (nome) e começa o telefone.
  // O telefone é tudo a partir do último bloco com 8+ dígitos consecutivos.
  const digitBlock = rest.match(/(\d[\d\s().-]{6,}\d)/);
  if (!digitBlock) return null;
  const phoneRaw = digitBlock[0];
  let phone: string;
  try {
    phone = normalizeToE164(phoneRaw);
  } catch {
    return null;
  }
  const before = rest.slice(0, rest.indexOf(phoneRaw)).trim();
  const name = before.replace(/[\s—\-|/()]+$/, '').trim() || 'Paciente';
  return { name, phone };
}
