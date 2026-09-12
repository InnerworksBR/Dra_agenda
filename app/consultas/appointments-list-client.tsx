"use client";

// Lista de consultas do paciente. Tile escuro, pill buttons, body 17px,
// tracking negativo em display. Confirmação inline na própria lista —
// sem modal intermediário, coerente com a regra "uma tela só" do app.

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { isWithinCancellationWindow } from "@/lib/appointments/policy";

type Status = "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

export type AppointmentItem = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: Status;
  serviceId: string;
  serviceName: string;
};

const WEEKDAYS_PT = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

function maskPhone(phone: string): string {
  if (!phone.startsWith("+")) return phone;
  const cc = phone.slice(0, 3);
  const tail = phone.slice(-4);
  return `${cc} ••• ••• ${tail}`;
}

function statusLabel(status: Status): string {
  switch (status) {
    case "CONFIRMED":
      return "Confirmada";
    case "CANCELLED":
      return "Cancelada";
    case "COMPLETED":
      return "Realizada";
    case "NO_SHOW":
      return "Não compareceu";
  }
}

function statusTone(status: Status): string {
  switch (status) {
    case "CONFIRMED":
      return "border-primary-onDark text-primary-onDark";
    case "CANCELLED":
      return "border-body-muted text-body-muted line-through";
    case "COMPLETED":
      return "border-body-muted text-body-muted";
    case "NO_SHOW":
      return "border-rose-400/50 text-rose-300";
  }
}

