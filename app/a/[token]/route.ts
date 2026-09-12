// GET /a/[token] — endpoint público do magic link.
// Valida o token, abre a sessão HttpOnly e redireciona para /agendar.

import { NextResponse } from 'next/server';
import { validateMagicToken, markFirstOpened } from '@/lib/magic-links/service';
import { getSession } from '@/lib/auth/session';
import { rateLimit } from '@/lib/security/rate-limit';
import { recordAudit } from '@/lib/audit/audit';
import { prisma } from '@/lib/db/prisma';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectTo(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, env.APP_BASE_URL), { status: 303 });
}

function redirectWithReason(reason: 'invalid' | 'expired' | 'revoked' | 'consumed'): NextResponse {
  const url = new URL('/link-invalido', env.APP_BASE_URL);
  url.searchParams.set('motivo', reason);
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET(
  req: Request,
  { params }: { params: { token: string } },
): Promise<NextResponse> {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';

  const rl = rateLimit({ key: `public:${ip}`, perMinute: env.RATE_LIMIT_PUBLIC_PER_MINUTE });
  if (!rl.allowed) {
    return new NextResponse('Too Many Requests', { status: 429 });
  }

  const result = await validateMagicToken(params.token);

  if (result.kind === 'invalid') {
    await recordAudit(prisma, { eventType: 'magic_link.invalid_attempt', metadata: { ip } });
    return redirectWithReason('invalid');
  }
  if (result.kind === 'expired') {
    await recordAudit(prisma, { eventType: 'magic_link.expired_attempt', metadata: { ip } });
    return redirectWithReason('expired');
  }
  if (result.kind === 'revoked') {
    return redirectWithReason('revoked');
  }
  if (result.kind === 'consumed') {
    return redirectWithReason('consumed');
  }

  // OK: cria a sessão.
  await markFirstOpened(result.magicLinkId);
  await recordAudit(prisma, {
    eventType: 'magic_link.opened',
    patientId: result.patientId,
    magicLinkId: result.magicLinkId,
    metadata: { ip },
  });

  const session = await getSession();
  session.patientId = result.patientId;
  session.magicLinkId = result.magicLinkId;
  session.serviceId = result.serviceId ?? undefined;
  session.openedAt = Date.now();
  await session.save();

  // Links legados (redirectTo null) caem em /agendar para preservar o fluxo
  // atual. Links novos respeitam o destino pedido pela IA.
  return redirectTo(result.redirectTo ?? '/agendar');
}
