/*
  Warnings:

  - The required column `event_id` was added to the `webhook_deliveries` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- DropIndex
DROP INDEX "audit_logs_tenant_id_hash_idx";

-- AlterTable
ALTER TABLE "webhook_deliveries" ADD COLUMN "event_id" UUID NOT NULL DEFAULT gen_random_uuid();

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "outbox_status" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 5,
    "last_error" TEXT,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_webhook_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "source" VARCHAR(100) NOT NULL DEFAULT 'EXTERNAL',
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "payload_summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_status_scheduled_for_idx" ON "outbox_events"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "outbox_events_tenant_id_entity_id_idx" ON "outbox_events"("tenant_id", "entity_id");

-- CreateIndex
CREATE INDEX "outbox_events_created_at_idx" ON "outbox_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_tenant_id_idempotency_key_key" ON "outbox_events"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "inbound_webhook_events_expires_at_idx" ON "inbound_webhook_events"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_webhook_events_tenant_id_event_id_key" ON "inbound_webhook_events"("tenant_id", "event_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenant_id_event_id_idx" ON "webhook_deliveries"("tenant_id", "event_id");

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_webhook_events" ADD CONSTRAINT "inbound_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "tenant_audit_sequence_unique" RENAME TO "audit_logs_tenant_id_sequence_number_key";

-- RenameIndex
ALTER INDEX "tenant_notification_idempotency_unique" RENAME TO "notification_logs_tenant_id_idempotency_key_key";

-- RenameIndex
ALTER INDEX "tenant_webhook_subscription_id_unique" RENAME TO "webhook_subscriptions_tenant_id_id_key";
