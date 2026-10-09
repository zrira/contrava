import { describe, expect, it } from 'vitest';
import { extractApiUsages, normalizeEndpoint, pathsCompatible } from './index.js';

describe('endpoint normalization', () => {
  it.each([
    ['/users/123', '/users/{param}'],
    ['/users/${id}', '/users/{param}'],
    ['/users/{id}', '/users/{param}'],
    ['https://api.example.com/users/123?expand=true', '/users/{param}'],
    ['/users/123/', '/users/{param}'],
  ])('normalizes %s', (input, expected) => expect(normalizeEndpoint(input)).toBe(expected));
  it('compares parameter names as wildcards', () => expect(pathsCompatible('/users/{param}', '/users/{id}')).toBe(true));
});

describe('TypeScript API usage extractor', () => {
  it('extracts fetch literals without matching comments or dead strings', () => {
    const usages = extractApiUsages('client.ts', `// fetch('/ignored')\nconst text = "axios.get('/dead')";\nfetch('/users/123');`);
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ httpMethod: 'GET', endpointPattern: '/users/{param}', matchType: 'STATIC_LITERAL', confidence: 'HIGH', line: 3 });
  });
  it('extracts template strings and base URL joins', () => {
    const usages = extractApiUsages('client.ts', "const baseUrl = 'https://api.test';\nfetch(`${baseUrl}/users/${id}`);");
    expect(usages[0]).toMatchObject({ endpointPattern: '/users/{param}', matchType: 'BASE_URL_JOIN' });
  });
  it('extracts axios methods and concatenation', () => {
    const usages = extractApiUsages('client.js', "axios.post('/users/' + id, body);");
    expect(usages[0]).toMatchObject({ httpMethod: 'POST', endpointPattern: '/users/{param}', matchType: 'HTTP_CLIENT_CALL' });
  });
  it('extracts axios and custom request config objects', () => {
    const source = "axios({ method: 'DELETE', url: '/users/' + id });\napiClient.request({ method: 'GET', url: '/teams/123' });";
    expect(extractApiUsages('client.ts', source)).toMatchObject([
      { httpMethod: 'DELETE', endpointPattern: '/users/{param}' },
      { httpMethod: 'GET', endpointPattern: '/teams/{param}' },
    ]);
  });
  it('marks custom wrapper calls as medium confidence', () => {
    expect(extractApiUsages('hooks.ts', "userClient.get('/users/' + id)" )[0]).toMatchObject({ matchType: 'WRAPPER_CALL', confidence: 'MEDIUM' });
  });
  it('ignores fully dynamic URLs and unrelated get methods', () => {
    const source = 'fetch(url);\nmap.get(\'/users/1\');';
    expect(extractApiUsages('client.ts', source)).toEqual([]);
  });
});
