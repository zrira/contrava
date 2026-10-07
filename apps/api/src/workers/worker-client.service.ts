import { BadGatewayException, Injectable } from '@nestjs/common';
import type { DiffResponse, FetchSpecResponse, OpenApiDocument, WorkerHealth } from '@contrava/shared';

export class WorkerHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

@Injectable()
export class WorkerClientService {
  private readonly timeoutMs = Number(process.env.WORKER_TIMEOUT_MS ?? 5000);
  private readonly specUrl = process.env.SPEC_WORKER_URL ?? 'http://localhost:3001';
  private readonly scanUrl = process.env.SCAN_WORKER_URL ?? 'http://localhost:3002';
  private readonly runnerUrl = process.env.SCAN_RUNNER_URL ?? 'http://localhost:3003';

  async requestWithRetry<T>(url: string, body: unknown, requestId: string, fetchImpl: typeof fetch = fetch): Promise<T> {
    const delays = [250, 500];
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetchImpl(url, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-request-id': requestId }, body: JSON.stringify(body) });
        const payload = (await response.json()) as T | { error?: { message?: string } };
        if (!response.ok) {
          const message = 'error' in (payload as object) ? (payload as { error?: { message?: string } }).error?.message : undefined;
          throw new WorkerHttpError(response.status, message ?? `Worker returned HTTP ${response.status}`);
        }
        return payload as T;
      } catch (error) {
        lastError = error;
        if (error instanceof WorkerHttpError && error.status >= 400 && error.status < 500) throw error;
        if (attempt < delays.length) await sleep(delays[attempt]!);
      } finally { clearTimeout(timer); }
    }
    throw new BadGatewayException(lastError instanceof Error ? lastError.message : 'Worker request failed');
  }

  fetchSpec(apiId: string, specUrl: string, requestId: string) { return this.requestWithRetry<FetchSpecResponse>(`${this.specUrl}/fetch-spec`, { apiId, specUrl }, requestId); }
  diff(previous: OpenApiDocument, current: OpenApiDocument, requestId: string) { return this.requestWithRetry<DiffResponse>(`${this.scanUrl}/diff`, { previous, current }, requestId); }

  async health(name: string, baseUrl: string, requestId: string): Promise<WorkerHealth> {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 2000));
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: controller.signal, headers: { 'x-request-id': requestId } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { name, status: 'HEALTHY', latencyMs: Math.round(performance.now() - started) };
    } catch (error) { return { name, status: 'UNAVAILABLE', error: error instanceof Error ? error.message : 'Unknown error' }; }
    finally { clearTimeout(timer); }
  }

  workerDefinitions() { return [{ name: 'spec-worker', baseUrl: this.specUrl }, { name: 'scan-worker', baseUrl: this.scanUrl }, { name: 'scan-runner', baseUrl: this.runnerUrl }]; }
}
