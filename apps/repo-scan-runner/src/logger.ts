const SENSITIVE = /authorization|token|secret|password|private.?key/i;
export function log(event: string, fields: Record<string, unknown> = {}): void {
  const safe = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, SENSITIVE.test(key) ? '[REDACTED]' : value]));
  console.info(JSON.stringify({ service: 'repo-scan-runner', event, ...safe }));
}
