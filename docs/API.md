# DRA. PRISCILA — AGENDAMENTO

## Visão Geral

Sistema de agendamento de consultas médicas via WhatsApp, com portal web para pacientes confirmarem/remarcar/cancelar consultas. O fluxo principal é:

1. **n8n** detecta mensagem do paciente e chama a API para gerar um **Magic Link**
2. Paciente abre o link, autentica via cookie de sessão (HttpOnly)
3. Paciente seleciona slot disponível e confirma o agendamento
4. Evento criado no **Google Calendar** e persistido no banco

---

## Stack Tecnológica

| Camada         | Tecnologia                              |
|----------------|-----------------------------------------|
| **Framework**  | Next.js 14 (App Router)                 |
| **Runtime**    | Node.js ≥ 18.17                        |
| **Linguagem**  | TypeScript                              |
| **Banco**      | PostgreSQL via Prisma ORM               |
| **Cache/Sessão** | iron-session (cookies HttpOnly)       |
| **Calendário** | Google Calendar API (service account)   |
| **Validação**  | Zod                                     |
| **Automação**  | n8n (webhooks)                         |
| **Estilização**| Tailwind CSS                            |
| **Autenticação** | HMAC (magic link token) + Bearer (n8n) |

---

## Variáveis de Ambiente (`.env`)

```env
# =============================================================
# URL base pública do site
APP_BASE_URL=http://localhost:3000

# Segredo de autenticação do n8n (Bearer)
N8N_API_SECRET=troque-por-um-segredo-longo-e-aleatorio

# Segredo HMAC para hash do token do magic link
MAGIC_LINK_HASH_SECRET=troque-por-outro-segredo-longo

# Segredo para assinar cookies de sessão (iron-session)
SESSION_SECRET=troque-por-mais-um-segredo-longo-com-pelo-menos-32-chars

# String de conexão do Postgres
DATABASE_URL=postgresql://user:password@localhost:5432/dra_priscila

# Google Calendar
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_CREDENTIALS={"type":"service_account",...}
GOOGLE_CALENDAR_TIMEZONE=America/Sao_Paulo

# Regras de agendamento (JSON opcional)
SCHEDULING_RULES_JSON=

# Validade do magic link em minutos
MAGIC_LINK_TTL_MINUTES=30

# Plano padrão de fallback
DEFAULT_SERVICE_ID=consulta-inicial

# Rate limiting
RATE_LIMIT_PUBLIC_PER_MINUTE=20
RATE_LIMIT_N8N_PER_MINUTE=120

# Ambiente
NODE_ENV=development

# Webhooks n8n
WEBHOOK_NOTIFICATIONS_URL=       # Cancelamento/remarcação
WEBHOOK_CONFIRMATION_URL=        # Confirmação de agendamento
N8N_REMINDER_WEBHOOK_URL=        # Lembretes 20h

# Autenticação do webhook inbound da Evolution API
EVOLUTION_INBOUND_SECRET=
```

---

## Modelo de Dados (Prisma)

### Entidades Principais

```
Patient
├── id, phoneE164, name, healthPlan, createdAt
├── MagicLink[] (1:N)
└── Appointment[] (1:N)

MagicLink
├── id, tokenHash, expiresAt, firstOpenedAt
├── consumedAt, revokedAt, source
├── conversationId, serviceId, redirectTo
├── patientId (FK)
└── Appointment[] (1:N)

Service
├── id, name, durationMinutes, active
└── schedulingRules (JSON)
└── Appointment[] (1:N)

Appointment
├── id, patientId, magicLinkId, serviceId
├── startsAt, endsAt, status
├── externalCalendarEventId, source
└── AppointmentConfirmation[] (1:N)

AppointmentConfirmation
├── id, appointmentId, sentDay, sentAt
├── respondedAt, responseType, rawResponse
└── evolutionMessageId (unique)
```

### Status de Appointments

| Status     | Descrição                    |
|------------|------------------------------|
| `CONFIRMED` | Agendado/atual              |
| `CANCELLED`| Cancelado pelo paciente     |
| `NO_SHOW`  | Paciente não compareu        |
| `COMPLETED`| Consulta realizada           |

---

## Rotas da API (`/api/v1/...`)

### Autenticação

