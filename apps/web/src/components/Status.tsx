export function Status({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase()}`}>{value.replaceAll('_', ' ')}</span>; }
export function Loading() { return <p className="muted">Loading…</p>; }
export function ErrorMessage({ error }: { error: Error }) { return <p role="alert" className="error">{error.message}</p>; }
