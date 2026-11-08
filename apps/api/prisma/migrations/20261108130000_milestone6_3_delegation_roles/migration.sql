-- AlterTable
ALTER TABLE "user_delegations" ADD COLUMN "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
