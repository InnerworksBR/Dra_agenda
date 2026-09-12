// Seed one-off para teste do fluxo de confirmação 20h.
// Cria paciente + consulta para amanhã 14:00 SP (cair na janela 12–24h quando
// você chamar o cron em qualquer horário de hoje).
//
// Uso: npx tsx scripts/seed-reminder-test.ts

import { addDays, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { prisma } from '@/lib/db/prisma';

const PHONE = '+5513991743999';
const PATIENT_NAME = 'Teste Lembrete';
const SERVICE_ID = 'consulta-inicial';
const TZ = 'America/Sao_Paulo';

async function main() {
  // Paciente
  const patient = await prisma.patient.upsert({
    where: { phoneE164: PHONE },
    update: { name: PATIENT_NAME },
    create: { phoneE164: PHONE, name: PATIENT_NAME },
  });
  console.log('[seed] patient', { id: patient.id, phone: patient.phoneE164 });

  // Garante que o serviço existe
  const service = await prisma.service.findUnique({ where: { id: SERVICE_ID } });
  if (!service) {
    console.error(`[seed] service ${SERVICE_ID} não encontrado. Rode o seed oficial antes.`);
    process.exit(1);
  }

  // Amanhã 14:00 SP → UTC
  const tomorrowSp = setMilliseconds(setSeconds(setMinutes(setHours(addDays(new Date(), 1), 14), 0), 0), 0);
  const startsAt = fromZonedTime(tomorrowSp, TZ);
  const endsAt = fromZonedTime(setMilliseconds(setSeconds(setMinutes(setHours(addDays(new Date(), 1), 14), 30), 0), 0), TZ);

  // Remove appointment de seed anterior no mesmo horário, se existir
  await prisma.appointment.deleteMany({
    where: { patientId: patient.id, startsAt },
  });

  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      serviceId: SERVICE_ID,
      startsAt,
      endsAt,
      status: 'CONFIRMED',
    },
  });
  console.log('[seed] appointment', {
    id: appointment.id,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    status: appointment.status,
  });

  // Limpa AppointmentConfirmation anterior desse appointment (caso você rode
  // o seed duas vezes no mesmo dia) para o cron poder criar uma nova.
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  await prisma.appointmentConfirmation.deleteMany({
    where: { appointmentId: appointment.id, sentDay: todayUtc },
  });

  console.log('[seed] pronto. Agora chame:');
  console.log('       curl -X POST http://localhost:3000/api/v1/cron/confirm-reminders \\');
  console.log('         -H "Authorization: Bearer $N8N_API_SECRET"');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
