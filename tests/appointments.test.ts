import { describe, expect, it } from 'vitest';
import { addHours, subMinutes, addMinutes } from 'date-fns';

// Imports dinâmicos para garantir env carregada antes.
process.env.MAGIC_LINK_HASH_SECRET ||= 'test-hash-secret-1234567890abcdef';
process.env.N8N_API_SECRET ||= 'test-n8n-secret-1234567890';
process.env.SESSION_SECRET ||= 'test-session-secret-1234567890abcdef-32';
process.env.DATABASE_URL ||= 'postgresql://localhost/test';
process.env.GOOGLE_CALENDAR_ID ||= 'primary';
process.env.GOOGLE_CALENDAR_CREDENTIALS ||= '{"type":"service_account"}';
process.env.APP_BASE_URL ||= 'http://localhost:3000';

const { CANCELLATION_WINDOW_HOURS, assertCancellable, isWithinCancellationWindow } =
  await import('@/lib/appointments/policy');
const { CancellationWindowError, AppointmentNotCancellableError, AppointmentNotOwnedError } =
  await import('@/lib/errors');

describe('cancellation policy', () => {
  const now = new Date('2026-09-11T12:00:00Z');

  it('permite cancelar quando restam mais de 2h', () => {
    const startsAt = addHours(now, 3);
    expect(() => assertCancellable(startsAt, now)).not.toThrow();
    expect(isWithinCancellationWindow(startsAt, now)).toBe(false);
  });

  it('permite cancelar exatamente em 2h (borda aberta)', () => {
    const startsAt = addHours(now, CANCELLATION_WINDOW_HOURS);
    expect(isWithinCancellationWindow(startsAt, now)).toBe(false);
    expect(() => assertCancellable(startsAt, now)).not.toThrow();
  });

  it('bloqueia cancelar a 1min antes da janela', () => {
    const startsAt = subMinutes(addHours(now, CANCELLATION_WINDOW_HOURS), 1);
    expect(isWithinCancellationWindow(startsAt, now)).toBe(true);
    expect(() => assertCancellable(startsAt, now)).toThrow(CancellationWindowError);
  });

  it('bloqueia cancelar appointment que já passou', () => {
    const startsAt = subMinutes(now, 30);
    expect(() => assertCancellable(startsAt, now)).toThrow(CancellationWindowError);
  });

  it('CancellationWindowError tem code CANCELLATION_WINDOW e status 409', () => {
    try {
      assertCancellable(addMinutes(now, 30), now);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CancellationWindowError);
      expect((e as { code: string }).code).toBe('CANCELLATION_WINDOW');
      expect((e as { status: number }).status).toBe(409);
    }
  });

  it('AppointmentNotCancellableError existe e tem code', () => {
    const err = new AppointmentNotCancellableError();
    expect(err.code).toBe('APPOINTMENT_NOT_CANCELLABLE');
    expect(err.status).toBe(409);
  });

  it('AppointmentNotOwnedError tem status 403', () => {
    const err = new AppointmentNotOwnedError();
    expect(err.code).toBe('APPOINTMENT_NOT_OWNED');
    expect(err.status).toBe(403);
  });
});
