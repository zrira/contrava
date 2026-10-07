import { describe, expect, it, vi } from 'vitest';
import { ScansService } from './scans.service';

function database(previous: null | { id: string; contentHash: string; rawSpec: string } = null) {
  const db = {
    trackedApi: { findUnique: vi.fn().mockResolvedValue({ id: 'api-1', specUrl: 'https://example.com/spec' }), update: vi.fn().mockResolvedValue({}) },
    scan: { create: vi.fn().mockResolvedValue({ id: 'scan-1' }), update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'scan-1', ...data })) },
    apiSnapshot: { findFirst: vi.fn().mockResolvedValue(previous), create: vi.fn().mockResolvedValue({ id: 'snapshot-new' }) },
    apiChange: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((input: unknown) => typeof input === 'function' ? (input as (client: typeof db) => unknown)(db) : Promise.all(input as Promise<unknown>[]));
  return db;
}

const fetched = { apiId: 'api-1', hash: 'new-hash', format: 'openapi' as const, version: '3.1.0', spec: { openapi: '3.1.0', paths: {} } };

describe('ScansService orchestration', () => {
  it('stores an initial snapshot without diffing', async () => {
    const db = database();
    const workers = { fetchSpec: vi.fn().mockResolvedValue(fetched), diff: vi.fn() };
    await new ScansService(db as never, workers as never).run('api-1', 'request-1');
    expect(db.apiSnapshot.create).toHaveBeenCalledOnce();
    expect(workers.diff).not.toHaveBeenCalled();
    expect(db.scan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }));
  });

  it('does not duplicate an unchanged snapshot', async () => {
    const db = database({ id: 'old', contentHash: 'new-hash', rawSpec: JSON.stringify(fetched.spec) });
    const workers = { fetchSpec: vi.fn().mockResolvedValue(fetched), diff: vi.fn() };
    await new ScansService(db as never, workers as never).run('api-1', 'request-1');
    expect(db.apiSnapshot.create).not.toHaveBeenCalled();
    expect(workers.diff).not.toHaveBeenCalled();
  });

  it('diffs and persists changes only after the worker succeeds', async () => {
    const db = database({ id: 'old', contentHash: 'old-hash', rawSpec: JSON.stringify(fetched.spec) });
    const workers = { fetchSpec: vi.fn().mockResolvedValue(fetched), diff: vi.fn().mockResolvedValue({ changes: [{ severity: 'BREAKING', category: 'ENDPOINT_REMOVED', path: '/old', method: null, description: 'removed' }] }) };
    await new ScansService(db as never, workers as never).run('api-1', 'request-1');
    expect(db.apiChange.create).toHaveBeenCalledOnce();
  });

  it('marks failures and leaves snapshots untouched when diff fails', async () => {
    const db = database({ id: 'old', contentHash: 'old-hash', rawSpec: JSON.stringify(fetched.spec) });
    const workers = { fetchSpec: vi.fn().mockResolvedValue(fetched), diff: vi.fn().mockRejectedValue(new Error('diff unavailable')) };
    await expect(new ScansService(db as never, workers as never).run('api-1', 'request-1')).rejects.toThrow('Scan failed');
    expect(db.apiSnapshot.create).not.toHaveBeenCalled();
    expect(db.scan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
  });
});
