import { describe, it, expect } from 'vitest';

// Importação dinâmica para garantir que env seja carregado primeiro.
process.env.MAGIC_LINK_HASH_SECRET ||= 'test-hash-secret-1234567890abcdef';
process.env.N8N_API_SECRET ||= 'test-n8n-secret-1234567890';
process.env.SESSION_SECRET ||= 'test-session-secret-1234567890abcdef-32';
process.env.DATABASE_URL ||= 'postgresql://localhost/test';
process.env.GOOGLE_CALENDAR_ID ||= 'primary';
process.env.GOOGLE_CALENDAR_CREDENTIALS ||= '{"type":"service_account"}';
process.env.APP_BASE_URL ||= 'http://localhost:3000';

const { normalizeToE164, maskPhone } = await import('@/lib/phone/normalize');

describe('normalizeToE164', () => {
  it('prefixa +55 em DDD+número de 11 dígitos', () => {
    expect(normalizeToE164('11999999999')).toBe('+5511999999999');
  });

  it('aceita formatação com parênteses e traços', () => {
    expect(normalizeToE164('(11) 99999-9999')).toBe('+5511999999999');
  });

  it('preserva DDI quando já presente', () => {
    expect(normalizeToE164('+5511999999999')).toBe('+5511999999999');
    expect(normalizeToE164('5511999999999')).toBe('+5511999999999');
  });

  it('rejeita entradas claramente inválidas', () => {
    expect(() => normalizeToE164('123')).toThrow();
    expect(() => normalizeToE164('')).toThrow();
  });

  it('mascaramento preserva DDI+DDD e esconde o meio', () => {
    expect(maskPhone('+5511999999999')).toBe('+5511****9999');
  });
});
