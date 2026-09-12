// POST /api/v1/magic-links/[id]/revoke — revogação administrativa.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revokeMagicLink } from '@/lib/magic-links/service';
import { apiError, apiOk } from '@/lib/api/response';
import { authorizeN8n } from '@/lib/magic-links/service';
import { UnauthorizedError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ reason: z.string().max(200).optional() });

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    await authorizeN8n(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) return apiError(401, 'UNAUTHORIZED', 'Não autorizado') as NextResponse;
    return apiError(500, 'INTERNAL_ERROR', 'Falha interna') as NextResponse;
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    // corpo vazio é aceito
  }
  const parsed = bodySchema.safeParse(raw);

  try {
    await revokeMagicLink(params.id, parsed.success ? parsed.data.reason : undefined);
    return apiOk({ revoked: true }) as NextResponse;
  } catch {
    return apiError(404, 'NOT_FOUND', 'Magic link não encontrado') as NextResponse;
  }
}
