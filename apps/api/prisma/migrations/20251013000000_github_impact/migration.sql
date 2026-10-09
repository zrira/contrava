CREATE TYPE "RepositoryProvider" AS ENUM ('GITHUB');
CREATE TYPE "RepositoryStatus" AS ENUM ('PENDING', 'ACTIVE', 'ERROR');
CREATE TYPE "RepositoryScanStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY_SCHEDULED', 'RATE_LIMITED', 'COMPLETED', 'FAILED');
CREATE TYPE "ImpactConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "UsageMatchType" AS ENUM ('STATIC_LITERAL', 'TEMPLATE_LITERAL', 'STRING_CONCATENATION', 'HTTP_CLIENT_CALL', 'BASE_URL_JOIN', 'WRAPPER_CALL', 'UNKNOWN');

CREATE TABLE "Repository" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "owner" VARCHAR(120) NOT NULL, "name" VARCHAR(120) NOT NULL,
  "fullName" VARCHAR(241) NOT NULL, "provider" "RepositoryProvider" NOT NULL DEFAULT 'GITHUB',
  "defaultBranch" VARCHAR(255), "selectedBranch" VARCHAR(255), "installationId" TEXT, "externalRepositoryId" TEXT,
  "status" "RepositoryStatus" NOT NULL DEFAULT 'PENDING', "headCommitSha" VARCHAR(40), "lastIndexedCommitSha" VARCHAR(40),
  "lastIndexedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Repository_fullName_key" ON "Repository"("fullName");
CREATE UNIQUE INDEX "Repository_provider_owner_name_key" ON "Repository"("provider", "owner", "name");
CREATE INDEX "Repository_status_updatedAt_idx" ON "Repository"("status", "updatedAt");

CREATE TABLE "ApiRepositoryLink" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "apiId" UUID NOT NULL, "repositoryId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ApiRepositoryLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApiRepositoryLink_apiId_fkey" FOREIGN KEY ("apiId") REFERENCES "TrackedApi"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ApiRepositoryLink_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApiRepositoryLink_apiId_repositoryId_key" ON "ApiRepositoryLink"("apiId", "repositoryId");
CREATE INDEX "ApiRepositoryLink_repositoryId_idx" ON "ApiRepositoryLink"("repositoryId");

CREATE TABLE "RepositoryScan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "repositoryId" UUID NOT NULL, "commitSha" VARCHAR(40), "baseCommitSha" VARCHAR(40),
  "status" "RepositoryScanStatus" NOT NULL DEFAULT 'PENDING', "scannerVersion" VARCHAR(20) NOT NULL DEFAULT '1',
  "attempt" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 4,
  "scheduledFor" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
  "leaseExpiresAt" TIMESTAMPTZ(3), "claimToken" UUID, "runnerId" TEXT, "activeKey" UUID, "error" TEXT,
  "rateLimitResetAt" TIMESTAMPTZ(3), "filesScanned" INTEGER NOT NULL DEFAULT 0, "filesSkipped" INTEGER NOT NULL DEFAULT 0,
  "usagesFound" INTEGER NOT NULL DEFAULT 0, "fullScan" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RepositoryScan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RepositoryScan_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RepositoryScan_activeKey_key" ON "RepositoryScan"("activeKey");
CREATE UNIQUE INDEX "RepositoryScan_repositoryId_commitSha_scannerVersion_key" ON "RepositoryScan"("repositoryId", "commitSha", "scannerVersion");
CREATE INDEX "RepositoryScan_status_scheduledFor_idx" ON "RepositoryScan"("status", "scheduledFor");
CREATE INDEX "RepositoryScan_repositoryId_createdAt_idx" ON "RepositoryScan"("repositoryId", "createdAt");
CREATE INDEX "RepositoryScan_status_leaseExpiresAt_idx" ON "RepositoryScan"("status", "leaseExpiresAt");

CREATE TABLE "SourceFile" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "repositoryId" UUID NOT NULL, "path" TEXT NOT NULL, "language" VARCHAR(30) NOT NULL,
  "contentHash" VARCHAR(64) NOT NULL, "lastIndexedCommitSha" VARCHAR(40) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SourceFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceFile_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SourceFile_repositoryId_path_key" ON "SourceFile"("repositoryId", "path");
CREATE INDEX "SourceFile_repositoryId_lastIndexedCommitSha_idx" ON "SourceFile"("repositoryId", "lastIndexedCommitSha");

CREATE TABLE "ApiUsage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "repositoryId" UUID NOT NULL, "sourceFileId" UUID NOT NULL, "apiId" UUID,
  "httpMethod" VARCHAR(12), "endpointPattern" TEXT NOT NULL, "line" INTEGER NOT NULL, "column" INTEGER,
  "snippet" VARCHAR(1200) NOT NULL, "confidence" "ImpactConfidence" NOT NULL, "matchType" "UsageMatchType" NOT NULL,
  "evidence" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApiUsage_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ApiUsage_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "SourceFile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ApiUsage_apiId_fkey" FOREIGN KEY ("apiId") REFERENCES "TrackedApi"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ApiUsage_repositoryId_apiId_httpMethod_idx" ON "ApiUsage"("repositoryId", "apiId", "httpMethod");
CREATE INDEX "ApiUsage_repositoryId_endpointPattern_idx" ON "ApiUsage"("repositoryId", "endpointPattern");
CREATE INDEX "ApiUsage_sourceFileId_line_idx" ON "ApiUsage"("sourceFileId", "line");

CREATE TABLE "ImpactFinding" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "apiChangeId" UUID NOT NULL, "repositoryId" UUID NOT NULL, "apiUsageId" UUID NOT NULL,
  "path" TEXT NOT NULL, "line" INTEGER NOT NULL, "confidence" "ImpactConfidence" NOT NULL, "reason" TEXT NOT NULL,
  "indexedCommitSha" VARCHAR(40) NOT NULL, "impactAlgorithmVersion" VARCHAR(20) NOT NULL DEFAULT '1',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ImpactFinding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImpactFinding_apiChangeId_fkey" FOREIGN KEY ("apiChangeId") REFERENCES "ApiChange"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ImpactFinding_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ImpactFinding_apiUsageId_fkey" FOREIGN KEY ("apiUsageId") REFERENCES "ApiUsage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ImpactFinding_apiChangeId_apiUsageId_impactAlgorithmVersion_key" ON "ImpactFinding"("apiChangeId", "apiUsageId", "impactAlgorithmVersion");
CREATE INDEX "ImpactFinding_apiChangeId_confidence_idx" ON "ImpactFinding"("apiChangeId", "confidence");
CREATE INDEX "ImpactFinding_repositoryId_createdAt_idx" ON "ImpactFinding"("repositoryId", "createdAt");

ALTER TABLE "OutboxMessage" ADD COLUMN "repositoryScanId" UUID, ADD COLUMN "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_repositoryScanId_fkey" FOREIGN KEY ("repositoryScanId") REFERENCES "RepositoryScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "OutboxMessage_status_availableAt_createdAt_idx" ON "OutboxMessage"("status", "availableAt", "createdAt");
CREATE INDEX "OutboxMessage_repositoryScanId_createdAt_idx" ON "OutboxMessage"("repositoryScanId", "createdAt");
