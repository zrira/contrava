import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listApis } from '../api';
import { ErrorMessage, Loading, Status } from '../components/Status';
import { formatDate } from '../format';

export function ApisPage() {
  const query = useQuery({ queryKey: ['apis'], queryFn: listApis });
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorMessage error={query.error} />;
  return <><div className="page-title"><div><h1>Tracked APIs</h1><p>OpenAPI contracts monitored by Contrava.</p></div><Link className="button" to="/apis/new">Add API</Link></div>
    {!query.data?.length ? <div className="empty"><h2>No APIs tracked</h2><p>Add an OpenAPI URL to take the first snapshot.</p></div> : <div className="cards">{query.data.map((api) => <Link className="api-card" to={`/apis/${api.id}`} key={api.id}><div className="row"><h2>{api.name}</h2><Status value={api.status} /></div><p className="url">{api.specUrl}</p><dl><div><dt>Last checked</dt><dd>{formatDate(api.lastCheckedAt)}</dd></div><div><dt>Version hash</dt><dd><code>{api.currentVersionHash?.slice(0, 12) ?? '—'}</code></dd></div><div><dt>Breaking changes</dt><dd>{api.breakingChangesCount}</dd></div></dl></Link>)}</div>}
  </>;
}
