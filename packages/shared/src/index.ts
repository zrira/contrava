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
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return candidate.version === 1
    && typeof candidate.messageId === 'string' && uuid.test(candidate.messageId)
    && typeof candidate.jobId === 'string' && uuid.test(candidate.jobId)
    && typeof candidate.apiId === 'string' && uuid.test(candidate.apiId)
    && typeof candidate.correlationId === 'string' && candidate.correlationId !== ''
    && typeof candidate.createdAt === 'string' && !Number.isNaN(Date.parse(candidate.createdAt));
}

export interface RepositoryScanMessage {
  version: 1;
  messageId: string;
  repositoryScanId: string;
  repositoryId: string;
  commitSha: string | null;
  correlationId: string;
  createdAt: string;
}

export function isRepositoryScanMessage(value: unknown): value is RepositoryScanMessage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return candidate.version === 1
    && typeof candidate.messageId === 'string' && uuid.test(candidate.messageId)
    && typeof candidate.repositoryScanId === 'string' && uuid.test(candidate.repositoryScanId)
    && typeof candidate.repositoryId === 'string' && uuid.test(candidate.repositoryId)
    && (candidate.commitSha === null || (typeof candidate.commitSha === 'string' && /^[0-9a-f]{40}$/i.test(candidate.commitSha)))
    && typeof candidate.correlationId === 'string' && candidate.correlationId !== ''
    && typeof candidate.createdAt === 'string' && !Number.isNaN(Date.parse(candidate.createdAt));
}

export interface RepositoryScanClaim {
  scanId: string;
  repositoryId: string;
  owner: string;
  name: string;
  branch: string | null;
  commitSha: string | null;
  previousCommitSha: string | null;
  attempt: number;
  maxAttempts: number;
  claimToken: string;
  runnerId: string;
  leaseExpiresAt: string;
}

export type RepositoryScanDisposition =
  | { disposition: 'CLAIMED'; scan: RepositoryScanClaim }
  | { disposition: 'COMPLETED' }
  | { disposition: 'BUSY'; retryAfterMs: number }
  | { disposition: 'TERMINAL' }
  | { disposition: 'NOT_FOUND' };

export interface IndexedUsageCandidate {
  httpMethod: string | null;
  endpointPattern: string;
  line: number;
  column: number | null;
  snippet: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  matchType: 'STATIC_LITERAL' | 'TEMPLATE_LITERAL' | 'STRING_CONCATENATION' | 'HTTP_CLIENT_CALL' | 'BASE_URL_JOIN' | 'WRAPPER_CALL' | 'UNKNOWN';
  evidence: Record<string, string>;
}

export interface IndexedSourceFile {
  path: string;
  language: string;
  contentHash: string;
  usages: IndexedUsageCandidate[];
}

export interface CompleteRepositoryScanRequest {
  claimToken: string;
  runnerId: string;
  commitSha: string;
  defaultBranch: string;
  externalRepositoryId: string;
  fullScan: boolean;
  files: IndexedSourceFile[];
  deletedPaths: string[];
  indexedPaths: string[];
  filesSkipped: number;
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
