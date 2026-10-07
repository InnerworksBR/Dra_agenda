import { authorizeN8n } from '@/lib/magic-links/service';
import { apiError, apiOk } from '@/lib/api/response';
import { HEALTH_PLANS } from '@/lib/patients/health-plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lista os planos atendidos pela Dra. Priscila para consulta do agente n8n. */
export async function GET(req: Request): Promise<Response> {
  try {
    await authorizeN8n(req);
  } catch {
    return apiError(401, 'UNAUTHORIZED', 'Credencial inválida');
  }

  return apiOk({ health_plans: HEALTH_PLANS });
}
