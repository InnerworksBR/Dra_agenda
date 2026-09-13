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

  /**
   * Lista eventos confirmados na janela [timeMin, timeMax]. Usado pelo cron
   * de sync (/api/v1/cron/sync-calendar) pra puxar eventos do Google e
   * espelhar no banco. Retorna apenas metadados (id, summary, start, end,
   * description). Lança CalendarUnavailableError em falha de transporte.
   */
  listEvents(opts: { timeMin: Date; timeMax: Date }): Promise<
    Array<{
      externalEventId: string;
      summary: string;
      description: string | null;
      startsAt: Date;
      endsAt: Date;
      status: string;
    }>
  >;
};
