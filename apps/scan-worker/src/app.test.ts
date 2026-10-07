import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('scan worker HTTP API', () => {
  it('reports health', async () => {
    await request(createApp()).get('/health').expect(200, { status: 'ok', service: 'scan-worker' });
  });
  it('validates documents', async () => {
    const response = await request(createApp()).post('/diff').send({ previous: {}, current: {} });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });
});
