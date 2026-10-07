import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';

describe('spec worker HTTP API', () => {
  it('reports health and returns structured validation errors', async () => {
    await request(createApp()).get('/health').expect(200, { status: 'ok', service: 'spec-worker' });
    const response = await request(createApp({ fetchImpl: vi.fn() })).post('/fetch-spec').send({});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });
});
