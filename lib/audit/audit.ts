// Auditoria mínima — registra eventos relevantes para segurança e operação.
// Não armazenamos dados sensíveis (telefone, token, prontuário) aqui.

import type { Prisma, PrismaClient } from '@prisma/client';

type Client = PrismaClient | Prisma.TransactionClient;

export type AuditEventType =
  | 'magic_link.created'
  | 'magic_link.opened'
  | 'magic_link.consumed'
  | 'magic_link.revoked'
  | 'magic_link.expired_attempt'
  | 'magic_link.invalid_attempt'
  | 'appointment.created'
  | 'appointment.conflict'
  | 'appointment.failed'
  | 'appointment.cancelled'
  | 'appointment.rescheduled'
  | 'appointment.cancelled.calendar_failed'
  | 'appointment.notification_failed'
  | 'reminder.batch_sent'
  | 'reminder.batch_skipped'
  | 'reminder.responded'
  | 'reminder.orphan_response'
  | 'reminder.cancel_outside_window'
  | 'sync.event_unparsed'
  | 'sync.conflict_skipped'
  | 'sync.orphan_cancelled'
  | 'sync.batch_completed'
  | 'n8n.unauthorized'
  | 'n8n.rate_limited';

export async function recordAudit(
  client: Client,
  event: {
    eventType: AuditEventType;
    patientId?: string | null;
    magicLinkId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.auditEvent.create({
    data: {
      eventType: event.eventType,
      patientId: event.patientId ?? null,
      magicLinkId: event.magicLinkId ?? null,
      metadataJson: (event.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
