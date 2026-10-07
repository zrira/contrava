import { describe, expect, it, vi } from 'vitest';
import { fetchAndNormalizeSpec } from './fetch-spec.js';

const jsonSpec = { openapi: '3.1.0', info: { title: 'Demo', version: '1' }, paths: {} };
const options = { timeoutMs: 50, maxBytes: 10_000 };

describe('fetchAndNormalizeSpec', () => {
  it('parses JSON OpenAPI and hashes object keys deterministically', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(jsonSpec), { headers: { 'content-type': 'application/json' } }),
    );
    const first = await fetchAndNormalizeSpec('1', 'https://example.com/openapi.json', { ...options, fetchImpl });
    const reordered = { paths: {}, info: { version: '1', title: 'Demo' }, openapi: '3.1.0' };
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(reordered)));
    const second = await fetchAndNormalizeSpec('1', 'https://example.com/openapi.json', { ...options, fetchImpl });
    expect(first.spec).toEqual(jsonSpec);
    expect(first.hash).toBe(second.hash);
  });

  it('parses YAML OpenAPI', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('openapi: 3.0.3\ninfo:\n  title: Demo\n  version: "1"\npaths: {}', {
        headers: { 'content-type': 'application/yaml' },
      }),
    );
    const result = await fetchAndNormalizeSpec('1', 'https://example.com/openapi.yaml', { ...options, fetchImpl });
    expect(result.version).toBe('3.0.3');
  });

  it('times out stalled requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    );
    await expect(fetchAndNormalizeSpec('1', 'https://example.com/spec', { ...options, timeoutMs: 5, fetchImpl })).rejects.toMatchObject({ code: 'FETCH_TIMEOUT' });
  });

  it('rejects invalid URLs and unsupported specs', async () => {
    await expect(fetchAndNormalizeSpec('1', 'file:///tmp/spec', options)).rejects.toMatchObject({ code: 'INVALID_URL' });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"swagger":"2.0"}'));
    await expect(fetchAndNormalizeSpec('1', 'https://example.com/spec', { ...options, fetchImpl })).rejects.toMatchObject({ code: 'UNSUPPORTED_SPEC' });
  });
});
