// Lista de planos de saúde suportados — fonte única de verdade.
// Usado em todos os lugares que precisam da lista (UI, validação backend).
// Manter em ordem alfabética pelo label para a UI.

import { z } from 'zod';

export const HEALTH_PLAN_IDS = [
  'amil',
  'bb-dental',
  'bradesco-dental',
  'metlife',
  'odontoprev',
  'particular',
  'sulamerica',
  'transmontano-dentalpar',
  'unimed',
  'uniodonto',
] as const;

export type HealthPlanId = (typeof HEALTH_PLAN_IDS)[number];

const HEALTH_PLANS_RAW: Array<{ id: HealthPlanId; label: string }> = [
  { id: 'particular', label: 'Particular' },
  { id: 'odontoprev', label: 'Odontoprev' },
  { id: 'bradesco-dental', label: 'Bradesco Dental' },
  { id: 'bb-dental', label: 'BB Dental' },
  { id: 'unimed', label: 'Unimed' },
  { id: 'uniodonto', label: 'Uniodonto' },
  { id: 'sulamerica', label: 'Sulamerica' },
  { id: 'amil', label: 'Amil' },
  { id: 'metlife', label: 'MetLife' },
  { id: 'transmontano-dentalpar', label: 'Transmontano/Dentalpar' },
];

export const HEALTH_PLANS: Array<{ id: HealthPlanId; label: string }> =
  HEALTH_PLANS_RAW.slice().sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

export const healthPlanSchema = z.enum(HEALTH_PLAN_IDS);

export const healthPlanLabel = (id: string | null | undefined): string => {
  if (!id) return '';
  const plan = HEALTH_PLANS.find((p) => p.id === id);
  return plan?.label ?? id;
};
