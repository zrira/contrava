import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { createRepository, listRepositories } from '../api';
import { ErrorMessage, Loading, Status } from '../components/Status';
import { formatDate } from '../format';

export function RepositoriesPage() {
  const client = useQueryClient(); const repositories = useQuery({ queryKey: ['repositories'], queryFn: listRepositories });
  const [owner, setOwner] = useState(''); const [name, setName] = useState(''); const [branch, setBranch] = useState('');
  const create = useMutation({ mutationFn: () => createRepository({ owner, name, ...(branch ? { selectedBranch: branch } : {}) }), onSuccess: async () => { setOwner(''); setName(''); setBranch(''); await client.invalidateQueries({ queryKey: ['repositories'] }); } });
  const submit = (event: FormEvent) => { event.preventDefault(); create.mutate(); };
  return <><div className="page-title"><div><h1>Repositories</h1><p>GitHub source indexes used for deterministic API impact analysis.</p></div></div>
    <form className="repository-form" onSubmit={submit}><label>Owner<input required value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="acme" /></label><label>Repository<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="web-app" /></label><label>Branch override<input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="default branch" /></label><button disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add repository'}</button></form>{create.error && <ErrorMessage error={create.error} />}
    {repositories.isLoading ? <Loading /> : repositories.error ? <ErrorMessage error={repositories.error} /> : <div className="cards">{repositories.data?.map((repository) => <Link className="api-card" to={`/repositories/${repository.id}`} key={repository.id}><div className="row"><h2>{repository.fullName}</h2><Status value={repository.status} /></div><p>{repository.selectedBranch ?? repository.defaultBranch ?? 'Branch resolves on first scan'}</p><dl><div><dt>Files</dt><dd>{repository._count.sourceFiles}</dd></div><div><dt>API usages</dt><dd>{repository._count.usages}</dd></div><div><dt>Last indexed</dt><dd>{formatDate(repository.lastIndexedAt)}</dd></div></dl></Link>)}</div>}
  </>;
}
