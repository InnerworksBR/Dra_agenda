// Middleware global: protege /agendar e APIs internas do paciente.
// No Edge runtime não temos acesso ao Prisma; basta verificar a presença
// do cookie de sessão (a verificação criptográfica é feita nas próprias
// rotas via iron-session).

import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Rotas internas chamadas pelo n8n com Authorization Bearer, não pelo
  // paciente com cookie. Devem passar pelo middleware sem redirecionar.
  if (pathname.startsWith('/api/v1/appointments/') && pathname.endsWith('/respond-reminder')) {
    return NextResponse.next();
  }

  if (
    pathname === '/agendar' ||
    pathname === '/consultas' ||
    pathname.startsWith('/api/v1/availability') ||
    pathname.startsWith('/api/v1/appointments')
  ) {
    const cookie = req.cookies.get('dra_session');
    if (!cookie || cookie.value.length < 16) {
      const url = req.nextUrl.clone();
      url.pathname = '/link-invalido';
      url.searchParams.set('motivo', 'invalid');
      return NextResponse.redirect(url, { status: 303 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/agendar', '/consultas', '/api/v1/availability', '/api/v1/appointments/:path*'],
};
