-- CreateTable
CREATE TABLE "appointment_confirmations" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "sent_day" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "response_type" TEXT,
    "raw_response" TEXT,
    "evolution_message_id" TEXT,

    CONSTRAINT "appointment_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_confirmations_evolution_message_id_key" ON "appointment_confirmations"("evolution_message_id");

-- CreateIndex
CREATE INDEX "appointment_confirmations_appointment_id_idx" ON "appointment_confirmations"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_confirmations_sent_day_idx" ON "appointment_confirmations"("sent_day");

-- CreateIndex
CREATE INDEX "appointment_confirmations_responded_at_idx" ON "appointment_confirmations"("responded_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_confirmations_appointment_id_sent_day_key" ON "appointment_confirmations"("appointment_id", "sent_day");

-- AddForeignKey
ALTER TABLE "appointment_confirmations" ADD CONSTRAINT "appointment_confirmations_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
