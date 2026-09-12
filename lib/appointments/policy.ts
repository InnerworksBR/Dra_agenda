// Política de cancelamento. Centraliza a janela mínima para que tanto o
// backend (assertCancellable) quanto a UI (UIWindowHint) sigam a mesma regra.

import { CancellationWindowError } from '@/lib/errors';

export const CANCELLATION_WINDOW_HOURS = 2;

/**
 * Lança CancellationWindowError se o appointment está a menos de
 * CANCELLATION_WINDOW_HOURS do início. Usado pelo service antes de cancelar.
 */
export function assertCancellable(startsAt: Date, now: Date = new Date()): void {
  const limit = new Date(startsAt.getTime() - CANCELLATION_WINDOW_HOURS * 60 * 60 * 1000);
  if (now.getTime() > limit.getTime()) {
    throw new CancellationWindowError();
  }
}

/** Helper para a UI desabilitar o botão "Cancelar" sem importar erros. */
export function isWithinCancellationWindow(startsAt: Date, now: Date = new Date()): boolean {
  const limit = new Date(startsAt.getTime() - CANCELLATION_WINDOW_HOURS * 60 * 60 * 1000);
  return now.getTime() > limit.getTime();
}
