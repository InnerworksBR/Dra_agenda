// Variáveis de ambiente validadas no carregamento (Zod).
// Em runtime a falha é fatal. Em build time (next build) o módulo é
// importado pelo Next para coleta de metadata e o Dokploy não injeta envs
// via ARG por padrão — então toleramos ausências para não quebrar o build.
// Os placeholders não devem ser usados: o container só sobe em runtime,
// onde o Zod falha alto se faltar algo real.

import { z } from 'zod';

const schema = z.object({
  APP_BASE_URL: z.string().url(),
  N8N_API_SECRET: z.string().min(16, 'N8N_API_SECRET precisa ter no mínimo 16 caracteres'),
  MAGIC_LINK_HASH_SECRET: z.string().min(16),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET precisa ter no mínimo 32 caracteres'),
  DATABASE_URL: z.string().min(1),
  GOOGLE_CALENDAR_ID: z.string().min(1),
  GOOGLE_CALENDAR_CREDENTIALS: z.string().min(1),
  GOOGLE_CALENDAR_TIMEZONE: z.string().default('America/Sao_Paulo'),
  SCHEDULING_RULES_JSON: z.string().optional().default(''),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  DEFAULT_SERVICE_ID: z.string().default('consulta-inicial'),
  RATE_LIMIT_PUBLIC_PER_MINUTE: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_N8N_PER_MINUTE: z.coerce.number().int().positive().default(120),
  // URL do webhook de notificações no n8n (cancelamento/remarcação). Vazio =
  // notificações desabilitadas — o notifier apenas loga sem chamar ninguém.
  WEBHOOK_NOTIFICATIONS_URL: z
    .string()
    .refine((v) => v === '' || /^https?:\/\/.+/.test(v), 'URL inválida')
    .default(''),
  // URL do webhook de confirmações no n8n (APPOINTMENT_CONFIRMED). Vazio =
  // notificações de confirmação desabilitadas. Separado do de notificações
  // porque são workflows diferentes (um manda "consulta confirmada", o outro
  // "cancelada" / "remarcada").
  WEBHOOK_CONFIRMATION_URL: z
    .string()
    .refine((v) => v === '' || /^https?:\/\/.+/.test(v), 'URL inválida')
    .default(''),
  // URL do webhook n8n que recebe o POST do backend com a lista de lembretes
  // a enviar às 20h. Aponta para o node Webhook inicial de
  // docs/n8n-workflow-reminder-20h.json. Vazio = lembretes desabilitados
  // (o cron retorna 200 com total=0).
  N8N_REMINDER_WEBHOOK_URL: z
    .string()
    .refine((v) => v === '' || /^https?:\/\/.+/.test(v), 'URL inválida')
    .default(''),
  // Chave compartilhada com o n8n para autenticar webhooks inbound da
  // Evolution API. O node HTTP Request do workflow inbound manda no header
  // `apikey`. Não usa N8N_API_SECRET porque essa chave pode ser exposta
  // no painel da Evolution se você adicionar outra fonte depois.
  EVOLUTION_INBOUND_SECRET: z
    .string()
    .refine(
      (v) => v === '' || v.length >= 8,
      'EVOLUTION_INBOUND_SECRET deve ter no mínimo 8 caracteres quando setado',
    )
    .default(''),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

const parsed = schema.safeParse(process.env);

const placeholders = {
  APP_BASE_URL: 'http://localhost:3000',
  N8N_API_SECRET: 'build-time-placeholder-min-16',
  MAGIC_LINK_HASH_SECRET: 'build-time-placeholder-min-16',
  SESSION_SECRET: 'build-time-placeholder-must-have-at-least-32-chars',
  DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
  GOOGLE_CALENDAR_ID: 'build-time',
  GOOGLE_CALENDAR_CREDENTIALS: '{"type":"service_account"}',
  GOOGLE_CALENDAR_TIMEZONE: 'America/Sao_Paulo',
  SCHEDULING_RULES_JSON: '',
  MAGIC_LINK_TTL_MINUTES: 30,
  DEFAULT_SERVICE_ID: 'consulta-inicial',
  RATE_LIMIT_PUBLIC_PER_MINUTE: 20,
  RATE_LIMIT_N8N_PER_MINUTE: 120,
  WEBHOOK_NOTIFICATIONS_URL: '',
  WEBHOOK_CONFIRMATION_URL: '',
  N8N_REMINDER_WEBHOOK_URL: '',
  EVOLUTION_INBOUND_SECRET: '',
  NODE_ENV: 'production' as const,
};

if (!parsed.success) {
  if (isBuildPhase) {
    // eslint-disable-next-line no-console
    console.warn(
      '[env] build time: variáveis ausentes, usando placeholders. ' +
        'Defina as envs no painel do Dokploy — serão exigidas em runtime.',
    );
  } else {
    console.error('Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
    throw new Error('Configuração de ambiente inválida. Verifique .env e a seção 9.2 do PRD.');
  }
}

export const env = parsed.success ? parsed.data : placeholders;
