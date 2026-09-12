// Rate limit em memória — adequado ao MVP single-instance.
// Estrutura: Map<key, { count, resetAt }>.
// Para múltiplas instâncias, substituir por Redis/Upstash.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Limpeza periódica para evitar leak de chaves expiradas.
if (typeof globalThis !== 'undefined') {
  const g = globalThis as unknown as { __rateLimitSweeper?: NodeJS.Timeout };
  if (!g.__rateLimitSweeper) {
    g.__rateLimitSweeper = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of buckets.entries()) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }, 60_000);
    // Não bloqueia o shutdown.
    g.__rateLimitSweeper.unref?.();
  }
}

export function rateLimit(opts: {
  key: string;
  perMinute: number;
}): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const cur = buckets.get(opts.key);

  if (!cur || cur.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(opts.key, { count: 1, resetAt });
    return { allowed: true, remaining: opts.perMinute - 1, resetAt };
  }

  cur.count += 1;
  const allowed = cur.count <= opts.perMinute;
  return {
    allowed,
    remaining: Math.max(0, opts.perMinute - cur.count),
    resetAt: cur.resetAt,
  };
}
