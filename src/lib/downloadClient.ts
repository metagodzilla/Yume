import type { DownloadJob } from '@/src/lib/downloads';
import { installRequest } from '@/src/lib/installGate';
import { normalizeSaladKey } from '@/src/lib/saladCloud';

export async function fetchInstalls(endpoint: string, apiKey: string): Promise<DownloadJob[]> {
  const response = await fetch(`${endpoint}/models/installs`, { headers: authHeaders(apiKey) });
  const raw = await response.text();
  if (!response.ok) throw new Error(readable(raw) || `HTTP ${response.status}.`);
  const body = JSON.parse(raw) as { jobs?: DownloadJob[] };
  return body.jobs ?? [];
}

export async function controlDownload(endpoint: string, apiKey: string, id: string, action: 'pause' | 'resume' | 'cancel'): Promise<DownloadJob> {
  const response = await fetch(`${endpoint}/models/install/${id}/${action}`, { method: 'POST', headers: authHeaders(apiKey) });
  const raw = await response.text();
  if (!response.ok) throw new Error(readable(raw) || `HTTP ${response.status}.`);
  return JSON.parse(raw) as DownloadJob;
}

export async function startDownload(
  endpoint: string,
  apiKey: string,
  versionId: number,
  hint?: { type?: string; name?: string; filename?: string; baseModel?: string; triggers?: string[] },
  civitaiToken?: string | null,
): Promise<DownloadJob> {
  const request = installRequest(versionId, civitaiToken);
  const response = await fetch(`${endpoint}/models/install`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), ...request.headers },
    body: JSON.stringify({ ...request.body, ...hint }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(readable(raw) || `HTTP ${response.status}.`);
  return JSON.parse(raw) as DownloadJob;
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
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
  } catch {
    return body.replace(/\s+/g, ' ').trim().slice(0, 180);
  }
  return body.replace(/\s+/g, ' ').trim().slice(0, 180);
}
