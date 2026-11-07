-- Step 1: Add nullable tenant_id to approval_steps
ALTER TABLE "approval_steps" ADD COLUMN "tenant_id" UUID;

-- Step 2: Backfill tenant_id in approval_steps from parent approval_requests
UPDATE "approval_steps"
SET "tenant_id" = "approval_requests"."tenant_id"
FROM "approval_requests"
WHERE "approval_steps"."approval_request_id" = "approval_requests"."id";

-- Step 3: Enforce NOT NULL on approval_steps.tenant_id
ALTER TABLE "approval_steps" ALTER COLUMN "tenant_id" SET NOT NULL;

-- Step 4: Create composite unique indexes for foreign key targets
CREATE UNIQUE INDEX "users_tenant_id_id_key" ON "users"("tenant_id", "id");
CREATE UNIQUE INDEX "workflow_definitions_tenant_id_id_key" ON "workflow_definitions"("tenant_id", "id");
CREATE UNIQUE INDEX "approval_requests_tenant_id_id_key" ON "approval_requests"("tenant_id", "id");

-- Step 5: Index tenant_id on approval_steps
CREATE INDEX "approval_steps_tenant_id_idx" ON "approval_steps"("tenant_id");

-- Step 6: Drop legacy non-composite foreign keys
ALTER TABLE "approval_requests" DROP CONSTRAINT IF EXISTS "approval_requests_workflow_definition_id_fkey";
ALTER TABLE "approval_requests" DROP CONSTRAINT IF EXISTS "approval_requests_requested_by_id_fkey";
ALTER TABLE "approval_steps" DROP CONSTRAINT IF EXISTS "approval_steps_approval_request_id_fkey";
ALTER TABLE "approval_steps" DROP CONSTRAINT IF EXISTS "approval_steps_assigned_to_id_fkey";
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actor_id_fkey";

-- Step 7: Add composite foreign keys enforcing strict cross-tenant database integrity
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_workflow_definition_id_fkey"
    FOREIGN KEY ("tenant_id", "workflow_definition_id") REFERENCES "workflow_definitions"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_requested_by_id_fkey"
    FOREIGN KEY ("tenant_id", "requested_by_id") REFERENCES "users"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_tenant_id_approval_request_id_fkey"
    FOREIGN KEY ("tenant_id", "approval_request_id") REFERENCES "approval_requests"("tenant_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_tenant_id_assigned_to_id_fkey"
    FOREIGN KEY ("tenant_id", "assigned_to_id") REFERENCES "users"("tenant_id", "id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_actor_id_fkey"
    FOREIGN KEY ("tenant_id", "actor_id") REFERENCES "users"("tenant_id", "id")
    ON DELETE SET NULL ON UPDATE CASCADE;
