// Upsert de paciente por telefone — base do RF-03.
import { prisma } from '@/lib/db/prisma';
import { normalizeToE164 } from '@/lib/phone/normalize';

export async function upsertPatientByPhone(opts: {
  phone: string;
  patientName?: string;
}): Promise<{ id: string; phoneE164: string }> {
  const phoneE164 = normalizeToE164(opts.phone);
  const patient = await prisma.patient.upsert({
    where: { phoneE164 },
    create: {
      phoneE164,
      name: opts.patientName ?? null,
    },
    update: opts.patientName ? { name: opts.patientName } : {},
    select: { id: true, phoneE164: true },
  });
  return patient;
}
