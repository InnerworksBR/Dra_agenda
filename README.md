# Agendamento — Dra. Priscila

Portal de agendamento da Dra. Priscila em **Next.js 14 (App Router) + TypeScript + Prisma + Google Calendar**.

Sem login e sem senha: o n8n solicita um link mágico por API e o paciente abre o link para escolher um horário disponível em até 7 dias.

## Arquitetura

```
n8n ──► POST /api/v1/magic-links ──► emite booking_url ──► WhatsApp
Paciente ──► GET /a/[token] ──► cookie HttpOnly ──► /agendar
/agendar ──► GET /api/v1/availability ──► Google Calendar (fonte da verdade)
/agendar ──► POST /api/v1/appointments ──► cria evento no Google Calendar
```

- **Banco:** Postgres via Prisma (`patients`, `magic_links`, `services`, `appointments`, `audit_events`, `idempotency_keys`).
- **Calendário:** Google Calendar (Service Account). Provider de dev faz fallback em memória.
- **Sessão:** `iron-session` com cookie HttpOnly + SameSite=Lax + Secure em produção.
- **Tokens:** opacos (256 bits), armazenados como HMAC-SHA-256 + segredo de servidor.

## Setup local

```bash
cp .env.example .env
# preencher DATABASE_URL, N8N_API_SECRET, MAGIC_LINK_HASH_SECRET, SESSION_SECRET,
# GOOGLE_CALENDAR_ID, GOOGLE_CALENDAR_CREDENTIALS

npm install
npx prisma migrate deploy   # ou migrate dev no primeiro start
npm run seed                # cria serviços padrão
npm run dev
```

Sem credenciais Google o app sobe com um **DevFallbackCalendarProvider** que só persiste em memória — útil para UI, mas o evento não aparece em nenhum calendário real.

## Endpoints

| Método | Rota                       | Auth                | Descrição                                      |
|--------|----------------------------|---------------------|------------------------------------------------|
| POST   | `/api/v1/magic-links`      | Bearer n8n          | Emite link mágico (idempotente via header).   |
| POST   | `/api/v1/magic-links/:id/revoke` | Bearer n8n    | Revoga link antes do vencimento.               |
| GET    | `/a/:token`                | público             | Valida token, abre sessão, redireciona.       |
| GET    | `/api/v1/availability`     | sessão de paciente  | Devolve 7 dias com slots livres.              |
| POST   | `/api/v1/appointments`     | sessão de paciente  | Confirma slot (revalida no Google).           |
| POST   | `/api/v1/patients/me`      | sessão de paciente  | Salva nome + plano (primeiro acesso).         |

## Contrato n8n

```jsonc
POST /api/v1/magic-links
Authorization: Bearer <N8N_API_SECRET>
Idempotency-Key: <uuid>          // opcional
Content-Type: application/json

{
  "phone": "+5511999999999",
  "patient_name": "Maria Silva",   // opcional
  "service_id": "consulta-inicial",// opcional
  "conversation_id": "wa_abc123",  // opcional
  "source": "whatsapp"             // opcional
}
```

Resposta 201:

```json
{
  "success": true,
  "patient_id": "pat_01J...",
  "magic_link_id": "ml_01J...",
  "booking_url": "https://.../a/8xK...",
  "expires_at": "2026-09-11T03:15:00Z"
}
```

## Política de magic links

- **Entropia:** 256 bits (32 bytes base64url).
- **Hash:** `HMAC-SHA256(token, MAGIC_LINK_HASH_SECRET)` — segredo rotacionável, separado do `N8N_API_SECRET` e do `SESSION_SECRET`.
- **Validade:** configurável (`MAGIC_LINK_TTL_MINUTES`, padrão 30 min).
- **Reuso:** cada nova emissão revoga links ativos anteriores do mesmo `(paciente, serviço, conversa)`.
- **Auditoria:** `magic_link.created`, `magic_link.opened`, `magic_link.expired_attempt`, `magic_link.invalid_attempt`, `magic_link.revoked`, `appointment.created`, `appointment.conflict`, `n8n.unauthorized`, `n8n.rate_limited`.

## Concorrência no agendamento

A confirmação passa por:

1. Re-consulta `freebusy` no Google Calendar para o slot pontual.
2. `INSERT` no Postgres com constraint única em `(starts_at, service_id)`.
3. Falha do Google → 503 (AC-18).
4. Falha do constraint → 409 `SLOT_UNAVAILABLE` e o frontend recarrega a agenda.