| Método | Rota                          | Auth              | Descrição                              |
|--------|-------------------------------|-------------------|----------------------------------------|
| POST   | `/magic-links`                | Bearer (n8n)      | Gera magic link para paciente          |
| POST   | `/magic-links/[id]/revoke`    | Bearer (n8n)      | Revoga magic link existente            |
| POST   | `/n8n/management-link`       | Bearer (n8n)      | Gera link para gestão (cancel/reschedule) |
| GET    | `/availability`                | Sessão (cookie)   | Lista slots disponíveis                |
| GET    | `/patients/me`                | Sessão (cookie)   | Retorna dados do paciente logado       |
| POST   | `/patients/me`                | Sessão (cookie)   | Atualiza nome e plano do paciente      |

### Appointments

| Método | Rota                          | Auth              | Descrição                              |
|--------|-------------------------------|-------------------|----------------------------------------|
| GET    | `/appointments`               | Sessão (cookie)   | Lista consultas do paciente            |
| POST   | `/appointments`               | Sessão (cookie)   | Confirma agendamento de um slot        |
| PATCH  | `/patients/me/identity`       | Sessão (cookie)   | Atualiza nome e/ou plano do paciente   |
| DELETE | `/appointments/[id]`          | Sessão (cookie)   | Cancela consulta (janela 2h)           |
| POST   | `/appointments/[id]/reschedule`| Sessão (cookie)  | Cancela + emite novo magic link        |

### Cron / Webhooks

| Método | Rota                          | Auth              | Descrição                              |
|--------|-------------------------------|-------------------|----------------------------------------|
| POST   | `/cron/sync-calendar`         | Bearer (n8n)      | Sincroniza Google Calendar → banco (a cada 5min) |
| POST   | `/cron/confirm-reminders`     | Bearer (n8n)      | Gera lembretes 20h para n8n           |
| POST   | `/webhooks/evolution/inbound` | API Key (Evolution) | Recebe respostas de lembretes       |
| POST   | `/appointments/[id]/respond-reminder` | Bearer (n8n) | Persiste resposta a lembrete         |

---

## Detalhamento das Rotas

### `POST /api/v1/magic-links` — Criar Magic Link

**Autenticação:** `Authorization: Bearer <N8N_API_SECRET>`

**Rate Limit:** 120 req/min por credencial n8n

**Corpo (JSON):**
```json
{
  "phone": "+5511999999999",
  "patient_name": "João Silva",
  "service_id": "consulta-inicial",
  "conversation_id": "msg-uuid-123",
  "source": "whatsapp"
}
```

**Headers recomendados:**
```
Authorization: Bearer <N8N_API_SECRET>
Idempotency-Key: <chave-unica>
Content-Type: application/json
```

**Resposta (201):**
```json
{
  "ok": true,
  "data": {
    "patient_id": "cuid...",
    "magic_link_id": "cuid...",
    "booking_url": "https://site.com/a/<token>",
    "expires_at": "2024-01-01T12:30:00.000Z"
  }
}
```

**Fluxo:**
1. Valida phone (E.164)
2. Faz upsert do Patient
3. Gera token criptográfico (32 bytes, base64url)
4. Armazena hash HMAC-SHA256 no banco
5. Revoga links ativos anteriores do mesmo paciente+contexto
6. Retorna URL pública (`/a/<token>`)

---

### `POST /api/v1/magic-links/[id]/revoke` — Revogar Magic Link

**Autenticação:** `Authorization: Bearer <N8N_API_SECRET>`

**Corpo (JSON):**
```json
{
  "reason": "Motivo da revogação"
}
```

**Resposta (200):**
```json
{ "ok": true, "data": { "revoked": true } }
```

---

### `POST /api/v1/n8n/management-link` — Link de Gestão

**Autenticação:** `Authorization: Bearer <N8N_API_SECRET>`

**Corpo (JSON):**
```json
{
  "phone": "+5511999999999",
  "intent": "cancel",
  "service_id": "consulta-inicial",
  "conversation_id": "msg-uuid-123",
  "idempotency_key": "chave-unica"
}
```

**Intents disponíveis:**

| Intent       | Redirecionamento |
|--------------|------------------|
| `mark`       | `/agendar`       |
| `cancel`     | `/consultas`     |
| `reschedule` | `/consultas`     |

**Resposta (201):**
```json
{
  "ok": true,
  "data": {
    "booking_url": "https://site.com/a/<token>",
    "expires_at": "2024-01-01T12:30:00.000Z",
    "intent": "cancel",
    "redirect_to": "/consultas"
  }
}
```

---

### `GET /api/v1/availability` — Consultar Disponibilidade

**Autenticação:** Cookie de sessão (`dra_session`)

