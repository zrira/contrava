import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getImpact, listChanges, type Change } from '../api';
import { ErrorMessage, Loading, Status } from '../components/Status';
import { formatDate } from '../format';

function ChangeImpact({ apiId, change }: { apiId: string; change: Change }) {
  const impact = useQuery({ queryKey: ['impact', apiId, change.id], queryFn: () => getImpact(apiId, change.id), enabled: change.severity !== 'NON_BREAKING' });
  if (change.severity === 'NON_BREAKING') return null;
  if (impact.isLoading) return <p className="muted">Loading repository impact…</p>;
  if (impact.error) return <ErrorMessage error={impact.error} />;
  if (!impact.data || !Array.isArray(impact.data.findings)) return null;
  if (!impact.data.findings.length) return <p className="muted">No linked repository usage matched this operation.</p>;
  const summary = impact.data.summary;
  return <div className="impact"><h3>Repository impact</h3><p><strong>{summary.repositories}</strong> repositories · <strong>{summary.files}</strong> files · <strong>{summary.callSites}</strong> call sites · {summary.high} HIGH / {summary.medium} MEDIUM / {summary.low} LOW</p>
    {impact.data.findings.map((finding) => { const stale = finding.repository.headCommitSha && finding.repository.headCommitSha !== finding.indexedCommitSha; return <div className="impact-finding" key={finding.id}><div className="row"><Link to={`/repositories/${finding.repository.id}`}>{finding.repository.fullName}</Link><Status value={finding.confidence} /></div><code>{finding.path}:{finding.line}</code><p>{finding.reason}</p><pre className="snippet">{finding.apiUsage.snippet}</pre>{stale && <p className="warning compact">Based on indexed commit {finding.indexedCommitSha.slice(0, 12)}; resolved head is {finding.repository.headCommitSha?.slice(0, 12)}.</p>}</div>; })}
  </div>;
}

export function ChangesPage() {
  const { id = '' } = useParams(); const query = useQuery({ queryKey: ['changes', id], queryFn: () => listChanges(id) });
  if (query.isLoading) return <Loading />; if (query.error) return <ErrorMessage error={query.error} />;
  return <><Link to={`/apis/${id}`}>← API details</Link><h1>Change history</h1>{!query.data?.length ? <div className="empty"><h2>No changes detected</h2><p>Changes will appear after two different snapshots are compared.</p></div> : <div className="change-list">{query.data.map((change) => <article key={change.id}><div className="row"><Status value={change.severity} /><time>{formatDate(change.createdAt)}</time></div><h2>{change.method && `${change.method} `}{change.path}</h2><p>{change.description}</p><code>{change.category}</code><ChangeImpact apiId={id} change={change} /></article>)}</div>}</>;
}
