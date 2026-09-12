// Tipos do provider de calendário. Mantém a UI/rotas agnósticas do
// fornecedor (hoje Google; amanhã poderia ser Outlook, Cal.com etc).

export type BusyInterval = {
  start: Date;
  end: Date;
  // opcional, para diagnóstico
  source?: 'google' | 'manual' | 'fallback';
};

export type CalendarProvider = {
  /**
   * Retorna todos os intervalos ocupados na janela [from, to].
   * Lança CalendarUnavailableError em falha de transporte que não permita
   * decidir disponibilidade com segurança.
   */
  getBusyIntervals(opts: { from: Date; to: Date }): Promise<BusyInterval[]>;

  /**
   * Cria um evento. Lança SlotUnavailableError se já houver evento
   * conflitante criado em corrida. Outros erros propagam.
   */
  createEvent(opts: {
    startsAt: Date;
    endsAt: Date;
    summary: string;
    description?: string;
    attendees?: { email: string; displayName?: string }[];
  }): Promise<{ externalEventId: string }>;

  /**
   * Re-verifica se o slot ainda está livre. Equivalente a um
   * getBusyIntervals reduzido ao intervalo pontual.
   */
  isSlotFree(opts: { startsAt: Date; endsAt: Date }): Promise<boolean>;

  /**
   * Remove um evento pelo externalEventId. Lança CalendarUnavailableError
   * em falha de transporte; idempotente no sentido de que um erro 404/410
   * do calendário é tolerado (retorna sem throw).
   */
  deleteEvent(externalEventId: string): Promise<void>;
};
