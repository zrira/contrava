import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createApi } from '../api';
import { ErrorMessage } from '../components/Status';

export function NewApiPage() {
  const navigate = useNavigate(); const client = useQueryClient();
  const [name, setName] = useState(''); const [specUrl, setSpecUrl] = useState('');
  const mutation = useMutation({ mutationFn: createApi, onSuccess: async (api) => { await client.invalidateQueries({ queryKey: ['apis'] }); void navigate(`/apis/${api.id}`); } });
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate({ name, specUrl }); };
  return <div className="narrow"><h1>Add API</h1><p>Register a public OpenAPI 3.x JSON or YAML document.</p><form onSubmit={submit}><label>Name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Users API" /></label><label>OpenAPI specification URL<input required type="url" value={specUrl} onChange={(event) => setSpecUrl(event.target.value)} placeholder="https://example.com/openapi.json" /></label>{mutation.error && <ErrorMessage error={mutation.error} />}<button disabled={mutation.isPending}>{mutation.isPending ? 'Adding…' : 'Add API'}</button></form></div>;
}
