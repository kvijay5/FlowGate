-- CreateEnum
CREATE TYPE "step_policy" AS ENUM ('SEQUENTIAL', 'PARALLEL_AND', 'PARALLEL_OR');

-- CreateEnum
CREATE TYPE "rejection_policy" AS ENUM ('SOFT_REJECTION', 'STRICT_VETO');

-- CreateEnum
CREATE TYPE "delegation_status" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "node_execution_status" AS ENUM ('PENDING', 'IN_REVIEW', 'COMPLETED', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "branch_execution_status" AS ENUM ('NOT_EVALUATED', 'ACTIVE', 'COMPLETED', 'PRUNED_SKIPPED', 'FAILED', 'CANCELLED');

-- DropIndex
DROP INDEX IF EXISTS "approval_steps_approval_request_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "approval_steps_approval_request_id_step_order_key";

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "current_node_id" VARCHAR(100),
ADD COLUMN     "current_review_round" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "request_data" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "approval_steps" ADD COLUMN     "approved_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "branch_key" VARCHAR(150),
ADD COLUMN     "node_id" VARCHAR(100) NOT NULL DEFAULT 'legacy_step',
ADD COLUMN     "node_type" VARCHAR(50) NOT NULL DEFAULT 'APPROVAL_STEP',
ADD COLUMN     "policy" "step_policy" NOT NULL DEFAULT 'SEQUENTIAL',
ADD COLUMN     "rejected_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rejection_policy" "rejection_policy" NOT NULL DEFAULT 'SOFT_REJECTION',
ADD COLUMN     "required_approvals" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "review_round" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "total_assigned" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "webhook_deliveries" ALTER COLUMN "event_id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "approval_step_assignees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "review_round" INTEGER NOT NULL DEFAULT 1,
    "assigned_to_id" UUID,
    "assigned_role" "user_role",
    "status" "step_status" NOT NULL DEFAULT 'PENDING',
    "actioned_by_id" UUID,
    "delegated_from_user_id" UUID,
    "actioned_at" TIMESTAMP(3),
    "comments" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_step_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_node_executions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "approval_request_id" UUID NOT NULL,
    "review_round" INTEGER NOT NULL DEFAULT 1,
    "node_id" VARCHAR(100) NOT NULL,
    "node_type" VARCHAR(50) NOT NULL,
    "status" "node_execution_status" NOT NULL DEFAULT 'PENDING',
    "activated_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "execution_data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_node_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_branch_executions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "approval_request_id" UUID NOT NULL,
    "review_round" INTEGER NOT NULL DEFAULT 1,
    "branch_key" VARCHAR(150) NOT NULL,
    "source_node_id" VARCHAR(100) NOT NULL,
    "target_node_id" VARCHAR(100) NOT NULL,
    "status" "branch_execution_status" NOT NULL DEFAULT 'NOT_EVALUATED',
    "activated_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_branch_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_delegations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "delegator_id" UUID NOT NULL,
    "delegatee_id" UUID NOT NULL,
    "workflow_definition_id" UUID,
    "delegate_roles" BOOLEAN NOT NULL DEFAULT true,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" "delegation_status" NOT NULL DEFAULT 'ACTIVE',
    "reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_step_assignees_tenant_id_idx" ON "approval_step_assignees"("tenant_id");

-- CreateIndex
CREATE INDEX "approval_step_assignees_step_id_idx" ON "approval_step_assignees"("step_id");

-- CreateIndex
CREATE INDEX "approval_step_assignees_tenant_id_assigned_to_id_status_idx" ON "approval_step_assignees"("tenant_id", "assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "approval_step_assignees_tenant_id_assigned_role_status_idx" ON "approval_step_assignees"("tenant_id", "assigned_role", "status");

-- CreateIndex
CREATE INDEX "workflow_node_executions_tenant_id_status_idx" ON "workflow_node_executions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_node_executions_approval_request_id_review_round_n_key" ON "workflow_node_executions"("approval_request_id", "review_round", "node_id");

-- CreateIndex
CREATE INDEX "workflow_branch_executions_tenant_id_target_node_id_status_idx" ON "workflow_branch_executions"("tenant_id", "target_node_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_branch_executions_approval_request_id_review_round_key" ON "workflow_branch_executions"("approval_request_id", "review_round", "branch_key");

-- CreateIndex
CREATE INDEX "user_delegations_tenant_id_idx" ON "user_delegations"("tenant_id");

-- CreateIndex
CREATE INDEX "user_delegations_tenant_id_delegatee_id_status_start_date_e_idx" ON "user_delegations"("tenant_id", "delegatee_id", "status", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "user_delegations_tenant_id_delegator_id_status_idx" ON "user_delegations"("tenant_id", "delegator_id", "status");

-- CreateIndex
CREATE INDEX "approval_steps_approval_request_id_review_round_idx" ON "approval_steps"("approval_request_id", "review_round");

-- CreateIndex
CREATE INDEX "approval_steps_tenant_id_node_id_idx" ON "approval_steps"("tenant_id", "node_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_approval_request_id_review_round_step_order_key" ON "approval_steps"("approval_request_id", "review_round", "step_order");

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_tenant_id_id_key" ON "approval_steps"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "approval_step_assignees" ADD CONSTRAINT "approval_step_assignees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_assignees" ADD CONSTRAINT "approval_step_assignees_tenant_id_step_id_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "approval_steps"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_assignees" ADD CONSTRAINT "approval_step_assignees_tenant_id_assigned_to_id_fkey" FOREIGN KEY ("tenant_id", "assigned_to_id") REFERENCES "users"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_assignees" ADD CONSTRAINT "approval_step_assignees_tenant_id_actioned_by_id_fkey" FOREIGN KEY ("tenant_id", "actioned_by_id") REFERENCES "users"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_assignees" ADD CONSTRAINT "approval_step_assignees_tenant_id_delegated_from_user_id_fkey" FOREIGN KEY ("tenant_id", "delegated_from_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_node_executions" ADD CONSTRAINT "workflow_node_executions_tenant_id_approval_request_id_fkey" FOREIGN KEY ("tenant_id", "approval_request_id") REFERENCES "approval_requests"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_branch_executions" ADD CONSTRAINT "workflow_branch_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_branch_executions" ADD CONSTRAINT "workflow_branch_executions_tenant_id_approval_request_id_fkey" FOREIGN KEY ("tenant_id", "approval_request_id") REFERENCES "approval_requests"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_delegations" ADD CONSTRAINT "user_delegations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_delegations" ADD CONSTRAINT "user_delegations_tenant_id_delegator_id_fkey" FOREIGN KEY ("tenant_id", "delegator_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_delegations" ADD CONSTRAINT "user_delegations_tenant_id_delegatee_id_fkey" FOREIGN KEY ("tenant_id", "delegatee_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_delegations" ADD CONSTRAINT "user_delegations_tenant_id_workflow_definition_id_fkey" FOREIGN KEY ("tenant_id", "workflow_definition_id") REFERENCES "workflow_definitions"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
