// Server Component — garante sessão, carrega appointments do paciente
// e renderiza a lista de gestão de consultas.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listAppointmentsForPatient } from "@/lib/appointments/service";
import { prisma } from "@/lib/db/prisma";
import { AppointmentsListClient } from "./appointments-list-client";

export const dynamic = "force-dynamic";

export default async function ConsultasPage() {
  const session = await getSession();
  if (!session.patientId) {
    redirect("/link-invalido?motivo=invalid");
  }

  const patient = await prisma.patient.findUnique({
    where: { id: session.patientId },
    select: { phoneE164: true, name: true },
  });
  if (!patient) {
    redirect("/link-invalido?motivo=invalid");
  }

  const items = await listAppointmentsForPatient(session.patientId);

  return (
    <AppointmentsListClient
      patientName={patient.name ?? ""}
      phoneE164={patient.phoneE164}
      appointments={items.map((a) => ({
        id: a.id,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        status: a.status,
        serviceId: a.serviceId,
        serviceName: a.service.name,
      }))}
    />
  );
}
