// Sessões HttpOnly baseadas em iron-session. Após validar o magic link o
// paciente recebe um cookie de sessão e o token bruto deixa de circular pela UI.

import type { SessionOptions } from 'iron-session';
import { getIronSession, type IronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

export type MagicSessionData = {
  patientId?: string;
  magicLinkId?: string;
  serviceId?: string;
  openedAt?: number;
};

const sessionOptions: SessionOptions = {
  password: env.SESSION_SECRET,
  cookieName: 'dra_session',
  cookieOptions: {
    secure: env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Mesma janela do magic link (em segundos).
    maxAge: env.MAGIC_LINK_TTL_MINUTES * 60,
  },
};

export async function getSession(): Promise<IronSession<MagicSessionData>> {
  // Next 14: cookies() é síncrono e retorna ReadonlyRequestCookies.
  // getIronSession aceita essa API em qualquer versão recente.
  return getIronSession<MagicSessionData>(cookies(), sessionOptions);
}
