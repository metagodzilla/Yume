import type { CatalogCheckpoint } from '@/src/lib/checkpoints';
import { isCheckpoint } from '@/src/lib/checkpoints';
import { normalizeSaladKey } from '@/src/lib/saladCloud';

export type UseJob = {
  id: string;
  versionId: number;
  state: string;
  stage: string;
  percent: number | null;
  error: string;
  record?: CatalogCheckpoint | null;
};

export type CatalogResponse = {
  models: CatalogCheckpoint[];
  activeVersionId: number | null;
};

export async function fetchResources(endpoint: string, apiKey: string): Promise<CatalogResponse> {
  const response = await fetch(`${endpoint}/models`, { headers: authHeaders(apiKey) });
  const raw = await response.text();
  if (!response.ok) throw new Error(readable(raw) || `HTTP ${response.status}.`);
  const body = JSON.parse(raw) as { models?: CatalogCheckpoint[]; activeVersionId?: number | null };
  return {
    models: body.models ?? [],
    activeVersionId: typeof body.activeVersionId === 'number' ? body.activeVersionId : null,
  };
}

export async function fetchCatalog(endpoint: string, apiKey: string): Promise<CatalogResponse> {
  const catalog = await fetchResources(endpoint, apiKey);
  return { ...catalog, models: catalog.models.filter(isCheckpoint) };
}

export async function runCheckpointUse(input: {
  endpoint: string;
  apiKey: string;
  versionId: number;
  onProgress: (stage: string, percent: number | null) => void;
}): Promise<UseJob> {
  const headers = { ...authHeaders(input.apiKey), 'Content-Type': 'application/json' };
  const response = await fetch(`${input.endpoint}/models/use`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ versionId: input.versionId }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(readable(raw) || `HTTP ${response.status}.`);
  let job = JSON.parse(raw) as UseJob;
  input.onProgress(job.stage || 'Loading checkpoint', job.percent ?? null);
  if (job.state === 'done' || job.state === 'error' || job.id === 'current') {
    if (job.state === 'error') throw new Error(job.error || 'The checkpoint could not be loaded.');
    return job;
  }
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await wait(2000);
    const poll = await fetch(`${input.endpoint}/models/use/${job.id}`, { headers: authHeaders(input.apiKey) });
    const pollRaw = await poll.text();
    if (poll.status === 502 || poll.status === 504) {
      input.onProgress('Still loading, rechecking.', null);
      continue;
    }
    if (!poll.ok) throw new Error(readable(pollRaw) || `HTTP ${poll.status}.`);
    job = JSON.parse(pollRaw) as UseJob;
    input.onProgress(job.stage || 'Loading checkpoint', job.percent ?? null);
    if (job.state === 'done') return job;
    if (job.state === 'error') throw new Error(job.error || 'The checkpoint could not be loaded.');
  }
  throw new Error('The checkpoint is still loading. Open the picker again in a minute.');
}

export async function deleteCatalogCheckpoint(endpoint: string, apiKey: string, versionId: number): Promise<{ activeVersionId: number | null; job: UseJob | null }> {
  const response = await fetch(`${endpoint}/models/${versionId}`, { method: 'DELETE', headers: authHeaders(apiKey) });
  const raw = await response.text();
  if (!response.ok) throw new Error(readable(raw) || `HTTP ${response.status}.`);
  const body = JSON.parse(raw) as { activeVersionId?: number | null; job?: UseJob | null };
  return { activeVersionId: typeof body.activeVersionId === 'number' ? body.activeVersionId : null, job: body.job ?? null };
}

export async function pollUseJob(endpoint: string, apiKey: string, job: UseJob, onProgress: (stage: string, percent: number | null) => void): Promise<UseJob> {
  if (job.state === 'done' || job.id === 'current') return job;
  let current = job;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await wait(2000);
    const poll = await fetch(`${endpoint}/models/use/${current.id}`, { headers: authHeaders(apiKey) });
    const raw = await poll.text();
    if (poll.status === 502 || poll.status === 504) {
      onProgress('Still loading, rechecking.', null);
      continue;
    }
    if (!poll.ok) throw new Error(readable(raw) || `HTTP ${poll.status}.`);
    current = JSON.parse(raw) as UseJob;
    onProgress(current.stage || 'Loading checkpoint', current.percent ?? null);
    if (current.state === 'done') return current;
    if (current.state === 'error') throw new Error(current.error || 'The checkpoint could not be loaded.');
  }
  throw new Error('The checkpoint is still loading.');
}

function authHeaders(apiKey: string): Record<string, string> {
  const key = normalizeSaladKey(apiKey);
  return {
    Authorization: `Bearer ${key}`,
    'Salad-Api-Key': key,
    'X-Api-Key': key,
  };
}

function readable(body: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
    const detail = parsed.detail ?? parsed.error;
    if (typeof detail === 'string') return detail;
  } catch {
    return body.replace(/\s+/g, ' ').trim().slice(0, 180);
  }
  return body.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
