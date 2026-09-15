// Lógica do fluxo proativo de confirmação de agendamento por WhatsApp.
// O cron (n8n) chama POST /api/v1/cron/confirm-reminders às 20h. Este service
// lista appointments na janela 12–24h, persiste um AppointmentConfirmation
// por consulta (idempotente por dia) e dispara o webhook n8n com a lista.

import { addHours } from 'date-fns';
import { prisma } from '@/lib/db/prisma';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit/audit';
import { formatPtBrDate, formatPtBrTime, midnightInSaoPaulo } from '@/lib/time/sao-paulo';

export type ReminderItem = {
  confirmation_id: string;
  appointment_id: string;
  patient_id: string;
  patient_phone: string;
  patient_name: string | null;
  service_id: string;
  starts_at: string;
  ends_at: string;
  // Data e hora pré-formatadas em America/Sao_Paulo (dd/mm/aaaa e HH:mm).
  // Workflow n8n deve usar estes campos para evitar formatação local.
  data: string;
  hora: string;
};

export type BatchResult = {
  batch_date: string;
  total: number;
  skipped: number;
  reminders: ReminderItem[];
};

/**
 * Lista appointments nas próximas 12–24h com status CONFIRMED, persiste um
 * AppointmentConfirmation por consulta (idempotente por sentDay) e devolve a
 * lista de lembretes a enviar. Se N8N_REMINDER_WEBHOOK_URL estiver setado,
 * faz POST fire-and-forget com a lista.
 *
 * Idempotência: a constraint @@unique([appointmentId, sentDay]) garante que
 * rodar este batch duas vezes no mesmo dia não cria registros duplicados.
 */
export async function runConfirmationRemindersBatch(now: Date = new Date()): Promise<BatchResult> {
  const windowStart = addHours(now, 12);
  const windowEnd = addHours(now, 24);
  const sentDay = midnightInSaoPaulo(now);

  // Lista candidatos: consultas nas próximas 12–24h, ainda CONFIRMED, e que
  // vão acontecer depois de agora (salvaguarda contra bordas).
  const candidates = await prisma.appointment.findMany({
    where: {
      status: 'CONFIRMED',
      startsAt: { gt: now, gte: windowStart, lte: windowEnd },
    },
    include: {
      patient: { select: { id: true, phoneE164: true, name: true } },
    },
  });

  const reminders: ReminderItem[] = [];
  let skipped = 0;

  for (const apt of candidates) {
    // upsert com create-only-if-absent. Se já existe AppointmentConfirmation
    // para (appointmentId, sentDay), o registro antigo é mantido — isso
    // impede reenvio e também preserva respondedAt se o paciente já respondeu.
    const existing = await prisma.appointmentConfirmation.findUnique({
      where: {
        appointment_confirmation_unique_per_day: {
          appointmentId: apt.id,
          sentDay,
        },
      },
    });

    if (existing) {
      skipped++;
      continue;
    }

    const created = await prisma.appointmentConfirmation.create({
      data: { appointmentId: apt.id, sentDay },
    });

    reminders.push({
      confirmation_id: created.id,
      appointment_id: apt.id,
      patient_id: apt.patientId,
      patient_phone: apt.patient.phoneE164,
      patient_name: apt.patient.name,
      service_id: apt.serviceId,
      starts_at: apt.startsAt.toISOString(),
      ends_at: apt.endsAt.toISOString(),
      data: formatPtBrDate(apt.startsAt),
      hora: formatPtBrTime(apt.startsAt),
    });
  }

  const batch_date = sentDay.toISOString();

  await recordAudit(prisma, {
    eventType: 'reminder.batch_sent',
    metadata: {
      batch_date,
      total: reminders.length,
      skipped,
      candidates: candidates.length,
    },
  });

  if (reminders.length > 0 && env.N8N_REMINDER_WEBHOOK_URL) {
    // Fire-and-forget. Falha de rede não bloqueia o batch — o banco é a fonte
    // da verdade, e o cron vai tentar de novo amanhã.
    void fetch(env.N8N_REMINDER_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ batch_date, reminders }),
    }).catch((err) => {
      console.error('[reminders] webhook dispatch failed', err);
    });
  }

  return { batch_date, total: reminders.length, skipped, reminders };
}
