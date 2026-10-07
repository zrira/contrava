import { describe, expect, it, vi } from 'vitest';
import { WorkerClientService, WorkerHttpError } from './worker-client.service';

describe('WorkerClientService retries', () => {
  it('retries transient failures and succeeds', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const promise = new WorkerClientService().requestWithRetry<{ ok: boolean }>('http://worker/test', {}, 'request-1', fetchImpl);
    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not retry invalid requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad input' } }), { status: 400, headers: { 'content-type': 'application/json' } }));
    await expect(new WorkerClientService().requestWithRetry('http://worker/test', {}, 'request-1', fetchImpl)).rejects.toBeInstanceOf(WorkerHttpError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
