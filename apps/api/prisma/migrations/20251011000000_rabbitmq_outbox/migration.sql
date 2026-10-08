CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

ALTER TABLE "ScanJob"
  ADD COLUMN "lastDeliveredAt" TIMESTAMPTZ(3),
  ADD COLUMN "redeliveryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deadLetteredAt" TIMESTAMPTZ(3);

CREATE TABLE "OutboxMessage" (
  "id" UUID NOT NULL,
  "jobId" UUID,
  "apiId" UUID,
  "topic" TEXT NOT NULL,
  "routingKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMPTZ(3),
  "lockToken" UUID,
  "publishedAt" TIMESTAMPTZ(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutboxMessage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutboxMessage_apiId_fkey" FOREIGN KEY ("apiId") REFERENCES "TrackedApi"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OutboxMessage_status_createdAt_idx" ON "OutboxMessage"("status", "createdAt");
CREATE INDEX "OutboxMessage_status_lockedAt_idx" ON "OutboxMessage"("status", "lockedAt");
CREATE INDEX "OutboxMessage_jobId_createdAt_idx" ON "OutboxMessage"("jobId", "createdAt");
