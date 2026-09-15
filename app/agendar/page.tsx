// Server Component — garante sessão, carrega paciente e renderiza UMA tela
// única mobile-first com todas as seções empilhadas (identidade → dia → horário → confirmar).

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { HEALTH_PLANS, HEALTH_PLAN_IDS } from "@/lib/patients/health-plans";

import { SchedulingClient } from "./scheduling-client";

export const dynamic = "force-dynamic";

const plans = HEALTH_PLANS;

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

  // Normaliza healthPlan: se o valor salvo no banco não está na nova lista
  // (ex: paciente antigo com "particular", "amil"), força reescolha mostrando
  // o select vazio. Backend rejeita valores fora da enum no próximo POST.
  const normalizedHealthPlan =
    patient.healthPlan && (HEALTH_PLAN_IDS as readonly string[]).includes(patient.healthPlan)
      ? patient.healthPlan
      : "";

  return (
    <main>
      <SchedulingClient
        patient={{
          id: patient.id,
          name: patient.name ?? "",
          healthPlan: normalizedHealthPlan,
          phoneE164: patient.phoneE164,
        }}
        plans={plans}
        serviceId={session.serviceId ?? env.DEFAULT_SERVICE_ID}
      />
    </main>
  );
}
