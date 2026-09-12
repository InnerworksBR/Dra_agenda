// Resposta JSON padronizada para erros da API. Evita vazar stack traces
// ou diferenciar mensagens que possam permitir enumeração.

export type ApiError = {
  success: false;
  code: string;
  message: string;
};

export type ApiOk<T> = { success: true } & T;

export function apiOk<T extends object>(data: T, init?: ResponseInit): Response {
  return Response.json({ success: true, ...data } as ApiOk<T>, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      ...(init?.headers ?? {}),
    },
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json(
    { success: false, code, message, ...(extra ?? {}) } satisfies ApiError & Record<string, unknown>,
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
