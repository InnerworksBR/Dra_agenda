-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'NO_SHOW', 'COMPLETED');

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "name" TEXT,
    "health_plan" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_links" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "first_opened_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "source" TEXT,
    "conversation_id" TEXT,
    "service_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 15,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "scheduling_rules" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "magic_link_id" TEXT,
    "service_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "external_calendar_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "patient_id" TEXT,
    "magic_link_id" TEXT,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "magic_link_id" TEXT,
    "request_hash" TEXT NOT NULL,
    "response_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patients_phone_e164_key" ON "patients"("phone_e164");

-- CreateIndex
CREATE INDEX "patients_phone_e164_idx" ON "patients"("phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "magic_links_token_hash_key" ON "magic_links"("token_hash");

-- CreateIndex
CREATE INDEX "magic_links_patient_id_idx" ON "magic_links"("patient_id");

-- CreateIndex
CREATE INDEX "magic_links_expires_at_idx" ON "magic_links"("expires_at");

-- CreateIndex
CREATE INDEX "magic_links_created_at_idx" ON "magic_links"("created_at");

-- CreateIndex
CREATE INDEX "appointments_patient_id_idx" ON "appointments"("patient_id");

-- CreateIndex
CREATE INDEX "appointments_starts_at_idx" ON "appointments"("starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_starts_at_service_id_key" ON "appointments"("starts_at", "service_id");

-- CreateIndex
CREATE INDEX "audit_events_event_type_created_at_idx" ON "audit_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_patient_id_idx" ON "audit_events"("patient_id");

-- CreateIndex
CREATE INDEX "audit_events_magic_link_id_idx" ON "audit_events"("magic_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- AddForeignKey
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_magic_link_id_fkey" FOREIGN KEY ("magic_link_id") REFERENCES "magic_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_magic_link_id_fkey" FOREIGN KEY ("magic_link_id") REFERENCES "magic_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
