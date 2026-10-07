export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function postJson<T>(url: string, body: unknown, requestId: string, timeoutMs: number, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-request-id': requestId }, body: JSON.stringify(body) });
      const payload = await response.json() as T | { message?: string; error?: { message?: string } };
      if (!response.ok) {
        const detail = payload as { message?: string; error?: { message?: string } };
        throw new HttpError(response.status, detail.message ?? detail.error?.message ?? `HTTP ${response.status}`);
      }
      return payload as T;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) throw error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250));
    } finally { clearTimeout(timer); }
  }
  throw lastError instanceof Error ? lastError : new Error('HTTP request failed');
}
