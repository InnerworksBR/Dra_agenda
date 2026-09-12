// Hash e geração de tokens para magic links.
// O segredo entra via HMAC para que o hash armazenado não vaze correlação
// entre tokens (dois tokens parecidos ainda resultam em hashes bem diferentes
// graças ao HMAC), mas continua deterministicamente verificável.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

const TOKEN_BYTES = 32; // 256 bits de entropia

/**
 * Gera um token opaco em base64url. Não armazenar em texto puro.
 */
export function generateMagicToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Aplica HMAC-SHA256 sobre o token com o segredo de servidor. Persistir
 * somente este hash; nunca o token bruto.
 */
export function hashMagicToken(token: string): string {
  return createHmac('sha256', env.MAGIC_LINK_HASH_SECRET).update(token).digest('hex');
}

/** Hash auxiliar — SHA-256 puro, usado para fingerprints não-confidenciais. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Comparação de hash em tempo constante. */
export function safeHashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
