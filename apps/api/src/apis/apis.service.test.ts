import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ApisService } from './apis.service';

describe('ApisService CRUD', () => {
  it('creates and lists tracked APIs with summary fields', async () => {
    const db = { trackedApi: { create: vi.fn().mockResolvedValue({ id: 'api-1', name: 'Users' }), findMany: vi.fn().mockResolvedValue([{ id: 'api-1', name: 'Users', snapshots: [{ contentHash: 'abc' }], _count: { changes: 2 } }]) } };
    const service = new ApisService(db as never);
    await expect(service.create({ name: 'Users', specUrl: 'https://example.com/openapi.json' })).resolves.toMatchObject({ id: 'api-1' });
    await expect(service.list()).resolves.toEqual([{ id: 'api-1', name: 'Users', currentVersionHash: 'abc', breakingChangesCount: 2 }]);
  });

  it('returns not found for unknown APIs', async () => {
    const db = { trackedApi: { findUnique: vi.fn().mockResolvedValue(null) } };
    await expect(new ApisService(db as never).get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
