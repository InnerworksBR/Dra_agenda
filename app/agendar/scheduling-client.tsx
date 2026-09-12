"use client";

// Tela única mobile-first do agendamento. Estilo Apple Design System:
// superfícies full-bleed como separador visual, pill buttons, body 17px,
// tracking negativo em display. Tudo em uma página só, scroll contínuo.

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

type AvailabilityDay = { date: string; slots: string[] };
type AvailabilityResponse = {
  success: boolean;
  timezone: string;
  window_days: AvailabilityDay[];
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
const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function maskPhone(phone: string): string {
  // +5511999999999 → +55 ••• ••• 9999
  if (!phone.startsWith("+")) return phone;
  const cc = phone.slice(0, 3); // +55
  const tail = phone.slice(-4);
  return `${cc} ••• ••• ${tail}`;
}

export function SchedulingClient({
  patient,
  plans,
  serviceId,
}: {
  patient: { id: string; name: string; healthPlan: string; phoneE164: string };
  plans: { id: string; label: string }[];
  serviceId: string;
}) {
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{
    starts_at: string;
    weekday: string;
  } | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  // Identidade do paciente — começa preenchida se já vier do servidor.
  const [name, setName] = useState(patient.name);
  const [healthPlan, setHealthPlan] = useState(patient.healthPlan);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/v1/availability", { cache: "no-store" });
        const data = (await res.json()) as AvailabilityResponse & {
          code?: string;
          message?: string;
        };
        if (!res.ok)
          throw new Error(data.message ?? "Falha ao carregar agenda");
        if (!cancelled) setAvailability(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => availability?.window_days ?? [], [availability]);
  const selectedDay = useMemo(
    () => days.find((d) => d.date === selectedDate) ?? null,
    [days, selectedDate],
  );

  const slotIdFor = (date: string, slot: string) => `slot_${date}T${slot}`;

  const canConfirm = useMemo(() => {
    return (
      name.trim().length >= 2 &&
      healthPlan.trim().length >= 2 &&
      !!selectedDate &&
      !!selectedSlot &&
      !submitting
    );
  }, [name, healthPlan, selectedDate, selectedSlot, submitting]);

  async function confirm() {
    if (!selectedDate || !selectedSlot) return;
    setSubmitting(true);
    setConflict(null);
    try {
      const res = await fetch("/api/v1/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot_id: slotIdFor(selectedDate, selectedSlot),
          service_id: serviceId,
          name: name.trim(),
          health_plan: healthPlan.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "SLOT_UNAVAILABLE") {
          setConflict("Esse horário acabou de ser ocupado. Escolha outro.");
          const reload = await fetch("/api/v1/availability", {
            cache: "no-store",
          });
          if (reload.ok) setAvailability(await reload.json());
          setSelectedSlot(null);
          return;
        }
        throw new Error(data.message ?? "Falha ao confirmar");
      }
      const startsAt = parseISO(data.starts_at);
      setDone({
        starts_at: data.starts_at,
        weekday: WEEKDAYS_PT[startsAt.getDay()],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Tela de sucesso — substitui tudo, scroll livre.
  if (done) {
    return (
      <main className="min-h-screen">
        <section className="bg-canvas">
          <div className="mx-auto max-w-2xl px-6 py-section text-center">
            <span className="pill">Agendamento confirmado</span>
            <h1 className="mt-4 text-display-md text-ink tracking-display">
              Tudo certo!
            </h1>
            <p className="mx-auto mt-3 max-w-md text-body text-ink-muted-48">
              Sua consulta com a Dra. Priscila está marcada para{" "}
              <strong className="font-semibold text-ink">
                {format(parseISO(done.starts_at), "dd 'de' MMMM 'às' HH:mm", {
                  locale: ptBR,
                })}
              </strong>
              .
            </p>
          </div>
        </section>
        <section className="bg-tile-1">
          <div className="mx-auto max-w-2xl px-6 py-[64px] text-center">
            <h2 className="text-tagline text-white tracking-tagline">
              Em caso de imprevistos
            </h2>
            <p className="mx-auto mt-2 max-w-md text-body text-body-muted">
              Você pode remarcar ou cancelar pelo app em{" "}
              <a href="/consultas" className="text-primary-onDark underline">
                Minhas consultas
              </a>
              , ou falar com o consultório pelo WhatsApp.
            </p>
            <a className="btn-pill-primary mt-8 inline-flex" href="/consultas">
              Ver minhas consultas
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      {/* Global nav mock — preto puro, 44px */}
      <div className="global-nav" aria-hidden />

      {/* Sub-nav frosted — 52px */}
      <header className="sub-nav-frosted sticky top-0 z-10">
        <div className="mx-auto flex h-[52px] max-w-2xl items-center justify-between px-6">
          <span className="text-caption-strong text-ink">Dra. Priscila</span>
          <div className="flex items-center gap-4">
            <a
              href="/consultas"
              className="text-caption text-ink-muted-48 hover:text-ink"
            >
              Minhas consultas
            </a>
            <span className="text-fine-print text-ink-muted-48 nums-tabular">
              {maskPhone(patient.phoneE164)}
            </span>
          </div>
        </div>
      </header>

      {/* Hero — identidade (parchment) */}
      <section className="bg-parchment">
        <div className="mx-auto max-w-2xl px-6 py-12 text-center sm:py-section">
          <h1 className="text-display-md text-ink tracking-display">
            Agende sua consulta
          </h1>
          <p className="mx-auto mt-3 max-w-md text-body text-ink-muted-48">
            Estamos usando seu telefone como identificação. Preencha seus dados
            e escolha um horário disponível nos próximos dias.
          </p>
        </div>
      </section>

      {/* Tile escuro — Seus dados */}
      <section className="bg-tile-1">
        <div className="mx-auto max-w-2xl px-6 py-[64px]">
          <h2 className="text-tagline text-white tracking-tagline">
            1. Seus dados
          </h2>
          <p className="mt-2 text-body text-body-muted">
            Usamos essas informações para confirmar sua consulta.
          </p>
          <div className="mt-6 grid gap-4">
            <div>
              <label className="label text-white" htmlFor="name">
                Nome completo
              </label>
              <input
                id="name"
                name="name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                minLength={2}
                maxLength={120}
                placeholder="Como você se chama"
              />
            </div>
            <div>
              <label className="label text-white" htmlFor="health_plan">
                Plano de saúde
              </label>
              <select
                id="health_plan"
                name="health_plan"
                className="input"
                value={healthPlan}
                onChange={(e) => setHealthPlan(e.target.value)}
                required
              >
                <option value="" disabled>
                  Selecione seu plano
                </option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Tile claro — Escolha o dia */}
      <section className="bg-canvas">
        <div className="mx-auto max-w-2xl px-6 py-[64px]">
          <h2 className="text-tagline text-ink tracking-tagline">
            2. Escolha o dia
          </h2>
          <p className="mt-2 text-body text-ink-muted-48">
            Mostramos apenas os próximos dias com horários livres.
          </p>

          {loading && (
            <p className="mt-6 text-body text-ink-muted-48">
              Carregando disponibilidade…
            </p>
          )}

          {error && (
            <p className="mt-6 text-body text-rose-500" role="alert">
              {error}
            </p>
          )}

          {!loading && !error && days.length === 0 && (
            <p className="mt-6 text-body text-ink-muted-48">
              Não há horários livres nos próximos dias. Fale com o consultório
              pelo WhatsApp para encaixe em outra data.
            </p>
          )}

          {days.length > 0 && (
            <div className="mt-6 -mx-6 flex gap-3 overflow-x-auto px-6 pb-2">
              {days.map((d) => {
                const date = parseISO(d.date);
                const isSelected = selectedDate === d.date;
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => {
                      setSelectedDate(d.date);
                      setSelectedSlot(null);
                    }}
                    className={
                      isSelected
                        ? "btn-pill-selected shrink-0 flex-col gap-0 px-5 py-3 h-auto min-h-[64px]"
                        : "btn-pill-ghost shrink-0 flex-col gap-0 px-5 py-3 h-auto min-h-[64px] border-hairline text-ink"
                    }
                  >
                    <span className="text-fine-print uppercase tracking-tight text-ink-muted-48">
                      {WEEKDAYS_SHORT[date.getDay()]}
                    </span>
                    <span className="text-tagline nums-tabular">
                      {format(date, "dd", { locale: ptBR })}
                    </span>
                    <span className="text-fine-print text-ink-muted-48">
                      {d.slots.length} livre{d.slots.length === 1 ? "" : "s"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Tile parchment — Escolha o horário (aparece após selecionar o dia) */}
      {selectedDay && (
        <section className="bg-parchment">
          <div className="mx-auto max-w-2xl px-6 py-[64px]">
            <h2 className="text-tagline text-ink tracking-tagline">
              3. Escolha o horário
            </h2>
            <p className="mt-2 text-body text-ink-muted-48">
              {format(parseISO(selectedDay.date), "EEEE, dd 'de' MMMM", {
                locale: ptBR,
              })}
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {selectedDay.slots.map((s) => {
                const isSelected = selectedSlot === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSelectedSlot(s)}
                    className={
                      isSelected
                        ? "btn-pill-selected px-3 py-3 h-auto min-h-[48px]"
                        : "btn-pill-ghost px-3 py-3 h-auto min-h-[48px] border-hairline text-ink"
                    }
                  >
                    <span className="nums-tabular">{s}</span>
                  </button>
                );
              })}
            </div>

            {conflict && (
              <p className="mt-4 text-body text-amber-700" role="alert">
                {conflict}
              </p>
            )}
          </div>
        </section>
      )}

      {/* Tile escuro — Confirmar */}
      <section className="bg-tile-1">
        <div className="mx-auto max-w-2xl px-6 py-[64px] text-center">
          {selectedDay && selectedSlot ? (
            <>
              <h2 className="text-tagline text-white tracking-tagline">
                4. Confirmar
              </h2>
              <p className="mx-auto mt-2 max-w-md text-body text-body-muted">
                {name.trim() || "—"} ·{" "}
                {plans.find((p) => p.id === healthPlan)?.label ?? "—"}
                <br />
                {format(parseISO(selectedDay.date), "dd 'de' MMMM", {
                  locale: ptBR,
                })}{" "}
                · <span className="nums-tabular">{selectedSlot}</span>
              </p>
              <button
                type="button"
                className="btn-pill-primary mt-8"
                onClick={confirm}
                disabled={!canConfirm}
              >
                {submitting ? "Confirmando…" : "Confirmar agendamento"}
              </button>
            </>
          ) : (
            <>
              <h2 className="text-tagline text-white tracking-tagline">
                4. Confirmar
              </h2>
              <p className="mx-auto mt-2 max-w-md text-body text-body-muted">
                Preencha seus dados, escolha o dia e o horário para liberar a
                confirmação.
              </p>
              <button
                type="button"
                className="btn-dark-utility mt-8"
                disabled
                aria-disabled
              >
                Confirmar agendamento
              </button>
            </>
          )}
        </div>
      </section>

      {/* Footer */}
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
