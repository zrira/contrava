import { describe, expect, it } from 'vitest';
import type { OpenApiDocument } from '@contrava/shared';
import { diffSpecs } from './diff.js';

const operation = (schema: object = {}) => ({ responses: { '200': { content: { 'application/json': { schema } } } } });
const spec = (paths: Record<string, unknown>): OpenApiDocument => ({ openapi: '3.1.0', paths });

describe('diffSpecs', () => {
  it('reports endpoint additions and removals', () => {
    expect(diffSpecs(spec({ '/old': { get: operation() } }), spec({ '/new': { get: operation() } }))).toEqual([
      expect.objectContaining({ category: 'ENDPOINT_REMOVED', severity: 'BREAKING', path: '/old' }),
      expect.objectContaining({ category: 'ENDPOINT_ADDED', severity: 'NON_BREAKING', path: '/new' }),
    ]);
  });

  it('reports a newly required request property as breaking', () => {
    const old = spec({ '/users': { post: { ...operation(), requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {} } } } } } } });
    const current = spec({ '/users': { post: { ...operation(), requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } } } } } } } });
    expect(diffSpecs(old, current)).toContainEqual(expect.objectContaining({ category: 'REQUEST_PROPERTY_ADDED', severity: 'BREAKING' }));
  });

  it('reports response removal and type changes', () => {
    const old = spec({ '/users': { get: operation({ type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } } }) } });
    const current = spec({ '/users': { get: operation({ type: 'object', properties: { email: { type: 'number' } } }) } });
    const changes = diffSpecs(old, current);
    expect(changes).toContainEqual(expect.objectContaining({ category: 'RESPONSE_TYPE_CHANGED', severity: 'BREAKING' }));
    expect(changes).toContainEqual(expect.objectContaining({ category: 'RESPONSE_PROPERTY_REMOVED', severity: 'BREAKING' }));
  });

  it('returns stable empty output for unchanged specs', () => {
    const document = spec({ '/users': { get: operation() } });
    expect(diffSpecs(document, structuredClone(document))).toEqual([]);
    expect(diffSpecs(document, structuredClone(document))).toEqual([]);
  });
});
