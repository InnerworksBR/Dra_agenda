// Sync do Google Calendar para o banco. Chamado pelo cron a cada 5 minutos
// em /api/v1/cron/sync-calendar. Estratégia:
//
// 1. Lista eventos CONFIRMED do Google na janela [agora, agora + 60 dias].
// 2. Para cada evento, faz parse do summary no formato "Nome 13991743380"
//    (a doutora foi treinada a escrever assim). Se não parsear, pula e loga.
// 3. Upsert de Patient (por phoneE164) e Appointment (por externalCalendarEventId).
//    Se já existe Appointment com aquele eventId, atualiza horário se mudou.
// 4. Marca CANCELLED no banco os Appointment com source='google_import' cujo
//    eventId sumiu da listagem do Google (doutora deletou manualmente).
//
// Importante: o sync só escreve (Google -> banco). Nunca empurra para o
// Google. A direção contrária é responsabilidade do caminho de criação da API.
//
// Idempotência: rodar 2x no mesmo intervalo não duplica nada, porque o
// upsert por externalCalendarEventId é a chave.

import { prisma } from '@/lib/db/prisma';
import { getCalendarProvider } from '@/lib/calendar/google';
import { parseCalendarSummary } from '@/lib/time/sao-paulo';
import { recordAudit } from '@/lib/audit/audit';

export type SyncResult = {
  window: { from: string; to: string };
  events_seen: number;
  events_parsed: number;
  events_skipped_parse: number;
  appointments_created: number;
  appointments_updated: number;
  appointments_cancelled_orphan: number;
  appointments_skipped_conflict: number;
  patients_created: number;
  errors: Array<{ externalEventId: string; reason: string }>;
};

const SYNC_WINDOW_DAYS = 60;
const DEFAULT_SERVICE_ID = 'consulta-inicial';
const SOURCE = 'google_import';

