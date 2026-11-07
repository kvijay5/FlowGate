-- AlterEnum
ALTER TYPE "approval_request_status" ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED';

-- AlterTable
ALTER TABLE "approval_steps" ADD COLUMN IF NOT EXISTS "step_name" VARCHAR(255) NOT NULL DEFAULT 'Approval Step';
ALTER TABLE "approval_steps" ADD COLUMN IF NOT EXISTS "assigned_role" "user_role";
ALTER TABLE "approval_steps" ADD COLUMN IF NOT EXISTS "actioned_by_id" UUID;
ALTER TABLE "approval_steps" ADD COLUMN IF NOT EXISTS "actioned_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_steps_tenant_id_assigned_role_idx" ON "approval_steps"("tenant_id", "assigned_role");
CREATE INDEX IF NOT EXISTS "approval_steps_actioned_by_id_idx" ON "approval_steps"("actioned_by_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_steps_tenant_id_actioned_by_id_fkey'
    ) THEN
        ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_tenant_id_actioned_by_id_fkey"
        FOREIGN KEY ("tenant_id", "actioned_by_id") REFERENCES "users"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
