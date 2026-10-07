import { useQuery } from '@tanstack/react-query';
import { listWorkers } from '../api';
import { ErrorMessage, Loading, Status } from '../components/Status';
export function WorkersPage() { const query = useQuery({ queryKey: ['workers'], queryFn: listWorkers, refetchInterval: 10_000 }); if (query.isLoading) return <Loading />; if (query.error) return <ErrorMessage error={query.error} />; return <><h1>Worker status</h1><p>Live health checks from the control plane.</p><div className="cards">{query.data?.map((worker) => <article className="worker-card" key={worker.name}><div className="row"><h2>{worker.name}</h2><Status value={worker.status} /></div><p>{worker.latencyMs !== undefined ? `${worker.latencyMs} ms` : worker.error}</p></article>)}</div></>; }
