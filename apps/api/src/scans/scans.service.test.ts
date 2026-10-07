import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ScansService } from './scans.service';

describe('ScansService', () => {
  it('lists scan history', async () => {
    const db = { scan: { findMany: vi.fn().mockResolvedValue([{ id: 'scan-1' }]) } };
    await expect(new ScansService(db as never).list()).resolves.toEqual([{ id: 'scan-1' }]);
  });

  it('rejects an unknown scan', async () => {
    const db = { scan: { findUnique: vi.fn().mockResolvedValue(null) } };
    await expect(new ScansService(db as never).get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
