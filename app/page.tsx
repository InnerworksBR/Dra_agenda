// Landing — galeria de tiles full-bleed alternando luz e escuro.
// Tom Apple: nada de cards arredondados com sombra; a mudança de superfície
// é o divisor visual. Tipografia em display-lg com tracking negativo.

import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen">
      {/* Hero — branco */}
      <section className="bg-canvas">
        <div className="mx-auto max-w-[980px] px-6 py-section text-center">
          <span className="pill">Agendamento sem senha</span>
          <h1 className="mt-4 text-display-md sm:text-hero-display text-ink tracking-display">
            Dra. Priscila
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-body text-ink-muted-48">
            Para agendar uma consulta, abra o link que você recebeu pelo WhatsApp.
            Ele é de uso pessoal e temporário — não compartilhe.
          </p>
        </div>
      </section>

      {/* Tile escuro — “Como funciona” */}
      <section className="bg-tile-1">
        <div className="mx-auto max-w-[980px] px-6 py-[64px] text-center">
          <h2 className="text-tagline text-white tracking-tagline">Como funciona</h2>
          <p className="mx-auto mt-2 max-w-md text-body text-body-muted">
            Em quatro passos simples, sem login e sem aplicativo.
          </p>
          <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { n: '1', t: 'Abra o link', d: 'O link mágico autentica você sem login.' },
              { n: '2', t: 'Escolha o dia', d: 'Mostramos os próximos dias com horários livres.' },
              { n: '3', t: 'Escolha o horário', d: 'Selecione um dos slots disponíveis.' },
              { n: '4', t: 'Pronto!', d: 'Você recebe a confirmação na hora.' },
            ].map((step) => (
              <div key={step.n} className="text-left">
                <span className="text-caption text-primary-onDark">{step.n}</span>
                <h3 className="mt-1 text-body-strong text-white">{step.t}</h3>
                <p className="mt-1 text-caption text-body-muted">{step.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tile parchment — utilidade */}
      <section className="bg-parchment">
        <div className="mx-auto max-w-[980px] px-6 py-[64px] text-center">
          <h2 className="text-tagline text-ink tracking-tagline">Não recebeu o link?</h2>
          <p className="mx-auto mt-2 max-w-md text-body text-ink-muted-48">
            Solicite um novo pelo WhatsApp do consultório. O link anterior será
            cancelado por segurança.
          </p>
          <Link
            className="btn-pill-ghost mt-8 inline-flex"
            href="/link-invalido"
          >
            Entendi
          </Link>
        </div>
      </section>

      {/* Footer dark */}
      <footer className="bg-black">
        <div className="mx-auto max-w-[980px] px-6 py-[48px]">
          <p className="text-fine-print text-ink-muted-48">
            Copyright © 2026 Dra. Priscila. Todos os direitos reservados.
          </p>
          <p className="mt-2 text-fine-print text-ink-muted-48">
            Portal de agendamento protegido por link mágico. Não compartilhe seu link.
          </p>
        </div>
      </footer>
    </main>
  );
}
