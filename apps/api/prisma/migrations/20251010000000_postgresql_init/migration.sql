-- CreateEnum
CREATE TYPE "ApiStatus" AS ENUM ('PENDING', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('RUNNING', 'RETRY_SCHEDULED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScanJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'RUNNING', 'RETRY_SCHEDULED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScanJobSource" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "ChangeSeverity" AS ENUM ('NON_BREAKING', 'POTENTIALLY_BREAKING', 'BREAKING');

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "TrackedApi" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "specUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "status" "ApiStatus" NOT NULL DEFAULT 'PENDING',
    "scanEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scanIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "nextScanAt" TIMESTAMPTZ(3),

    CONSTRAINT "TrackedApi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiSnapshot" (
    "id" UUID NOT NULL,
    "apiId" UUID NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "rawSpec" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiChange" (
    "id" UUID NOT NULL,
    "apiId" UUID NOT NULL,
    "previousSnapshotId" UUID NOT NULL,
    "currentSnapshotId" UUID NOT NULL,
    "severity" "ChangeSeverity" NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "path" TEXT NOT NULL,
    "method" VARCHAR(12),
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" UUID NOT NULL,
    "apiId" UUID NOT NULL,
    "jobId" UUID,
    "status" "ScanStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" UUID NOT NULL,
    "apiId" UUID NOT NULL,
    "status" "ScanJobStatus" NOT NULL DEFAULT 'PENDING',
    "source" "ScanJobSource" NOT NULL DEFAULT 'MANUAL',
    "scheduleKey" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledFor" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "claimToken" UUID,
    "runnerId" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3),
    "status" "WorkerStatus" NOT NULL DEFAULT 'UNKNOWN',

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackedApi_scanEnabled_nextScanAt_idx" ON "TrackedApi"("scanEnabled", "nextScanAt");

-- CreateIndex
CREATE INDEX "ApiSnapshot_apiId_createdAt_idx" ON "ApiSnapshot"("apiId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiSnapshot_apiId_contentHash_key" ON "ApiSnapshot"("apiId", "contentHash");

-- CreateIndex
CREATE INDEX "ApiChange_apiId_createdAt_idx" ON "ApiChange"("apiId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiChange_previousSnapshotId_currentSnapshotId_category_pat_key" ON "ApiChange"("previousSnapshotId", "currentSnapshotId", "category", "path", "method", "description");

-- CreateIndex
CREATE UNIQUE INDEX "Scan_jobId_key" ON "Scan"("jobId");

-- CreateIndex
CREATE INDEX "Scan_apiId_createdAt_idx" ON "Scan"("apiId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScanJob_scheduleKey_key" ON "ScanJob"("scheduleKey");

-- CreateIndex
CREATE INDEX "ScanJob_status_scheduledFor_createdAt_idx" ON "ScanJob"("status", "scheduledFor", "createdAt");

-- CreateIndex
CREATE INDEX "ScanJob_status_leaseExpiresAt_idx" ON "ScanJob"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ScanJob_apiId_createdAt_idx" ON "ScanJob"("apiId", "createdAt");

-- CreateIndex
CREATE INDEX "ScanJob_status_createdAt_idx" ON "ScanJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_name_key" ON "Worker"("name");

-- AddForeignKey
ALTER TABLE "ApiSnapshot" ADD CONSTRAINT "ApiSnapshot_apiId_fkey" FOREIGN KEY ("apiId") REFERENCES "TrackedApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiChange" ADD CONSTRAINT "ApiChange_apiId_fkey" FOREIGN KEY ("apiId") REFERENCES "TrackedApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiChange" ADD CONSTRAINT "ApiChange_previousSnapshotId_fkey" FOREIGN KEY ("previousSnapshotId") REFERENCES "ApiSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiChange" ADD CONSTRAINT "ApiChange_currentSnapshotId_fkey" FOREIGN KEY ("currentSnapshotId") REFERENCES "ApiSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_apiId_fkey" FOREIGN KEY ("apiId") REFERENCES "TrackedApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ScanJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_apiId_fkey" FOREIGN KEY ("apiId") REFERENCES "TrackedApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

