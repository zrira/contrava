import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getApi, linkRepository, listApiJobs, listRepositories, listSnapshots, runScan, updateSchedule } from '../api';
import { ErrorMessage, Loading, Status } from '../components/Status';
import { formatDate } from '../format';

const intervals = [[5, '5m'], [15, '15m'], [30, '30m'], [60, '1h'], [360, '6h'], [1440, '24h']] as const;

function ScheduleControls({ apiId, enabled, interval }: { apiId: string; enabled: boolean; interval: number }) {
  const client = useQueryClient();
  const [scanEnabled, setEnabled] = useState(enabled);
  const [scanIntervalMinutes, setIntervalMinutes] = useState(interval);
  const mutation = useMutation({ mutationFn: () => updateSchedule(apiId, { scanEnabled, scanIntervalMinutes }), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['api', apiId] }), client.invalidateQueries({ queryKey: ['apis'] })]); } });
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate(); };
  return <form className="schedule-form" onSubmit={submit}><label className="toggle"><input type="checkbox" checked={scanEnabled} onChange={(event) => setEnabled(event.target.checked)} />Automatic scanning: <strong>{scanEnabled ? 'ON' : 'OFF'}</strong></label><label>Scan interval<select aria-label="Scan interval" value={scanIntervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}>{intervals.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save schedule'}</button>{mutation.isSuccess && <span className="success-inline">Saved</span>}</form>;
}

export function ApiDetailsPage() {
  const { id = '' } = useParams(); const client = useQueryClient();
  const api = useQuery({ queryKey: ['api', id], queryFn: () => getApi(id) });
  const snapshots = useQuery({ queryKey: ['snapshots', id], queryFn: () => listSnapshots(id) });
  const jobs = useQuery({ queryKey: ['api-jobs', id], queryFn: () => listApiJobs(id), refetchInterval: 3000 });
  const repositories = useQuery({ queryKey: ['repositories'], queryFn: listRepositories });
  const [repositoryId, setRepositoryId] = useState('');
  const link = useMutation({ mutationFn: () => linkRepository(id, repositoryId), onSuccess: async () => { setRepositoryId(''); await client.invalidateQueries({ queryKey: ['api', id] }); } });
  const scan = useMutation({ mutationFn: () => runScan(id), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['api-jobs', id] }), client.invalidateQueries({ queryKey: ['jobs'] })]); } });
  if (api.isLoading || snapshots.isLoading || jobs.isLoading || repositories.isLoading) return <Loading />; const error = api.error ?? snapshots.error ?? jobs.error ?? repositories.error; if (error) return <ErrorMessage error={error} />;
  const currentJob = jobs.data?.find((job) => ['PENDING', 'CLAIMED', 'RUNNING', 'RETRY_SCHEDULED'].includes(job.status));
  return <><Link to="/apis">← Tracked APIs</Link><div className="page-title"><div><div className="row title-row"><h1>{api.data?.name}</h1>{api.data && <Status value={api.data.status} />}</div><p className="url">{api.data?.specUrl}</p></div><button onClick={() => scan.mutate()} disabled={scan.isPending}>{scan.isPending ? 'Queuing…' : 'Scan now'}</button></div>
    {scan.error && <ErrorMessage error={scan.error} />}{scan.isSuccess && <p className="success">Scan queued as job {scan.data.jobId.slice(0, 8)}.</p>}
    {api.data && <ScheduleControls key={`${api.data.scanEnabled}-${api.data.scanIntervalMinutes}`} apiId={id} enabled={api.data.scanEnabled} interval={api.data.scanIntervalMinutes} />}
    <section className="details"><div><span>Last scan</span><strong>{formatDate(api.data?.lastCheckedAt ?? null)}</strong></div><div><span>Next scheduled scan</span><strong>{api.data?.scanEnabled ? formatDate(api.data.nextScanAt) : 'Disabled'}</strong></div><div><span>Current job</span><strong>{currentJob ? <Status value={currentJob.status} /> : 'None'}</strong></div><div><span>Current hash</span><strong><code>{api.data?.currentVersionHash?.slice(0, 16) ?? 'No snapshot'}</code></strong></div></section>
    <section><div className="section-title"><h2>Linked repositories</h2></div>{!api.data?.repositoryLinks?.length ? <p className="muted">No repositories linked.</p> : <div className="linked-list">{api.data.repositoryLinks.map((item) => <Link key={item.repository.id} to={`/repositories/${item.repository.id}`}>{item.repository.fullName} <code>{item.repository.lastIndexedCommitSha?.slice(0, 8) ?? 'not indexed'}</code></Link>)}</div>}<div className="link-control"><select aria-label="Repository to link" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}><option value="">Select repository</option>{(Array.isArray(repositories.data) ? repositories.data : []).filter((repository) => !api.data?.repositoryLinks?.some((item) => item.repository.id === repository.id)).map((repository) => <option value={repository.id} key={repository.id}>{repository.fullName}</option>)}</select><button disabled={!repositoryId || link.isPending} onClick={() => link.mutate()}>Link repository</button></div>{link.error && <ErrorMessage error={link.error} />}</section>
    <div className="section-title"><h2>Snapshot timeline</h2><Link to={`/apis/${id}/changes`}>View all changes</Link></div>
    <div className="timeline">{!snapshots.data?.length ? <div className="empty"><p>Queue the first scan to create a baseline.</p></div> : snapshots.data.map((snapshot, index) => { const breaking = snapshot.currentChanges.filter((change) => change.severity === 'BREAKING').length; return <article key={snapshot.id}><time>{formatDate(snapshot.createdAt)}</time><h3>{index === snapshots.data.length - 1 && snapshot.currentChanges.length === 0 ? 'Initial snapshot' : snapshot.currentChanges.length ? `${snapshot.currentChanges.length} changes detected` : 'No changes'}</h3>{snapshot.currentChanges.length > 0 && <p><strong>{breaking} BREAKING</strong> · {snapshot.currentChanges.length - breaking} other</p>}<code>{snapshot.contentHash.slice(0, 12)}</code></article>; })}</div>
  </>;
}
