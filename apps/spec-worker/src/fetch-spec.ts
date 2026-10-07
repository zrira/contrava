import type { FetchSpecResponse, OpenApiDocument } from '@contrava/shared';
import { parse as parseYaml } from 'yaml';
import { ServiceError } from './errors.js';
import { deterministicHash } from './hash.js';

type Fetch = typeof globalThis.fetch;

export interface FetchOptions {
  timeoutMs: number;
  maxBytes: number;
  fetchImpl?: Fetch;
}

function validateUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ServiceError(400, 'INVALID_URL', 'specUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ServiceError(400, 'INVALID_URL', 'Only HTTP and HTTPS URLs are supported');
  }
  return url;
}

function parseDocument(body: string, contentType: string): unknown {
  try {
    if (contentType.includes('json')) return JSON.parse(body) as unknown;
    if (contentType.includes('yaml') || contentType.includes('yml') || contentType.includes('text/')) {
      return parseYaml(body) as unknown;
    }
    // Many specification hosts use application/octet-stream. Safely attempt both formats.
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return parseYaml(body) as unknown;
    }
  } catch {
    throw new ServiceError(422, 'INVALID_SPEC', 'Response is not valid JSON or YAML');
  }
}

function assertOpenApi(value: unknown): asserts value is OpenApiDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ServiceError(422, 'INVALID_SPEC', 'Specification must be an object');
  }
  const openapi = (value as Record<string, unknown>).openapi;
  if (typeof openapi !== 'string' || !openapi.startsWith('3.')) {
    throw new ServiceError(422, 'UNSUPPORTED_SPEC', 'Only OpenAPI 3.x specifications are supported');
  }
  const paths = (value as Record<string, unknown>).paths;
  if (paths !== undefined && (paths === null || typeof paths !== 'object' || Array.isArray(paths))) {
    throw new ServiceError(422, 'INVALID_SPEC', 'OpenAPI paths must be an object');
  }
}

export async function fetchAndNormalizeSpec(
  apiId: string,
  specUrl: string,
  options: FetchOptions,
): Promise<FetchSpecResponse> {
  const url = validateUrl(specUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(url, {
        signal: controller.signal,
        headers: { accept: 'application/json, application/yaml, text/yaml, text/plain' },
      });
    } catch (error) {
      if (controller.signal.aborted) throw new ServiceError(504, 'FETCH_TIMEOUT', 'Spec fetch timed out');
      throw new ServiceError(502, 'FETCH_FAILED', error instanceof Error ? error.message : 'Fetch failed');
    }
    if (!response.ok) {
      throw new ServiceError(502, 'UPSTREAM_ERROR', `Spec server returned HTTP ${response.status}`);
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > options.maxBytes) {
      throw new ServiceError(413, 'SPEC_TOO_LARGE', 'Specification exceeds the size limit');
    }
    const body = await response.text();
    if (Buffer.byteLength(body) > options.maxBytes) {
      throw new ServiceError(413, 'SPEC_TOO_LARGE', 'Specification exceeds the size limit');
    }
    const spec = parseDocument(body, response.headers.get('content-type')?.toLowerCase() ?? '');
    assertOpenApi(spec);
    return {
      apiId,
      hash: deterministicHash(spec),
      format: 'openapi',
      version: spec.openapi,
      spec,
    };
  } finally {
    clearTimeout(timer);
  }
}
