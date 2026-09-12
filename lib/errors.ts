// Erros tipados para as camadas de negócio. Permitem que rotas devolvam
// respostas HTTP sem precisar conhecer a implementação.

export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export class SlotUnavailableError extends ServiceError {
  constructor(meta?: Record<string, unknown>) {
    super(409, 'SLOT_UNAVAILABLE', 'Horário acabou de ser ocupado. Escolha outro.', meta);
  }
}

export class InvalidInputError extends ServiceError {
  constructor(code: string, message: string) {
    super(400, code, message);
  }
}

export class UnauthorizedError extends ServiceError {
  constructor(message = 'Não autorizado') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class NotFoundError extends ServiceError {
  constructor(message = 'Recurso não encontrado') {
    super(404, 'NOT_FOUND', message);
  }
}

export class CalendarUnavailableError extends ServiceError {
  constructor(message = 'Agenda temporariamente indisponível. Tente novamente em instantes.') {
    super(503, 'CALENDAR_UNAVAILABLE', message);
  }
}

export class CancellationWindowError extends ServiceError {
  constructor(message = 'Cancelamento só é permitido até 2h antes da consulta.') {
    super(409, 'CANCELLATION_WINDOW', message);
  }
}

export class AppointmentNotOwnedError extends ServiceError {
  constructor(message = 'Consulta não pertence ao paciente autenticado.') {
    super(403, 'APPOINTMENT_NOT_OWNED', message);
  }
}

export class AppointmentNotCancellableError extends ServiceError {
  constructor(message = 'Esta consulta não pode ser cancelada pelo app.') {
    super(409, 'APPOINTMENT_NOT_CANCELLABLE', message);
  }
}
