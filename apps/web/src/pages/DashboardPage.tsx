import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listApis, listScans, listWorkers } from '../api';
import { ErrorMessage, Loading, Status } from '../components/Status';
import { formatDate } from '../format';

export function DashboardPage() {
  const apis = useQuery({ queryKey: ['apis'], queryFn: listApis });
  const scans = useQuery({ queryKey: ['scans'], queryFn: listScans });
  const workers = useQuery({ queryKey: ['workers'], queryFn: listWorkers });
  const error = apis.error ?? scans.error ?? workers.error;
  if (apis.isLoading || scans.isLoading || workers.isLoading) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  const failed = scans.data?.filter((scan) => scan.status === 'FAILED') ?? [];
  return <><div className="page-title"><div><h1>Dashboard</h1><p>Contract health at a glance.</p></div><Link className="button" to="/apis/new">Add API</Link></div>
    <section className="metrics"><article><span>Tracked APIs</span><strong>{apis.data?.length ?? 0}</strong></article><article><span>Breaking changes</span><strong>{apis.data?.reduce((sum, api) => sum + api.breakingChangesCount, 0) ?? 0}</strong></article><article><span>Failed scans</span><strong>{failed.length}</strong></article><article><span>Healthy workers</span><strong>{workers.data?.filter((worker) => worker.status === 'HEALTHY').length ?? 0}/{workers.data?.length ?? 0}</strong></article></section>
    <section><h2>Latest scans</h2>{!scans.data?.length ? <p className="muted">No scans have run yet.</p> : <div className="table-wrap"><table><thead><tr><th>API</th><th>Status</th><th>Started</th><th>Result</th></tr></thead><tbody>{scans.data.slice(0, 8).map((scan) => <tr key={scan.id}><td>{scan.api ? <Link to={`/apis/${scan.api.id}`}>{scan.api.name}</Link> : scan.apiId}</td><td><Status value={scan.status} /></td><td>{formatDate(scan.startedAt)}</td><td className="error-text">{scan.error ?? '—'}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
