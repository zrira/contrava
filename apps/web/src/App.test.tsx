import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>);
}
const response = (value: unknown) => Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } }));

afterEach(() => vi.unstubAllGlobals());

describe('Contrava web', () => {
  it('renders the tracked API list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => response([{ id: 'api-1', name: 'Users API', specUrl: 'https://example.com/openapi.json', status: 'ACTIVE', lastCheckedAt: null, createdAt: '2025-01-01', currentVersionHash: 'abcdef123456789', breakingChangesCount: 2 }])));
    renderAt('/apis');
    expect(await screen.findByRole('heading', { name: 'Users API' })).toBeInTheDocument();
    expect(screen.getByText('abcdef123456')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('triggers a scan from API details', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response({ id: 'scan-1', apiId: 'api-1', status: 'COMPLETED' });
      if (input.endsWith('/snapshots')) return response([]);
      return response({ id: 'api-1', name: 'Users API', specUrl: 'https://example.com/spec', status: 'ACTIVE', lastCheckedAt: null, createdAt: '2025-01-01', currentVersionHash: null, breakingChangesCount: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/apis/api-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Run scan' }));
    expect(await screen.findByText('Scan completed.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/apis/api-1/scan'), expect.objectContaining({ method: 'POST' }));
  });

  it('renders detected changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => response([{ id: 'change-1', currentSnapshotId: 'snap-2', severity: 'BREAKING', category: 'RESPONSE_TYPE_CHANGED', path: '/users/{id}', method: 'GET', description: 'Response property email changed from string to number', createdAt: '2025-01-01' }])));
    renderAt('/apis/api-1/changes');
    expect(await screen.findByText('Response property email changed from string to number')).toBeInTheDocument();
    expect(screen.getByText('BREAKING')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'GET /users/{id}' })).toBeInTheDocument());
  });
});
