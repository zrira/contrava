export const severities = ['NON_BREAKING', 'POTENTIALLY_BREAKING', 'BREAKING'] as const;
export type Severity = (typeof severities)[number];

export const changeCategories = [
  'ENDPOINT_ADDED',
  'ENDPOINT_REMOVED',
  'METHOD_ADDED',
  'METHOD_REMOVED',
  'REQUIRED_PARAMETER_ADDED',
  'REQUEST_PROPERTY_ADDED',
  'REQUEST_PROPERTY_REMOVED',
  'RESPONSE_PROPERTY_ADDED',
  'RESPONSE_PROPERTY_REMOVED',
  'REQUEST_TYPE_CHANGED',
  'RESPONSE_TYPE_CHANGED',
  'SUCCESS_RESPONSE_ADDED',
  'SUCCESS_RESPONSE_REMOVED',
  'ENUM_CHANGED',
  'FIELD_BECAME_REQUIRED',
  'PARAMETER_CONSTRAINTS_TIGHTENED',
  'DESCRIPTION_CHANGED',
] as const;
export type ChangeCategory = (typeof changeCategories)[number];

export interface ContractChange {
  severity: Severity;
  category: ChangeCategory;
  path: string;
  method: string | null;
  description: string;
}

export interface FetchSpecRequest {
  apiId: string;
  specUrl: string;
}

export interface FetchSpecResponse {
  apiId: string;
  hash: string;
  format: 'openapi';
  version: string;
  spec: OpenApiDocument;
}

export interface DiffRequest {
  previous: OpenApiDocument;
  current: OpenApiDocument;
}

export interface DiffResponse {
  changes: ContractChange[];
}

export interface OpenApiDocument {
  openapi: string;
  info?: { title?: string; version?: string; description?: string; [key: string]: unknown };
  paths?: Record<string, unknown>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkerHealth {
  name: string;
  status: 'HEALTHY' | 'UNAVAILABLE';
  latencyMs?: number;
  error?: string;
}

export const jobStatuses = [
  'PENDING',
  'CLAIMED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'RETRY_SCHEDULED',
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export interface ScanExecuteMessage {
  version: 1;
  messageId: string;
  jobId: string;
  apiId: string;
  correlationId: string;
  createdAt: string;
}

export function isScanExecuteMessage(value: unknown): value is ScanExecuteMessage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1
    && ['messageId', 'jobId', 'apiId', 'correlationId', 'createdAt'].every((key) => typeof candidate[key] === 'string' && candidate[key] !== '');
}

export interface ClaimedJob {
  id: string;
  apiId: string;
  specUrl: string;
  attempt: number;
  maxAttempts: number;
  claimToken: string;
  runnerId: string;
  leaseExpiresAt: string;
  previousSnapshot: { id: string; contentHash: string; spec: OpenApiDocument } | null;
}

export type JobDeliveryDisposition =
  | { disposition: 'CLAIMED'; job: ClaimedJob }
  | { disposition: 'COMPLETED' }
  | { disposition: 'BUSY'; retryAfterMs: number }
  | { disposition: 'TERMINAL' }
  | { disposition: 'NOT_FOUND' };

export interface CompleteJobRequest {
  claimToken: string;
  runnerId: string;
  hash: string;
  spec: OpenApiDocument;
  previousSnapshotId: string | null;
  changes: ContractChange[];
}

export interface ErrorResponse {
  error: { code: string; message: string; requestId?: string };
}
