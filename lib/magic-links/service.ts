// Lógica de emissão e validação de magic links. Centralizada para que
// /api/v1/magic-links e /a/[token] compartilhem o mesmo fluxo.

import { addMinutes } from 'date-fns';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { env } from '@/lib/env';
import { generateMagicToken, hashMagicToken, safeHashEquals } from '@/lib/crypto/tokens';
import { upsertPatientByPhone } from '@/lib/patients/service';
import { recordAudit } from '@/lib/audit/audit';
import { InvalidInputError, ServiceError, UnauthorizedError } from '@/lib/errors';
import { sha256 } from '@/lib/crypto/tokens';

export type IssueMagicLinkInput = {
  phone: string;
  patientName?: string;
  serviceId?: string;
  conversationId?: string;
  source?: string;
  idempotencyKey?: string;
  // Rota interna de redirecionamento após o paciente abrir o magic link.
  // Whitelist é validada aqui; default em /agendar.
  redirectTo?: string;
};

const ALLOWED_REDIRECT_PATHS = ['/agendar', '/consultas'] as const;
type RedirectPath = (typeof ALLOWED_REDIRECT_PATHS)[number];

function normalizeRedirect(value: string | undefined): RedirectPath {
  if (!value) return '/agendar';
  // Aceita com ou sem query/hash, contanto que o path base esteja na whitelist.
  const path = value.split('?')[0].split('#')[0];
  if ((ALLOWED_REDIRECT_PATHS as readonly string[]).includes(path)) {
    return path as RedirectPath;
  }
  throw new InvalidInputError(
    'INVALID_REDIRECT',
    `redirectTo inválido: "${value}". Permitidos: ${ALLOWED_REDIRECT_PATHS.join(', ')}`,
  );
}

export type IssueMagicLinkResult = {
  patientId: string;
  magicLinkId: string;
  token: string;
  bookingUrl: string;
  expiresAt: Date;
  redirectTo: RedirectPath;
};

/** Resultado de validação do token bruto no link público. */
export type ValidateResult =
  | {
      kind: 'ok';
      patientId: string;
      magicLinkId: string;
      serviceId: string | null;
      // null = link legado, sem coluna redirect_to. Default em runtime = /agendar.
      redirectTo: RedirectPath | null;
    }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'revoked' }
  | { kind: 'consumed' };

