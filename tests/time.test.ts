import { describe, it, expect } from 'vitest';
import { formatPtBrDate, formatPtBrTime } from '@/lib/time/sao-paulo';

describe('formatPtBrDate / formatPtBrTime', () => {
  it('formata data no fuso America/Sao_Paulo', () => {
    // 2026-09-15 16:15 UTC = 2026-09-15 13:15 SP (UTC-3, sem DST no Brasil).
    const d = new Date('2026-09-15T16:15:00Z');
    expect(formatPtBrDate(d)).toBe('15/09/2026');
    expect(formatPtBrTime(d)).toBe('13:15');
  });

  it('formata hora cedo da manhã em SP mesmo com data UTC do dia anterior', () => {
    // 2026-09-15 02:30 UTC = 2026-09-14 23:30 SP.
    const d = new Date('2026-09-15T02:30:00Z');
    expect(formatPtBrDate(d)).toBe('14/09/2026');
    expect(formatPtBrTime(d)).toBe('23:30');
  });

  it('formata meia-noite em SP como 00:00', () => {
    // 2026-09-15 03:00 UTC = 2026-09-15 00:00 SP.
    const d = new Date('2026-09-15T03:00:00Z');
    expect(formatPtBrDate(d)).toBe('15/09/2026');
    expect(formatPtBrTime(d)).toBe('00:00');
  });

  it('formata com padding zeros à esquerda', () => {
    // 2026-09-15 11:05 UTC = 2026-09-15 08:05 SP.
    const d = new Date('2026-09-15T11:05:00Z');
    expect(formatPtBrDate(d)).toBe('15/09/2026');
    expect(formatPtBrTime(d)).toBe('08:05');
  });
});
