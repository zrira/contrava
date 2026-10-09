import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getQueueMetrics, getSystemHealth, listApis, listJobs, listScans, listWorkers } from '../api';
import { ErrorMessage, Loading, Status } from '../components/Status';
import { formatDate } from '../format';

export function DashboardPage() {
  const apis = useQuery({ queryKey: ['apis'], queryFn: listApis });
  const scans = useQuery({ queryKey: ['scans'], queryFn: listScans });
  const jobs = useQuery({ queryKey: ['jobs', 'FAILED', 1], queryFn: () => listJobs('FAILED', 1, 5) });
  const metrics = useQuery({ queryKey: ['job-metrics'], queryFn: getQueueMetrics, refetchInterval: 3000 });
  const workers = useQuery({ queryKey: ['workers'], queryFn: listWorkers });
  const health = useQuery({ queryKey: ['system-health'], queryFn: getSystemHealth, refetchInterval: 3000 });
  const error = apis.error ?? scans.error ?? jobs.error ?? metrics.error ?? workers.error ?? health.error;
  if (apis.isLoading || scans.isLoading || jobs.isLoading || metrics.isLoading || workers.isLoading || health.isLoading) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  const failed = jobs.data?.data ?? [];
  const oldest = metrics.data?.oldestPendingAgeSeconds;
  return <><div className="page-title"><div><h1>Dashboard</h1><p>Contract monitoring, RabbitMQ delivery, and durable PostgreSQL state.</p></div><Link className="button" to="/apis/new">Add API</Link></div>
    <section className="metrics"><article><span>Scheduled APIs</span><strong>{apis.data?.filter((api) => api.scanEnabled).length ?? 0}</strong></article><article><span>Pending</span><strong>{metrics.data?.pending ?? 0}</strong></article><article><span>Running</span><strong>{metrics.data?.active ?? 0}</strong></article><article><span>Retrying</span><strong>{metrics.data?.retrying ?? 0}</strong></article><article><span>Failed</span><strong>{metrics.data?.failed ?? 0}</strong></article><article><span>Oldest pending</span><strong>{oldest === null || oldest === undefined ? '—' : `${oldest}s`}</strong></article><article><span>Healthy workers</span><strong>{workers.data?.filter((worker) => worker.status === 'HEALTHY').length ?? 0}/{workers.data?.length ?? 0}</strong></article><article><span>RabbitMQ</span><strong className="metric-status"><Status value={health.data?.rabbitmq.status ?? 'UNAVAILABLE'} /></strong></article><article><span>Outbox pending</span><strong>{metrics.data?.outboxPending ?? 0}</strong></article><article><span>Messages published</span><strong>{metrics.data?.messagesPublished ?? 0}</strong></article><article><span>Dead-lettered</span><strong>{health.data?.rabbitmq.dlqDepth ?? metrics.data?.deadLettered ?? 0}</strong></article></section>
    <section><div className="section-title"><h2>Recent failed jobs</h2><Link to="/jobs">View jobs</Link></div>{!failed.length ? <p className="muted">No failed jobs.</p> : <div className="table-wrap"><table><thead><tr><th>API</th><th>Attempt</th><th>Failed</th><th>Error</th></tr></thead><tbody>{failed.slice(0, 5).map((job) => <tr key={job.id}><td>{job.api?.name ?? job.apiId}</td><td>{job.attempt}/{job.maxAttempts}</td><td>{formatDate(job.failedAt)}</td><td className="error-text">{job.lastError}</td></tr>)}</tbody></table></div>}</section>
    <section><h2>Latest scans</h2>{!scans.data?.length ? <p className="muted">No scans have completed yet.</p> : <div className="table-wrap"><table><thead><tr><th>API</th><th>Status</th><th>Started</th><th>Result</th></tr></thead><tbody>{scans.data.slice(0, 8).map((scan) => <tr key={scan.id}><td>{scan.api ? <Link to={`/apis/${scan.api.id}`}>{scan.api.name}</Link> : scan.apiId}</td><td><Status value={scan.status} /></td><td>{formatDate(scan.startedAt)}</td><td className="error-text">{scan.error ?? '—'}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
