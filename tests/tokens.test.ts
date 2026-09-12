import { describe, it, expect } from 'vitest';

process.env.MAGIC_LINK_HASH_SECRET ||= 'test-hash-secret-1234567890abcdef';
process.env.N8N_API_SECRET ||= 'test-n8n-secret-1234567890';
process.env.SESSION_SECRET ||= 'test-session-secret-1234567890abcdef-32';
process.env.DATABASE_URL ||= 'postgresql://localhost/test';
process.env.GOOGLE_CALENDAR_ID ||= 'primary';
process.env.GOOGLE_CALENDAR_CREDENTIALS ||= '{"type":"service_account"}';
process.env.APP_BASE_URL ||= 'http://localhost:3000';
process.env.EVOLUTION_INBOUND_SECRET ||= 'test-evolution-inbound-secret-1234567890';

const { generateMagicToken, hashMagicToken, safeHashEquals } = await import('@/lib/crypto/tokens');

describe('tokens', () => {
  it('gera token com pelo menos 32 bytes em base64url', () => {
    const token = generateMagicToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hash é determinístico e diferente para tokens distintos', () => {
    const a = generateMagicToken();
    const b = generateMagicToken();
    expect(hashMagicToken(a)).not.toBe(hashMagicToken(b));
    expect(hashMagicToken(a)).toBe(hashMagicToken(a));
  });

  it('safeHashEquals faz comparação em tempo constante', () => {
    const a = hashMagicToken('qualquer');
    const b = hashMagicToken('qualquer');
    const c = hashMagicToken('outro');
    expect(safeHashEquals(a, b)).toBe(true);
    expect(safeHashEquals(a, c)).toBe(false);
  });
});