**Query params:**
```
?from=2024-01-01T00:00:00Z  (opcional)
?to=2024-01-15T00:00:00Z     (opcional)
```

**Resposta (200):**
```json
{
  "ok": true,
  "data": {
    "timezone": "America/Sao_Paulo",
    "window_days": [
      {
        "date": "2024-01-02",
        "slots": [
          { "id": "2024-01-02T08:00", "time": "08:00", "available": true },
          { "id": "2024-01-02T08:15", "time": "08:15", "available": false }
        ]
      }
    ],
    "generated_at": "2024-01-01T10:00:00.000Z"
  }
}
```

**Fluxo:**
1. Busca ocupado do Google Calendar (freebusy)
2. Computa slots disponíveis baseado em `SCHEDULING_RULES_JSON`
3. Retorna janela de 21 dias por padrão

---

### `GET /api/v1/appointments` — Listar Consultas

**Autenticação:** Cookie de sessão (`dra_session`)

**Resposta (200):**
```json
{
  "ok": true,
  "data": {
    "appointments": [
      {
        "id": "cuid...",
        "starts_at": "2024-01-15T09:00:00.000Z",
        "ends_at": "2024-01-15T09:15:00.000Z",
        "status": "CONFIRMED",
        "service_id": "consulta-inicial",
        "service_name": "Consulta Inicial"
      }
    ]
  }
}
```

---

### `POST /api/v1/appointments` — Confirmar Agendamento

**Autenticação:** Cookie de sessão (`dra_session`)

**Corpo (JSON):**
```json
{
  "slot_id": "2024-01-15T09:00",
  "service_id": "consulta-inicial",
  "name": "João Silva",
  "health_plan": "metlife"
}
```

`health_plan` aceita apenas os IDs da lista de planos odontológicos: `bb-dental`, `bradesco-dental`, `dentalpar`, `metlife`, `previan`, `transmontano`, `uniodonto`.

**Resposta (201):**
```json
{
  "ok": true,
  "data": {
    "appointment_id": "cuid...",
    "starts_at": "2024-01-15T09:00:00.000Z",
    "ends_at": "2024-01-15T09:15:00.000Z",
    "status": "CONFIRMED",
    "service_id": "consulta-inicial"
  }
}
```

**Fluxo:**
1. Resolve slot_id → data/hora
2. Cria evento no Google Calendar
3. Persiste no banco (constraint única impede duplicação)
4. Notifica n8n via webhook (`APPOINTMENT_CONFIRMED`)

---

### `PATCH /api/v1/patients/me/identity` — Atualizar Identidade

**Autenticação:** Cookie de sessão (`dra_session`)

Salva campos de identidade (nome e/ou plano) do paciente autenticado. É chamado pelo cliente quando o input de nome perde o foco, para não perder o dado se o paciente fechar a página antes de confirmar o agendamento. Operação idempotente.

**Corpo (JSON):**
```json
{
  "name": "João Silva",
  "health_plan": "metlife"
}
```

Pelo menos um dos campos deve estar presente. `health_plan` aceita apenas os IDs da lista de planos odontológicos: `bb-dental`, `bradesco-dental`, `dentalpar`, `metlife`, `previan`, `transmontano`, `uniodonto`.

**Resposta (200):**
```json
{
  "ok": true
}
```

---

### `DELETE /api/v1/appointments/[id]` — Cancelar Consulta

**Autenticação:** Cookie de sessão (`dra_session`)

**Regras:**
- Janela de cancelamento: **2 horas** antes do início
- Status deve ser `CONFIRMED`
- Paciente precisa ser o dono

**Resposta (200):**
```json
{
  "ok": true,
  "data": {
    "appointment_id": "cuid...",
    "status": "CANCELLED",
    "calendar_warning": null
  }
}
```

---

### `POST /api/v1/appointments/[id]/reschedule` — Remarcar

**Autenticação:** Cookie de sessão (`dra_session`)

**Fluxo:**
1. Cancela appointment atual
2. Emite novo magic link herdando `conversationId` e `serviceId`
3. Retorna novo `booking_url`

**Resposta (200):**
```json
{
  "ok": true,
  "data": {
    "booking_url": "https://site.com/a/<novo-token>",
    "expires_at": "2024-01-01T12:30:00.000Z"
  }
}
```

---

### `POST /api/v1/cron/sync-calendar` — Sincronizar Google Calendar

**Autenticação:** `Authorization: Bearer <N8N_API_SECRET>`