## Segurança

- HTTPS obrigatório em produção; cookies `Secure`.
- CSRF: o POST de appointments só é aceito com sessão válida; cookies SameSite=Lax bloqueiam requests cross-site básicos.
- Tokens brutos **nunca** persistidos nem logados; mascaramento do telefone em logs.
- Headers `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` mínimo.
- Rate limit por credencial n8n (`RATE_LIMIT_N8N_PER_MINUTE`) e por IP público (`RATE_LIMIT_PUBLIC_PER_MINUTE`).
- Variáveis sensíveis validadas no boot via Zod — falha rápido se faltarem.

## Deploy

### Visão geral

O app é containerizado em uma imagem Node 20 Alpine multi-stage (Next.js `output: 'standalone'`, ~150MB). O Postgres roda no mesmo host via `docker-compose.yml`, em um volume nomeado para persistência. O entrypoint do container aplica migrations e roda o seed automaticamente em todo start — idempotente.

### Local (desenvolvimento)

```bash
cp .env.example .env
# preencher as variáveis (incluindo POSTGRES_PASSWORD)
docker compose up --build
```

A app sobe em `http://localhost:3000`. O entrypoint aplica migrations e seed antes de iniciar o Next.

### Produção no Dokploy

1. **Subir o código para GitHub/GitLab.** Crie um repo vazio e faça push da branch `main`. O Dokploy puxa do remoto.

2. **Provisionar o Postgres no Dokploy.** Em "Databases" crie um Postgres 16. Anote `host`, `port`, `user`, `password`, `database`. Alternativamente, use o `postgres` deste `docker-compose.yml` em outro serviço Dokploy.

3. **Criar a aplicação.** Em "Projects" > "New Service" > "App":
   - Source: Git
   - Build method: `Dockerfile`
   - Port: `3000`

4. **Configurar env vars** no painel do Dokploy (não comite `.env` no repo). Todas as de `.env.example` exceto `POSTGRES_*`:
   - `APP_BASE_URL=https://seu-dominio.com`
   - `N8N_API_SECRET=...`
   - `MAGIC_LINK_HASH_SECRET=...`
   - `SESSION_SECRET=...`
   - `DATABASE_URL=postgresql://user:pass@host:5432/db`
   - `GOOGLE_CALENDAR_ID=...`
   - `GOOGLE_CALENDAR_CREDENTIALS={"type":"service_account",...}` (JSON inline)
   - `GOOGLE_CALENDAR_TIMEZONE=America/Sao_Paulo`
   - demais opcionais conforme necessário
   - `NODE_ENV=production`

5. **Domínio + Traefik.** Dokploy gera HTTPS automático via Traefik. Aponte o domínio para o IP do VPS e configure o service no painel.

6. **Deploy.** Dokploy builda a imagem, sobe o container, o entrypoint aplica migrations e seed. Acompanhe nos logs do painel.

### Backup do Postgres

Manual:

```bash
docker exec dra_priscila_pg pg_dump -U dra dra_priscila | gzip > backup-$(date +%F).sql.gz
```

Restaurar:

```bash
gunzip < backup-X.sql.gz | docker exec -i dra_priscila_pg psql -U dra dra_priscila
```

Para automatizar, agende um cron no VPS:

```cron
0 3 * * * docker exec dra_priscila_pg pg_dump -U dra dra_priscila | gzip > /backups/dra-$(date +\%F).sql.gz
```

### Multi-instância

A imagem atual guarda rate limit em memória (variáveis `RATE_LIMIT_*`). Para rodar múltiplos containers atrás de um load balancer, migre o rate limit para Redis/Upstash — ver seção Roadmap.

## Testes

```bash
npm run test
```

Cobre normalização de telefone, tokens, e o cálculo de disponibilidade (incluindo pulo de dias cheios e limite de busca).

## Observabilidade

- Logs de aplicação só com identificadores opacos (`patient_id`, `magic_link_id`); telefone é mascarado.
- Métricas recomendadas (a instrumentar): taxa de emissão, conversão link→agendamento, conflitos de slot, erros 5xx do Google Calendar.

## Roadmap

- Painel administrativo com cancelamento e remarcação.
- Webhook opcional ao n8n após `appointment.created`.
- Migração de rate limit em memória para Redis/Upstash em ambiente multi-instância.
- Migração de autenticação n8n para HMAC/mTLS.

---

Desenvolvido conforme PRD v1.1 — 11 de setembro de 2026.
