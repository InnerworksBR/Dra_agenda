// Normalização de telefone para E.164 (Brasil como caso principal).
// Implementação enxuta sem dependências externas; cobre os formatos mais comuns.

const ONLY_DIGITS = /\D+/g;

export class InvalidPhoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPhoneError';
  }
}

/**
 * Normaliza um telefone brasileiro para E.164 (+55...).
 * Aceita formatos como:
 *  - 11999999999
 *  - 5511999999999
 *  - +5511999999999
 *  - (11) 99999-9999
 *
 * Regras:
 *  - Remove tudo que não é dígito.
 *  - Se começar com 55, assume DDI já presente.
 *  - Caso contrário, prefixa +55.
 *  - 10 ou 11 dígitos (DDD + número) sem DDI são prefixados com +55.
 *  - 12 ou 13 dígitos (55 + DDD + número) recebem apenas o "+" inicial.
 *  - Qualquer outro tamanho é considerado inválido.
 */
export function normalizeToE164(raw: string): string {
  if (typeof raw !== 'string') {
    throw new InvalidPhoneError('Telefone deve ser uma string');
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    throw new InvalidPhoneError('Telefone vazio');
  }

  const digits = trimmed.replace(ONLY_DIGITS, '');

  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }

  throw new InvalidPhoneError('Telefone fora do padrão E.164 esperado');
}

/** Mascaramento para logs — preserva DDI e DDD, esconde o resto. */
export function maskPhone(e164: string): string {
  if (!e164.startsWith('+')) return '***';
  if (e164.length < 6) return '***';
  // ex.: +55119****9999
  return `${e164.slice(0, 5)}****${e164.slice(-4)}`;
}