**Trigger:** Executado pelo n8n a cada **5 minutos**

**Fluxo:**
1. Lista eventos do Google Calendar
2. Para eventos `CONFIRMED` → cria/atualiza no banco
3. Eventos ausentes → marca como `CANCELLED` (importados do Google)
4. Idempotente via `externalCalendarEventId`

---

### `POST /api/v1/cron/confirm-reminders` — Gerar Lembretes 20h

**Autenticação:** `Authorization: Bearer <N8N_API_SECRET>`

**Trigger:** Executado pelo n8n às **20h (America/Sao_Paulo)**

**Fluxo:**
1. Lista appointments nas próximas 12–24h
2. Cria `AppointmentConfirmation` (idempotente por dia)
3. Dispara webhook para n8n enviar WhatsApp com payload que já inclui
   `data` (dd/mm/aaaa) e `hora` (HH:mm) pré-formatadas em America/Sao_Paulo.
   O workflow n8n **não** deve formatar o horário localmente — usar os
   campos do payload para evitar dependência de `process.env.TZ` do Node.

**Payload enviado ao n8n:**
```json
{
  "batch_date": "2026-09-14T03:00:00.000Z",
  "reminders": [
    {
      "confirmation_id": "cuid...",
      "appointment_id": "cuid...",
      "patient_id": "cuid...",
      "patient_phone": "+5513991743380",
      "patient_name": "João Silva",
      "service_id": "consulta-inicial",
      "starts_at": "2026-09-15T16:15:00.000Z",
      "ends_at": "2026-09-15T16:30:00.000Z",
      "data": "15/09/2026",
      "hora": "13:15"
    }
  ]
}
```

**Resposta (200):**
```json
{
  "ok": true,
  "data": {
    "total": 5,
    "skipped": 2,
    "webhook_dispatched": 3
  }
}
```

---

### `POST /api/v1/webhooks/evolution/inbound` — Webhook Inbound Evolution

**Autenticação:** `apikey: <EVOLUTION_INBOUND_SECRET>`

**Corpo (JSON):**
```json
{
  "from": "5511999999999",
  "body": "sim",
  "evolutionMessageId": "msg-uuid-123",
  "timestamp": 1704067200,
  "instance": "instance-name"
}
```

**Resposta (200):**
```json
{
  "ok": true,
  "data": {
    "handled": "reminder_response",
    "ambiguous": false,
    "appointment_id": "cuid...",
    "confirmation_id": "cuid...",
    "appointment_ids": [...]
  }
}
```

---

### `POST /api/v1/appointments/[id]/respond-reminder` — Resposta a Lembrete

**Autenticação:** `Authorization: Bearer <N8N_API_SECRET>`

**Corpo (JSON):**
```json
{
  "confirmation_id": "cuid...",
  "response_type": "CONFIRM",
  "raw_response": "sim",
  "evolution_message_id": "msg-uuid-123"
}
```

**Response Types:** `CONFIRM`, `CANCEL`, `UNKNOWN`

**Fluxo:**
1. Persiste resposta em `AppointmentConfirmation`
2. Se `CANCEL` e dentro da janela 2h → cancela appointment
3. Se `CANCEL` fora da janela → marca como `UNKNOWN`

---

## Autenticação e Autorização

### Magic Link (HMAC)

```
Token: <32 bytes, base64url>
Hash: HMAC-SHA256(token, MAGIC_LINK_HASH_SECRET)

URL: https://site.com/a/<token>
```

O hash é armazenado no banco. Na validação:
1. Recomputa hash do token recebido
2. Compara com hash armazenado (constant-time)
3. Verifica `expiresAt`, `consumedAt`, `revokedAt`

### Sessão (iron-session)

Após validar o magic link:
1. Cookie `dra_session` é setado (HttpOnly, Secure em prod)
2. Contém `patientId`, `magicLinkId`, `serviceId`
3. TTL = `MAGIC_LINK_TTL_MINUTES`

### Bearer (n8n)

Todas as rotas administrativas usam:
```
Authorization: Bearer <N8N_API_SECRET>
```

### API Key (Evolution)

```
apikey: <EVOLUTION_INBOUND_SECRET>
```

---

## Rate Limiting

| Contexto          | Limite          | Chave                            |
|-------------------|-----------------|----------------------------------|
| Público `/a/[tkn]`| 20 req/min      | IP do cliente                    |
| n8n `/magic-links`| 120 req/min     | Bearer token                     |

---

## Códigos de Erro

