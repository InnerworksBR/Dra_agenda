// Tela de link inválido — tile escuro com a razão em destaque.
import Link from "next/link";

const MESSAGES: Record<string, { title: string; body: string }> = {
  invalid: {
    title: "Link inválido",
    body: "Não conseguimos reconhecer este link. Verifique se ele foi copiado por completo.",
  },
  expired: {
    title: "Link expirado",
    body: "Este link já passou do tempo válido. Solicite um novo pelo WhatsApp.",
  },
  revoked: {
    title: "Link desativado",
    body: "Este link foi cancelado por segurança. Solicite um novo pelo WhatsApp.",
  },
  consumed: {
    title: "Link já utilizado",
    body: "Este link já foi usado para concluir um agendamento.",
  },
};

export default function LinkInvalidoPage({
  searchParams,
}: {
  searchParams?: { motivo?: string };
}) {
  const motivo = searchParams?.motivo ?? "invalid";
  const info = MESSAGES[motivo] ?? MESSAGES.invalid!;

  return (
    <main className="min-h-screen">
      {/* Hero — branco */}
      <section className="bg-canvas">
        <div className="mx-auto max-w-2xl px-6 py-section text-center">
          <span className="pill">Acesso negado</span>
          <h1 className="mt-4 text-display-md text-ink tracking-display">
            {info.title}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-body text-ink-muted-48">
            {info.body}
          </p>
        </div>
      </section>

      {/* Tile escuro — call to action */}
      <section className="bg-tile-1">
        <div className="mx-auto max-w-2xl px-6 py-[64px] text-center">
          <h2 className="text-tagline text-white tracking-tagline">
            Solicite um novo link
          </h2>
          <p className="mx-auto mt-2 max-w-md text-body text-body-muted">
            Para continuar, fale com o consultório pelo WhatsApp e peça um novo
            link de agendamento.
          </p>
          <Link className="btn-pill-primary mt-8 inline-flex" href="/">
            Voltar ao início
          </Link>
        </div>
      </section>
    </main>
  );
}
