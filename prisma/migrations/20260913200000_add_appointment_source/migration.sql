-- Adiciona coluna `source` em appointments para distinguir consultas criadas
-- pela API/portal (NULL) das sincronizadas do Google Calendar pelo cron
-- /api/v1/cron/sync-calendar (valor 'google_import').
--
-- O sync usa esse campo para detectar Appointment órfão (evento deletado
-- no Google) e cancelar no banco.

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "source" TEXT;

-- CreateIndex
CREATE INDEX "appointments_source_idx" ON "appointments"("source");
