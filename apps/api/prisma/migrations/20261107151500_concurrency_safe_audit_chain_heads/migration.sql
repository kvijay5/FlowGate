-- AlterTable: Add sequence_number to audit_logs
ALTER TABLE "audit_logs" ADD COLUMN "sequence_number" INTEGER;

-- CreateTable: audit_chain_heads
CREATE TABLE "audit_chain_heads" (
    "tenant_id" UUID NOT NULL,
    "last_hash" VARCHAR(64) NOT NULL,
    "sequence_number" INTEGER NOT NULL DEFAULT 0,
    "last_created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_chain_heads_pkey" PRIMARY KEY ("tenant_id")
);

-- AddForeignKey
ALTER TABLE "audit_chain_heads" ADD CONSTRAINT "audit_chain_heads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill sequence_number for existing hashed audit logs in chronological order
WITH sequenced AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at ASC) as seq
    FROM audit_logs
    WHERE hash IS NOT NULL
)
UPDATE audit_logs
SET sequence_number = sequenced.seq
FROM sequenced
WHERE audit_logs.id = sequenced.id;

-- CreateIndex
CREATE UNIQUE INDEX "tenant_audit_sequence_unique" ON "audit_logs"("tenant_id", "sequence_number");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_sequence_number_idx" ON "audit_logs"("tenant_id", "sequence_number");

-- Initialize audit_chain_heads for all existing tenants
INSERT INTO "audit_chain_heads" ("tenant_id", "last_hash", "sequence_number", "last_created_at", "updated_at")
SELECT 
    t.id as tenant_id,
    COALESCE(l.hash, 'GENESIS') as last_hash,
    COALESCE(l.sequence_number, 0) as sequence_number,
    l.created_at as last_created_at,
    NOW() as updated_at
FROM "tenants" t
LEFT JOIN LATERAL (
    SELECT hash, sequence_number, created_at
    FROM "audit_logs"
    WHERE tenant_id = t.id AND hash IS NOT NULL
    ORDER BY sequence_number DESC NULLS LAST, created_at DESC
    LIMIT 1
) l ON TRUE
ON CONFLICT ("tenant_id") DO NOTHING;