export async function runCalendarSync(now: Date = new Date()): Promise<SyncResult> {
  const timeMin = now;
  const timeMax = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const provider = getCalendarProvider();

  const events = await provider.listEvents({ timeMin, timeMax });

  // Mapa de eventIds vistos nessa execução. Usado no fim pra detectar
  // Appointment órfão (Google deletou o evento entre sincronizações).
  const seenEventIds = new Set<string>();
  for (const e of events) seenEventIds.add(e.externalEventId);

  const result: SyncResult = {
    window: { from: timeMin.toISOString(), to: timeMax.toISOString() },
    events_seen: events.length,
    events_parsed: 0,
    events_skipped_parse: 0,
    appointments_created: 0,
    appointments_updated: 0,
    appointments_cancelled_orphan: 0,
    appointments_skipped_conflict: 0,
    patients_created: 0,
    errors: [],
  };

  for (const ev of events) {
    const parsed = parseCalendarSummary(ev.summary);
    if (!parsed) {
      result.events_skipped_parse++;
      await recordAudit(prisma, {
        eventType: 'sync.event_unparsed',
        metadata: { externalEventId: ev.externalEventId, summary: ev.summary },
      }).catch(() => undefined);
      continue;
    }
    result.events_parsed++;

    try {
      // 1. Upsert Patient por telefone. Se já existe, reusa.
      let patient = await prisma.patient.findUnique({
        where: { phoneE164: parsed.phone },
        select: { id: true, name: true },
      });
      if (!patient) {
        patient = await prisma.patient.create({
          data: { phoneE164: parsed.phone, name: parsed.name },
          select: { id: true, name: true },
        });
        result.patients_created++;
      }

      // 2. Upsert Appointment por externalCalendarEventId.
      const existing = await prisma.appointment.findFirst({
        where: { externalCalendarEventId: ev.externalEventId },
        select: { id: true, startsAt: true, endsAt: true, status: true, patientId: true },
      });

      if (existing) {
        // Atualiza só se horário mudou e status ainda é CONFIRMED.
        const startChanged = existing.startsAt.getTime() !== ev.startsAt.getTime();
        const endChanged = existing.endsAt.getTime() !== ev.endsAt.getTime();
        if ((startChanged || endChanged) && existing.status === 'CONFIRMED') {
          await prisma.appointment.update({
            where: { id: existing.id },
            data: {
              startsAt: ev.startsAt,
              endsAt: ev.endsAt,
              // patientId só atualiza se o paciente atual existe e o anterior era null.
              patientId: patient.id,
            },
          });
          result.appointments_updated++;
        }
        continue;
      }

      // 3. Não existia. Verifica colisão com outro Appointment no mesmo slot
      //    (regra @@unique([startsAt, serviceId]) do schema). Se conflitar,
      //    pula e loga — não deletamos o existente, não criamos duplicado.
      const conflict = await prisma.appointment.findFirst({
        where: {
          startsAt: ev.startsAt,
          serviceId: DEFAULT_SERVICE_ID,
          status: { not: 'CANCELLED' },
          externalCalendarEventId: { not: ev.externalEventId },
        },
        select: { id: true, externalCalendarEventId: true },
      });
      if (conflict) {
        result.appointments_skipped_conflict++;
        await recordAudit(prisma, {
          eventType: 'sync.conflict_skipped',
          patientId: patient.id,
          metadata: {
            externalEventId: ev.externalEventId,
            conflictingAppointmentId: conflict.id,
            conflictingExternalEventId: conflict.externalCalendarEventId,
          },
        }).catch(() => undefined);
        continue;
      }

      await prisma.appointment.create({
        data: {
          patientId: patient.id,
          serviceId: DEFAULT_SERVICE_ID,
          startsAt: ev.startsAt,
          endsAt: ev.endsAt,
          status: 'CONFIRMED',
          externalCalendarEventId: ev.externalEventId,
          source: SOURCE,
        },
      });
      result.appointments_created++;
    } catch (e) {
      result.errors.push({
        externalEventId: ev.externalEventId,
        reason: (e as Error)?.message ?? 'unknown',
      });
    }
  }

  // 4. Detecta Appointment órfão: source='google_import', CONFIRMED, com
  //    externalCalendarEventId que NÃO apareceu na listagem do Google.
  //    Janela de tolerância: só considera Appointment com startsAt >= agora
  //    - 1 dia. Passados mais antigos são considerados históricos e ficam
  //    como estão (não dá pra distinguir "doutora deletou" de "consulta
  //    aconteceu" sem histórico do Google).
  const toleranceStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const orphans = await prisma.appointment.findMany({
    where: {
      source: SOURCE,
      status: 'CONFIRMED',
      externalCalendarEventId: { not: null },
      startsAt: { gte: toleranceStart },
      NOT: { externalCalendarEventId: { in: Array.from(seenEventIds) } },
    },
    select: { id: true, externalCalendarEventId: true, patientId: true },
  });

  for (const orph of orphans) {
    try {
      await prisma.appointment.update({
        where: { id: orph.id },
        data: { status: 'CANCELLED' },
      });
      result.appointments_cancelled_orphan++;
      await recordAudit(prisma, {
        eventType: 'sync.orphan_cancelled',
        patientId: orph.patientId,
        metadata: {
          appointmentId: orph.id,
          externalEventId: orph.externalCalendarEventId,
        },
      }).catch(() => undefined);
    } catch (e) {
      result.errors.push({
        externalEventId: orph.externalCalendarEventId ?? orph.id,
        reason: `orphan-cancel: ${(e as Error)?.message ?? 'unknown'}`,
      });
    }
  }

  await recordAudit(prisma, {
    eventType: 'sync.batch_completed',
    metadata: {
      events_seen: result.events_seen,
      events_parsed: result.events_parsed,
      appointments_created: result.appointments_created,
      appointments_updated: result.appointments_updated,
      appointments_cancelled_orphan: result.appointments_cancelled_orphan,
      patients_created: result.patients_created,
      errors: result.errors.length,
    },
  });

  return result;
}
