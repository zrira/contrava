import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { listChanges } from '../api';
import { ErrorMessage, Loading, Status } from '../components/Status';
import { formatDate } from '../format';

export function ChangesPage() {
  const { id = '' } = useParams(); const query = useQuery({ queryKey: ['changes', id], queryFn: () => listChanges(id) });
  if (query.isLoading) return <Loading />; if (query.error) return <ErrorMessage error={query.error} />;
  return <><Link to={`/apis/${id}`}>← API details</Link><h1>Change history</h1>{!query.data?.length ? <div className="empty"><h2>No changes detected</h2><p>Changes will appear after two different snapshots are compared.</p></div> : <div className="change-list">{query.data.map((change) => <article key={change.id}><div className="row"><Status value={change.severity} /><time>{formatDate(change.createdAt)}</time></div><h2>{change.method && `${change.method} `}{change.path}</h2><p>{change.description}</p><code>{change.category}</code></article>)}</div>}</>;
}