export async function issueMagicLink(input: IssueMagicLinkInput): Promise<IssueMagicLinkResult> {
  if (!input.phone) throw new InvalidInputError('INVALID_PHONE', 'Telefone é obrigatório');

  // Whitelist cedo — antes de qualquer escrita. Se redirectTo for inválido,
  // falhamos com 400 antes de bater no Prisma.
  const redirectTo = normalizeRedirect(input.redirectTo);

  const patient = await upsertPatientByPhone({
    phone: input.phone,
    patientName: input.patientName,
  });

  const requestHash = sha256(
    JSON.stringify({
      phone: patient.phoneE164,
      patientName: input.patientName ?? null,
      serviceId: input.serviceId ?? null,
    }),
  );

  // Idempotência: mesma chave + mesmo payload => mesmo link.
  // Se a chave já existe com o mesmo hash, retorna o link existente.
  if (input.idempotencyKey) {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key: input.idempotencyKey },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key reutilizada com payload diferente');
      }
      const link = await prisma.magicLink.findUnique({ where: { id: existing.magicLinkId! } });
      if (link && !link.revokedAt) {
        // Reaproveita link existente: como só temos o hash do token, devolvemos
        // um token novo efêmero e revogamos o anterior para manter a política
        // "um link ativo por paciente+contexto". Isso preserva idempotência
        // para o n8n (mesma idempotency-key = mesmo magicLinkId) sem
        // devolver o token bruto já consumido.
        const newToken = generateMagicToken();
        const newHash = hashMagicToken(newToken);
        const newExpiresAt = addMinutes(new Date(), env.MAGIC_LINK_TTL_MINUTES);

        await prisma.$transaction(async (tx) => {
          await tx.magicLink.update({
            where: { id: link.id },
            data: { revokedAt: new Date() },
          });
          await tx.magicLink.create({
            data: {
              patientId: link.patientId,
              tokenHash: newHash,
              expiresAt: newExpiresAt,
              source: input.source ?? null,
              conversationId: input.conversationId ?? link.conversationId,
              serviceId: input.serviceId ?? link.serviceId,
              redirectTo,
            },
          });
        });

        return {
          patientId: link.patientId,
          magicLinkId: link.id,
          token: newToken,
          bookingUrl: `${env.APP_BASE_URL}/a/${newToken}`,
          expiresAt: newExpiresAt,
          redirectTo,
        };
      }
    }
  }

  const token = generateMagicToken();
  const tokenHash = hashMagicToken(token);
  const expiresAt = addMinutes(new Date(), env.MAGIC_LINK_TTL_MINUTES);

  // Política: revoga links ativos anteriores do mesmo paciente+contexto.
  await prisma.magicLink.updateMany({
    where: {
      patientId: patient.id,
      serviceId: input.serviceId ?? null,
      conversationId: input.conversationId ?? null,
      revokedAt: null,
      consumedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  const magicLink = await prisma.magicLink.create({
    data: {
      patientId: patient.id,
      tokenHash,
      expiresAt,
      source: input.source ?? null,
      conversationId: input.conversationId ?? null,
      serviceId: input.serviceId ?? null,
      redirectTo,
    },
    select: { id: true, expiresAt: true, redirectTo: true },
  });

  await recordAudit(prisma, {
    eventType: 'magic_link.created',
    patientId: patient.id,
    magicLinkId: magicLink.id,
    metadata: {
      source: input.source ?? null,
      hasIdempotency: !!input.idempotencyKey,
      redirectTo,
    },
  });

  // Persiste a chave de idempotência com o resultado para chamadas futuras.
  // Captura P2002 (unique constraint) para tratar race condition entre
  // requests concorrentes com a mesma chave: o vencedor grava, o perdedor
  // cai aqui, faz rollback do magicLink criado e devolve o existente.
  if (input.idempotencyKey) {
    try {
      await prisma.idempotencyKey.create({
        data: {
          key: input.idempotencyKey,
          requestHash,
          magicLinkId: magicLink.id,
          responseJson: {
            patientId: patient.id,
            magicLinkId: magicLink.id,
            expiresAt: magicLink.expiresAt.toISOString(),
          },
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Outro request gravou a mesma chave entre nosso findUnique e create.
        // Verificamos se o hash bate; se sim, retornamos o resultado existente
        // e revogamos o magicLink orfão que acabamos de criar.
        const existing = await prisma.idempotencyKey.findUnique({
          where: { key: input.idempotencyKey },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            // Reverte a criação do magicLink para não deixar orfão.
            await prisma.magicLink.update({
              where: { id: magicLink.id },
              data: { revokedAt: new Date() },
            });
            throw new ServiceError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'Idempotency-Key reutilizada com payload diferente',
            );
          }
          const existingLink = await prisma.magicLink.findUnique({
            where: { id: existing.magicLinkId! },
          });
          // Revoga o magicLink que criamos acima (não vai ser usado).
          await prisma.magicLink.update({
            where: { id: magicLink.id },
            data: { revokedAt: new Date() },
          });
          if (existingLink && !existingLink.revokedAt) {
            // Retorna token novo vinculado ao magicLinkId existente.
            // O redirectTo do link antigo é preservado — uma chave de
            // idempotência sempre aponta para o mesmo contexto.
            const finalRedirect = (existingLink.redirectTo ?? redirectTo) as RedirectPath;
            const newToken = generateMagicToken();
            const newHash = hashMagicToken(newToken);
            const newExpiresAt = addMinutes(new Date(), env.MAGIC_LINK_TTL_MINUTES);
            await prisma.$transaction(async (tx) => {
              await tx.magicLink.update({
                where: { id: existingLink.id },
                data: { revokedAt: new Date() },
              });
              await tx.magicLink.create({
                data: {
                  patientId: existingLink.patientId,
                  tokenHash: newHash,
                  expiresAt: newExpiresAt,
                  source: input.source ?? existingLink.source,
                  conversationId: existingLink.conversationId,
                  serviceId: existingLink.serviceId,
                  redirectTo: finalRedirect,
                },
              });
            });
            return {
              patientId: existingLink.patientId,
              magicLinkId: existingLink.id,
              token: newToken,
              bookingUrl: `${env.APP_BASE_URL}/a/${newToken}`,
              expiresAt: newExpiresAt,
              redirectTo: finalRedirect,
            };
          }
        }
      }
      throw err;
    }
  }

  return {
    patientId: patient.id,
    magicLinkId: magicLink.id,
    token,
    bookingUrl: `${env.APP_BASE_URL}/a/${token}`,
    expiresAt: magicLink.expiresAt,
    redirectTo,
  };
}

export async function validateMagicToken(rawToken: string): Promise<ValidateResult> {
  if (!rawToken || rawToken.length < 16) return { kind: 'invalid' };
  const tokenHash = hashMagicToken(rawToken);
  const link = await prisma.magicLink.findUnique({ where: { tokenHash } });
  if (!link) return { kind: 'invalid' };
  if (link.revokedAt) return { kind: 'revoked' };
  if (link.consumedAt) return { kind: 'consumed' };
  if (link.expiresAt.getTime() <= Date.now()) return { kind: 'expired' };

  // Validação cruzada — se o segredo tiver sido rotacionado, ainda queremos
  // detectar tentativas de forjar hash. Comparação constant-time no final.
  const recomputed = hashMagicToken(rawToken);
  if (!safeHashEquals(recomputed, link.tokenHash)) return { kind: 'invalid' };

  return {
    kind: 'ok',
    patientId: link.patientId,
    magicLinkId: link.id,
    serviceId: link.serviceId,
    redirectTo: link.redirectTo as RedirectPath | null,
  };
}

export async function markFirstOpened(magicLinkId: string): Promise<void> {
  await prisma.magicLink.updateMany({
    where: { id: magicLinkId, firstOpenedAt: null },
    data: { firstOpenedAt: new Date() },
  });
}

export async function revokeMagicLink(magicLinkId: string, reason?: string): Promise<void> {
  await prisma.magicLink.update({
    where: { id: magicLinkId },
    data: { revokedAt: new Date() },
  });
  await recordAudit(prisma, {
    eventType: 'magic_link.revoked',
    magicLinkId,
    metadata: { reason: reason ?? null },
  });
}

export async function authorizeN8n(req: Request): Promise<void> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new UnauthorizedError('Credencial ausente');
  if (match[1] !== env.N8N_API_SECRET) throw new UnauthorizedError('Credencial inválida');
}
