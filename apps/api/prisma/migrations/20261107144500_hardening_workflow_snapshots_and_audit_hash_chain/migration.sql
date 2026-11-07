-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "workflow_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "workflow_snapshot" JSONB;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "previous_hash" VARCHAR(64);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "hash" VARCHAR(64);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_hash_idx" ON "audit_logs"("tenant_id", "hash");
