ALTER TABLE "ScanJob" ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "ScanJob" ALTER COLUMN "maxAttempts" SET DEFAULT 4;
