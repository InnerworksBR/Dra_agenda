import { describe, it, expect } from 'vitest';
import {
  HEALTH_PLANS,
  HEALTH_PLAN_IDS,
  healthPlanSchema,
  healthPlanLabel,
  type HealthPlanId,
} from '@/lib/patients/health-plans';

describe('HEALTH_PLANS', () => {
  it('tem 7 planos', () => {
    expect(HEALTH_PLANS).toHaveLength(7);
  });

  it('IDs e labels estão em ordem alfabética pelo label pt-BR', () => {
    const labels = HEALTH_PLANS.map((p) => p.label);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    expect(labels).toEqual(sorted);
  });

  it('cada label tem um id correspondente em HEALTH_PLAN_IDS', () => {
    const ids = new Set<string>(HEALTH_PLAN_IDS);
    for (const p of HEALTH_PLANS) {
      expect(ids.has(p.id)).toBe(true);
    }
  });

  it('todos os ids aparecem exatamente uma vez', () => {
    const seen = new Set<HealthPlanId>();
    for (const p of HEALTH_PLANS) {
      expect(seen.has(p.id)).toBe(false);
      seen.add(p.id);
    }
    expect(seen.size).toBe(HEALTH_PLANS.length);
  });
});

describe('healthPlanSchema', () => {
  it('aceita cada um dos 7 ids válidos', () => {
    for (const id of HEALTH_PLAN_IDS) {
      expect(healthPlanSchema.safeParse(id).success).toBe(true);
    }
  });

  it('rejeita valores legados (particular, amil, bradesco-saude, etc.)', () => {
    const legados = ['particular', 'amil', 'bradesco-saude', 'sulamerica', 'unimed', 'hapvida', 'notredame', 'outros', 'Particular'];
    for (const id of legados) {
      expect(healthPlanSchema.safeParse(id).success).toBe(false);
    }
  });

  it('rejeita string vazia e id desconhecido', () => {
    expect(healthPlanSchema.safeParse('').success).toBe(false);
    expect(healthPlanSchema.safeParse('xyz').success).toBe(false);
  });
});

describe('healthPlanLabel', () => {
  it('retorna o label bonito para id conhecido', () => {
    expect(healthPlanLabel('bb-dental')).toBe('BB Dental');
    expect(healthPlanLabel('uniodonto')).toBe('Uniodonto');
  });

  it('retorna string vazia para null/undefined', () => {
    expect(healthPlanLabel(null)).toBe('');
    expect(healthPlanLabel(undefined)).toBe('');
    expect(healthPlanLabel('')).toBe('');
  });

  it('retorna o próprio id quando não está na lista (fallback)', () => {
    expect(healthPlanLabel('particular')).toBe('particular');
  });
});
