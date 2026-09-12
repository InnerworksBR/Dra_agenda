// Server Component — garante sessão, carrega paciente e renderiza UMA tela
// única mobile-first com todas as seções empilhadas (identidade → dia → horário → confirmar).

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { SchedulingClient } from "./scheduling-client";

export const dynamic = "force-dynamic";

export default async function AgendarPage() {
  const session = await getSession();
  if (!session.patientId) {
    redirect("/link-invalido?motivo=invalid");
  }

  const patient = await prisma.patient.findUnique({
    where: { id: session.patientId },
    select: { id: true, name: true, healthPlan: true, phoneE164: true },
  });

  if (!patient) {
    redirect("/link-invalido?motivo=invalid");
  }

  // Lista fixa de planos — em produção, vir do banco/config.
  const plans = [
    { id: "particular", label: "Particular" },
    { id: "amil", label: "Amil" },
    { id: "bradesco-saude", label: "Bradesco Saúde" },
    { id: "sulamerica", label: "SulAmérica" },
    { id: "unimed", label: "Unimed" },
    { id: "hapvida", label: "Hapvida" },
    { id: "notredame", label: "NotreDame Intermédica" },
    { id: "outros", label: "Outro" },
  ];

  return (
    <main>
      <SchedulingClient
        patient={{
          id: patient.id,
          name: patient.name ?? "",
          healthPlan: patient.healthPlan ?? "",
          phoneE164: patient.phoneE164,
        }}
        plans={plans}
        serviceId={session.serviceId ?? env.DEFAULT_SERVICE_ID}
      />
    </main>
  );
}
