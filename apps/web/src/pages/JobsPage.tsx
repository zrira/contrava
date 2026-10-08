import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listJobs } from '../api';
import { ErrorMessage, Loading, Status } from '../components/Status';
import { formatDate } from '../format';

const filters = ['', 'PENDING', 'RUNNING', 'FAILED', 'COMPLETED'];
function duration(started: string | null, completed: string | null): string {
  if (!started) return '—';
  if (!completed) return 'In progress';
  return `${Math.max(0, Math.round((new Date(completed).getTime() - new Date(started).getTime()) / 1000))}s`;
}

export function JobsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['jobs', status, page], queryFn: () => listJobs(status || undefined, page), refetchInterval: 3000 });
  const jobs = query.data?.data;
  const totalPages = query.data?.pagination.totalPages ?? 0;
  return <><div className="page-title"><div><h1>Scan jobs</h1><p>The persisted PostgreSQL background work queue.</p></div><label className="filter">Status<select aria-label="Filter jobs by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>{filters.map((value) => <option key={value} value={value}>{value || 'ALL'}</option>)}</select></label></div>
    {query.isLoading ? <Loading /> : query.error ? <ErrorMessage error={query.error} /> : !jobs?.length ? <div className="empty"><h2>No jobs found</h2></div> : <><div className="table-wrap"><table><thead><tr><th>Job</th><th>API</th><th>Status</th><th>Attempt</th><th>Scheduled</th><th>Started</th><th>Duration</th><th>Last error</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><code title={job.id}>{job.id.slice(0, 8)}</code></td><td>{job.api ? <Link to={`/apis/${job.api.id}`}>{job.api.name}</Link> : job.apiId}</td><td><Status value={job.status} /></td><td>{job.attempt}/{job.maxAttempts}</td><td>{formatDate(job.scheduledFor)}</td><td>{formatDate(job.startedAt)}</td><td>{duration(job.startedAt, job.completedAt ?? job.failedAt)}</td><td className="error-text">{job.lastError ?? '—'}</td></tr>)}</tbody></table></div><div className="pagination"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {totalPages || 1}</span><button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div></>}
  </>;
}
