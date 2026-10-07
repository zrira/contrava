import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getApi, listSnapshots, runScan } from '../api';
import { ErrorMessage, Loading, Status } from '../components/Status';
import { formatDate } from '../format';

export function ApiDetailsPage() {
  const { id = '' } = useParams(); const client = useQueryClient();
  const api = useQuery({ queryKey: ['api', id], queryFn: () => getApi(id) });
  const snapshots = useQuery({ queryKey: ['snapshots', id], queryFn: () => listSnapshots(id) });
  const scan = useMutation({ mutationFn: () => runScan(id), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['api', id] }), client.invalidateQueries({ queryKey: ['apis'] }), client.invalidateQueries({ queryKey: ['snapshots', id] }), client.invalidateQueries({ queryKey: ['changes', id] }), client.invalidateQueries({ queryKey: ['scans'] })]); } });
  if (api.isLoading || snapshots.isLoading) return <Loading />; const error = api.error ?? snapshots.error; if (error) return <ErrorMessage error={error} />;
  return <><Link to="/apis">← Tracked APIs</Link><div className="page-title"><div><div className="row title-row"><h1>{api.data?.name}</h1>{api.data && <Status value={api.data.status} />}</div><p className="url">{api.data?.specUrl}</p></div><button onClick={() => scan.mutate()} disabled={scan.isPending}>{scan.isPending ? 'Scanning…' : 'Run scan'}</button></div>
    {scan.error && <ErrorMessage error={scan.error} />}{scan.isSuccess && <p className="success">Scan completed.</p>}
    <section className="details"><div><span>Last checked</span><strong>{formatDate(api.data?.lastCheckedAt ?? null)}</strong></div><div><span>Current hash</span><strong><code>{api.data?.currentVersionHash?.slice(0, 16) ?? 'No snapshot'}</code></strong></div><div><span>Breaking changes</span><strong>{api.data?.breakingChangesCount}</strong></div></section>
    <div className="section-title"><h2>Snapshot timeline</h2><Link to={`/apis/${id}/changes`}>View all changes</Link></div>
    <div className="timeline">{!snapshots.data?.length ? <div className="empty"><p>Run the first scan to create a baseline.</p></div> : snapshots.data.map((snapshot, index) => { const breaking = snapshot.currentChanges.filter((change) => change.severity === 'BREAKING').length; return <article key={snapshot.id}><time>{formatDate(snapshot.createdAt)}</time><h3>{index === snapshots.data.length - 1 && snapshot.currentChanges.length === 0 ? 'Initial snapshot' : snapshot.currentChanges.length ? `${snapshot.currentChanges.length} changes detected` : 'No changes'}</h3>{snapshot.currentChanges.length > 0 && <p><strong>{breaking} BREAKING</strong> · {snapshot.currentChanges.length - breaking} other</p>}<code>{snapshot.contentHash.slice(0, 12)}</code></article>; })}</div>
  </>;
}