export function AppointmentsListClient({
  patientName,
  phoneE164,
  appointments,
}: {
  patientName: string;
  phoneE164: string;
  appointments: AppointmentItem[];
}) {
  const [items, setItems] = useState(appointments);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [action, setAction] = useState<"cancel" | "reschedule" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);

  const upcoming = useMemo(
    () =>
      items.filter(
        (a) =>
          a.status === "CONFIRMED" && parseISO(a.startsAt).getTime() >= now.getTime(),
      ),
    [items, now],
  );

  const history = useMemo(
    () =>
      items.filter(
        (a) =>
          a.status !== "CONFIRMED" ||
          parseISO(a.startsAt).getTime() < now.getTime(),
      ),
    [items, now],
  );

  async function cancel(id: string) {
    if (!confirm("Tem certeza que deseja cancelar esta consulta?")) return;
    setBusyId(id);
    setAction("cancel");
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/v1/appointments/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Falha ao cancelar");
      setItems((cur) =>
        cur.map((a) => (a.id === id ? { ...a, status: "CANCELLED" } : a)),
      );
      setInfo(
        data.calendar_warning ??
          "Consulta cancelada. Você receberá uma confirmação pelo WhatsApp.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
      setAction(null);
    }
  }

  async function reschedule(id: string) {
    setBusyId(id);
    setAction("reschedule");
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/v1/appointments/${id}/reschedule`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Falha ao remarcar");
      window.location.assign(data.booking_url);
    } catch (e) {
      setError((e as Error).message);
      setBusyId(null);
      setAction(null);
    }
  }

  return (
    <main className="min-h-screen">
      <div className="global-nav" aria-hidden />

      <header className="sub-nav-frosted sticky top-0 z-10">
        <div className="mx-auto flex h-[52px] max-w-2xl items-center justify-between px-6">
          <span className="text-caption-strong text-ink">Dra. Priscila</span>
          <span className="text-fine-print text-ink-muted-48 nums-tabular">
            {maskPhone(phoneE164)}
          </span>
        </div>
      </header>

      {/* Hero — identidade (parchment) */}
      <section className="bg-parchment">
        <div className="mx-auto max-w-2xl px-6 py-12 text-center sm:py-section">
          <h1 className="text-display-md text-ink tracking-display">
            Suas consultas
          </h1>
          <p className="mx-auto mt-3 max-w-md text-body text-ink-muted-48">
            {patientName
              ? `Olá, ${patientName.split(" ")[0]}. Veja aqui suas próximas consultas ou cancele e remarque pelo app.`
              : "Veja aqui suas próximas consultas ou cancele e remarque pelo app."}
          </p>
        </div>
      </section>

      {error && (
        <section className="bg-canvas">
          <div className="mx-auto max-w-2xl px-6 py-6">
            <p
              className="text-body text-rose-600"
              role="alert"
            >
              {error}
            </p>
          </div>
        </section>
      )}

      {info && (
        <section className="bg-canvas">
          <div className="mx-auto max-w-2xl px-6 py-6">
            <p className="text-body text-primary-focus" role="status">
              {info}
            </p>
          </div>
        </section>
      )}

      {/* Próximas consultas */}
      <section className="bg-tile-1">
        <div className="mx-auto max-w-2xl px-6 py-[64px]">
          <h2 className="text-tagline text-white tracking-tagline">
            Próximas consultas
          </h2>
          <p className="mt-2 text-body text-body-muted">
            Cancelamentos pelo app são permitidos até 2 horas antes do horário.
          </p>

          {upcoming.length === 0 ? (
            <p className="mt-6 text-body text-body-muted">
              Você não tem consultas marcadas no momento. Acesse o link de
              agendamento enviado pelo WhatsApp para marcar uma nova.
            </p>
          ) : (
            <ul className="mt-6 grid gap-4">
              {upcoming.map((a) => {
                const start = parseISO(a.startsAt);
                const tooLate = isWithinCancellationWindow(start, now);
                const isBusy = busyId === a.id;
                return (
                  <li
                    key={a.id}
                    className="rounded-md bg-tile-2 p-5 shadow-hairline"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-body-strong text-white">
                        {a.serviceName}
                      </h3>
                      <span
                        className={`rounded-full border px-3 py-1 text-fine-print uppercase tracking-tight ${statusTone(a.status)}`}
                      >
                        {statusLabel(a.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-body text-body-muted">
                      {WEEKDAYS_PT[start.getDay()]},{" "}
                      {format(start, "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="btn-pill-primary"
                        onClick={() => reschedule(a.id)}
                        disabled={isBusy}
                      >
                        {isBusy && action === "reschedule"
                          ? "Gerando novo link…"
                          : "Reagendar"}
                      </button>
                      <button
                        type="button"
                        className="btn-pill-ghost border-hairline text-white"
                        onClick={() => cancel(a.id)}
                        disabled={isBusy || tooLate}
                        aria-disabled={tooLate}
                        title={
                          tooLate
                            ? "Fale com o consultório pelo WhatsApp para alterações de última hora."
                            : undefined
                        }
                      >
                        {isBusy && action === "cancel"
                          ? "Cancelando…"
                          : "Cancelar"}
                      </button>
                    </div>
                    {tooLate && (
                      <p className="mt-3 text-fine-print text-body-muted">
                        Cancelamento pelo app indisponível a menos de 2h. Fale
                        com o consultório pelo WhatsApp.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Histórico */}
      {history.length > 0 && (
        <section className="bg-canvas">
          <div className="mx-auto max-w-2xl px-6 py-[64px]">
            <h2 className="text-tagline text-ink tracking-tagline">Histórico</h2>
            <ul className="mt-6 grid gap-3">
              {history.map((a) => {
                const start = parseISO(a.startsAt);
                return (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-divider-soft pb-3"
                  >
                    <div>
                      <p className="text-body-strong text-ink">
                        {a.serviceName}
                      </p>
                      <p className="text-fine-print text-ink-muted-48">
                        {format(start, "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-fine-print uppercase tracking-tight ${statusTone(a.status)}`}
                    >
                      {statusLabel(a.status)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <footer className="bg-parchment">
        <div className="mx-auto max-w-2xl px-6 py-[48px]">
          <p className="text-fine-print text-ink-muted-48">
            Em caso de imprevistos, fale com o consultório pelo WhatsApp.
          </p>
        </div>
      </footer>
    </main>
  );
}
