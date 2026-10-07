-- AlterTable
ALTER TABLE "TrackedApi" ADD COLUMN "scanEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TrackedApi" ADD COLUMN "scanIntervalMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "TrackedApi" ADD COLUMN "nextScanAt" DATETIME;
ALTER TABLE "Scan" ADD COLUMN "jobId" TEXT;

-- CreateTable
CREATE TABLE "ScanJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "apiId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "scheduleKey" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "scheduledFor" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" DATETIME,
  "startedAt" DATETIME,
  "leaseExpiresAt" DATETIME,
  "claimToken" TEXT,
  "runnerId" TEXT,
  "completedAt" DATETIME,
  "failedAt" DATETIME,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ScanJob_apiId_fkey" FOREIGN KEY ("apiId") REFERENCES "TrackedApi" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Scan_jobId_key" ON "Scan"("jobId");
CREATE UNIQUE INDEX "ScanJob_scheduleKey_key" ON "ScanJob"("scheduleKey");
CREATE INDEX "ScanJob_status_scheduledFor_idx" ON "ScanJob"("status", "scheduledFor");
CREATE INDEX "ScanJob_apiId_createdAt_idx" ON "ScanJob"("apiId", "createdAt");
CREATE INDEX "ScanJob_leaseExpiresAt_idx" ON "ScanJob"("leaseExpiresAt");
