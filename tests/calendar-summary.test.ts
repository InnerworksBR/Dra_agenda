import { describe, it, expect } from 'vitest';

process.env.MAGIC_LINK_HASH_SECRET ||= 'test-hash-secret-1234567890abcdef';
process.env.N8N_API_SECRET ||= 'test-n8n-secret-1234567890';
process.env.SESSION_SECRET ||= 'test-session-secret-1234567890abcdef-32';
process.env.DATABASE_URL ||= 'postgresql://localhost/test';
process.env.GOOGLE_CALENDAR_ID ||= 'primary';
process.env.GOOGLE_CALENDAR_CREDENTIALS ||= '{"type":"service_account"}';
process.env.APP_BASE_URL ||= 'http://localhost:3000';

const { parseCalendarSummary } = await import('@/lib/time/sao-paulo');

describe('parseCalendarSummary', () => {
  it('extrai nome e telefone do formato "Nome 13991743380"', () => {
    const r = parseCalendarSummary('Cristian 13991743380');
    expect(r).toEqual({ name: 'Cristian', phone: '+5513991743380' });
  });

  it('aceita telefone com formatação (parênteses e traços)', () => {
    const r = parseCalendarSummary('Maria Silva (13) 99174-3380');
    expect(r).toEqual({ name: 'Maria Silva', phone: '+5513991743380' });
  });

  it('aceita prefixo com serviço + separador', () => {
    const r = parseCalendarSummary('Limpeza de Rotina — Pedro 13991743380');
    expect(r).toEqual({ name: 'Pedro', phone: '+5513991743380' });
  });

  it('aceita telefone com DDI explícito', () => {
    const r = parseCalendarSummary('João 5513991743380');
    expect(r).toEqual({ name: 'João', phone: '+5513991743380' });
  });

  it('devolve null quando não há telefone', () => {
    expect(parseCalendarSummary('Só nome, sem telefone')).toBeNull();
  });

  it('devolve null quando summary é vazio ou ausente', () => {
    expect(parseCalendarSummary('')).toBeNull();
    expect(parseCalendarSummary(null)).toBeNull();
    expect(parseCalendarSummary(undefined)).toBeNull();
  });

  it('usa "Paciente" como fallback de nome quando só tem telefone', () => {
    const r = parseCalendarSummary('13991743380');
    expect(r).toEqual({ name: 'Paciente', phone: '+5513991743380' });
  });

  it('devolve null quando o telefone é inválido (poucos dígitos)', () => {
    expect(parseCalendarSummary('Cristian 12345')).toBeNull();
  });
});
