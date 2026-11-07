-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'SLACK_MOCK');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "webhook_status" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- AlterTable: Add reminder and escalation columns to approval_steps
ALTER TABLE "approval_steps" ADD COLUMN "reminder_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "approval_steps" ADD COLUMN "last_reminded_at" TIMESTAMP(3);
ALTER TABLE "approval_steps" ADD COLUMN "is_escalated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "approval_steps" ADD COLUMN "escalated_at" TIMESTAMP(3);
ALTER TABLE "approval_steps" ADD COLUMN "escalated_to_role" "user_role";
ALTER TABLE "approval_steps" ADD COLUMN "escalated_to_user_id" UUID;
ALTER TABLE "approval_steps" ADD COLUMN "escalation_reason" VARCHAR(255);

-- Foreign key for escalated_to_user_id enforcing tenant boundary
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_tenant_id_escalated_to_user_id_fkey" 
FOREIGN KEY ("tenant_id", "escalated_to_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "approval_steps_escalated_to_user_id_idx" ON "approval_steps"("escalated_to_user_id");
CREATE INDEX "approval_steps_tenant_id_escalated_to_role_idx" ON "approval_steps"("tenant_id", "escalated_to_role");

-- CreateTable: notification_logs
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "recipient_email" VARCHAR(255) NOT NULL,
    "recipient_user_id" UUID,
    "channel" "notification_channel" NOT NULL DEFAULT 'EMAIL',
    "event_type" VARCHAR(100) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_tenant_id_recipient_user_id_fkey" FOREIGN KEY ("tenant_id", "recipient_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "tenant_notification_idempotency_unique" ON "notification_logs"("tenant_id", "idempotency_key");
CREATE INDEX "notification_logs_tenant_id_idx" ON "notification_logs"("tenant_id");
CREATE INDEX "notification_logs_tenant_id_status_idx" ON "notification_logs"("tenant_id", "status");
CREATE INDEX "notification_logs_tenant_id_event_type_idx" ON "notification_logs"("tenant_id", "event_type");
CREATE INDEX "notification_logs_recipient_user_id_idx" ON "notification_logs"("recipient_user_id");

-- CreateTable: webhook_subscriptions
CREATE TABLE "webhook_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "url" VARCHAR(1024) NOT NULL,
    "secret" VARCHAR(255) NOT NULL,
    "event_types" JSONB NOT NULL DEFAULT '[]',
    "status" "webhook_status" NOT NULL DEFAULT 'ACTIVE',
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "tenant_webhook_subscription_id_unique" ON "webhook_subscriptions"("tenant_id", "id");
CREATE INDEX "webhook_subscriptions_tenant_id_idx" ON "webhook_subscriptions"("tenant_id");
CREATE INDEX "webhook_subscriptions_tenant_id_status_idx" ON "webhook_subscriptions"("tenant_id", "status");

-- CreateTable: webhook_deliveries
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "delivery_status" NOT NULL DEFAULT 'PENDING',
    "http_status_code" INTEGER,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_retry_at" TIMESTAMP(3),
    "request_headers" JSONB,
    "response_body" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_subscription_id_fkey" FOREIGN KEY ("tenant_id", "subscription_id") REFERENCES "webhook_subscriptions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "webhook_deliveries_tenant_id_idx" ON "webhook_deliveries"("tenant_id");
CREATE INDEX "webhook_deliveries_subscription_id_idx" ON "webhook_deliveries"("subscription_id");
CREATE INDEX "webhook_deliveries_tenant_id_status_idx" ON "webhook_deliveries"("tenant_id", "status");
CREATE INDEX "webhook_deliveries_tenant_id_event_type_idx" ON "webhook_deliveries"("tenant_id", "event_type");
