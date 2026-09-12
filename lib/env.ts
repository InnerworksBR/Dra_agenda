// Variáveis de ambiente validadas no carregamento (Zod).
// Falhar cedo protege o processo inteiro.

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

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Falha fatal com mensagem legível — chamada no boot do Next em cada cold start.
  console.error('Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
  throw new Error('Configuração de ambiente inválida. Verifique .env e a seção 9.2 do PRD.');
}

export const env = parsed.data;
