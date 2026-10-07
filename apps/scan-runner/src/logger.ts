export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ service: 'scan-runner', event, ...fields }));
}