| HTTP | Code                  | Descrição                          |
|------|-----------------------|------------------------------------|
| 400  | `INVALID_BODY`        | JSON inválido ou campos faltando   |
| 400  | `INVALID_PHONE`       | Telefone fora do padrão E.164      |
| 400  | `INVALID_SLOT`        | Slot não existe ou indisponível   |
| 401  | `UNAUTHORIZED`        | Credencial inválida                |
| 403  | `FORBIDDEN`           | Acesso não permitido               |
| 404  | `NOT_FOUND`           | Recurso não encontrado             |
| 409  | `IDEMPOTENCY_CONFLICT`| Idempotency-Key reutilizada       |
| 429  | `RATE_LIMITED`        | Limite de requisições excedido     |
| 500  | `INTERNAL_ERROR`      | Erro interno do servidor           |
| 503  | `CALENDAR_UNAVAILABLE`| Google Calendar indisponível       |

---

## Fluxo Completo

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PACIENTE (WhatsApp)                         │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                              n8n                                    │
│  • Detecta mensagem do paciente                                     │
│  • POST /api/v1/magic-links (com phone, service_id, conversation_id)│
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Next.js)                           │
│  • Gera token + hash HMAC                                           │
│  • Cria/atualiza Patient                                            │
│  • Retorna booking_url                                              │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PACIENTE CLICA NO LINK                                             │
│  GET /a/<token>                                                     │
│  • Valida token (HMAC)                                              │
│  • Seta cookie de sessão                                            │
│  • Redireciona para /agendar ou /consultas                          │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PACIENTE SELECIONA SLOT                                            │
│  GET /api/v1/availability                                           │
│  POST /api/v1/appointments                                          │
│  • Consulta Google Calendar (freebusy)                              │
│  • Computa slots disponíveis                                         │
│  • Cria evento no Google Calendar                                   │
│  • Persiste no banco                                                │
│  • Notifica n8n (APPOINTMENT_CONFIRMED)                             │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         n8n (Confirmação)                          │
│  • Recebe webhook                                                    │
│  • Envia mensagem WhatsApp de confirmação                            │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         CRON (20h)                                  │
│  POST /api/v1/cron/confirm-reminders                               │
│  • Lista appointments 12-24h                                       │
│  • Cria AppointmentConfirmation                                     │
│  • Notifica n8n para enviar lembrete                                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         PACIENTE RESPONDE                          │
│  n8n → POST /api/v1/webhooks/evolution/inbound                      │
│  n8n → POST /api/v1/appointments/[id]/respond-reminder             │
│  • Persiste resposta (CONFIRM/CANCEL/UNKNOWN)                       │
│  • Se CANCEL dentro 2h → cancela appointment                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Scripts Disponíveis

```bash
# Desenvolvimento
npm run dev

# Build de produção
npm run build
npm start

# Banco de dados
npm run prisma:generate   # Gera cliente Prisma
npm run prisma:migrate    # Executa migrations
npm run prisma:deploy     # Deploy migrations (produção)
npm run prisma:studio     # GUI do banco

# Seed
npm run seed              # Popula dados iniciais

# Testes
npm run test              # Executa testes (vitest)
npm run test:watch         # Watch mode

# Linting
npm run lint
```

---

## Estrutura de Pastas

```
├── app/
│   ├── api/v1/
│   │   ├── magic-links/           # Criar/revogar magic links
│   │   ├── patients/me/           # Perfil do paciente
│   │   ├── appointments/          # CRUD de consultas
│   │   ├── availability/          # Slots disponíveis
│   │   ├── cron/                  # Jobs agendados
│   │   ├── webhooks/             # Webhooks externos
│   │   └── n8n/                   # Endpoints n8n
│   └── page.tsx                   # Landing page
│
├── lib/
│   ├── appointments/              # Lógica de agendamento
│   ├── auth/                     # Sessão (iron-session)
│   ├── calendar/                  # Google Calendar
│   ├── crypto/                    # Tokens, HMAC
│   ├── magic-links/               # Emissão/validação
│   ├── patients/                  # Serviço de pacientes
│   ├── scheduler/                # Regras de agenda
│   ├── reminders/                # Lembretes 20h
│   ├── security/                 # Rate limiting
│   ├── audit/                    # Logging de eventos
│   └── errors.ts                  # Classes de erro
│
├── prisma/
│   ├── schema.prisma              # Modelo de dados
│   └── seed.ts                    # Dados iniciais
│
└── .env.example                   # Template de variáveis
```
