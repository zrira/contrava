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
const api = { id: 'api-1', name: 'Users API', specUrl: 'https://example.com/spec', status: 'ACTIVE', lastCheckedAt: null, createdAt: '2025-01-01', currentVersionHash: null, breakingChangesCount: 0, scanEnabled: false, scanIntervalMinutes: 60, nextScanAt: null };
function detailsFetch(input: string, init?: RequestInit) {
  if (init?.method === 'POST') return response({ jobId: 'job-12345678', status: 'PENDING' });
  if (init?.method === 'PATCH') return response({ ...api, scanEnabled: true, scanIntervalMinutes: 15 });
  if (input.endsWith('/snapshots') || input.endsWith('/jobs')) return response([]);
  return response(api);
}

afterEach(() => vi.unstubAllGlobals());

describe('Contrava web', () => {
  it('renders the tracked API list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => response([{ ...api, currentVersionHash: 'abcdef123456789', breakingChangesCount: 2 }])));
    renderAt('/apis');
    expect(await screen.findByRole('heading', { name: 'Users API' })).toBeInTheDocument();
    expect(screen.getByText('abcdef123456')).toBeInTheDocument();
  });

  it('renders scheduling controls and updates a schedule', async () => {
    const fetchMock = vi.fn().mockImplementation(detailsFetch);
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/apis/api-1');
    expect(await screen.findByText('Automatic scanning:')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.selectOptions(screen.getByLabelText('Scan interval'), '15');
    await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await screen.findByText('Saved');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/apis/api-1/schedule'), expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ scanEnabled: true, scanIntervalMinutes: 15 }) }));
  });

  it('queues a scan from API details', async () => {
    const fetchMock = vi.fn().mockImplementation(detailsFetch);
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/apis/api-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Scan now' }));
    expect(await screen.findByText(/Scan queued as job job-1234/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/apis/api-1/scan'), expect.objectContaining({ method: 'POST' }));
  });

  it('displays failed job details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => response({ data: [{ id: 'failed-job', apiId: 'api-1', status: 'FAILED', source: 'SCHEDULED', attempt: 3, maxAttempts: 3, scheduledFor: '2025-01-01', claimedAt: null, startedAt: '2025-01-01', completedAt: null, failedAt: '2025-01-01', lastError: 'spec worker unavailable', createdAt: '2025-01-01', api: { id: 'api-1', name: 'Users API' } }], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 } })));
    renderAt('/jobs');
    expect(await screen.findByText('spec worker unavailable')).toBeInTheDocument();
    expect(screen.getByText('FAILED', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('3/3')).toBeInTheDocument();
  });

  it('renders detected changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => response([{ id: 'change-1', currentSnapshotId: 'snap-2', severity: 'BREAKING', category: 'RESPONSE_TYPE_CHANGED', path: '/users/{id}', method: 'GET', description: 'Response property email changed from string to number', createdAt: '2025-01-01' }])));
    renderAt('/apis/api-1/changes');
    expect(await screen.findByText('Response property email changed from string to number')).toBeInTheDocument();
    expect(screen.getByText('BREAKING')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'GET /users/{id}' })).toBeInTheDocument());
  });
});
