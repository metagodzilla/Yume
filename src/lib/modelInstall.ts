import { downloadSummary, RECONNECTING, type DownloadJob } from '@/src/lib/downloads';
import { installRequest } from '@/src/lib/installGate';
import { normalizeSaladKey } from '@/src/lib/saladCloud';

export type InstallJob = {
  id: string;
  versionId: number;
  state: 'queued' | 'downloading' | 'done' | 'error' | string;
  bytesDone: number;
  bytesTotal: number;
  bytesPerSecond?: number;
  etaSeconds?: number | null;
  error: string;
  name?: string;
  type?: string;
  record?: { name?: string; filename?: string; versionId?: number; type?: string } | null;
};

export function installProgressLabel(job: Pick<InstallJob, 'bytesDone' | 'bytesTotal' | 'state'>): string {
  const done = Math.max(0, job.bytesDone);
  const total = job.bytesTotal;
  if (total > 0) {
    const percent = Math.min(100, Math.round((done / total) * 100));
    return `${job.state === 'done' ? 'Installed' : 'Downloading'} ${percent}% (${gigabytes(done)} / ${gigabytes(total)} GB)`;
  }
  if (done > 0) return `Downloading ${gigabytes(done)} GB`;
  return job.state === 'queued' ? 'Download queued' : 'Downloading';
}

export function installFailureMessage(status: number, body: string): { retry: boolean; message: string } {
  const text = readable(body);
  if (status === 502 || status === 504) return { retry: true, message: 'The gateway timed out. Still working, rechecking.' };
  if ((status === 401 || status === 403) && /civitai|token|api key for this model/i.test(text)) {
    return { retry: false, message: 'Civitai needs your API key for this model' };
  }
  if (/civitai needs your api key/i.test(text)) return { retry: false, message: 'Civitai needs your API key for this model' };
  if (status === 401 || status === 403) return { retry: false, message: `HTTP ${status}. The Salad key was rejected.` };
  return { retry: false, message: text || `HTTP ${status}.` };
}

export async function runModelInstall(input: {
  endpoint: string;
  apiKey: string;
  civitaiToken?: string | null;
  versionId: number;
  type?: string;
  name?: string;
  filename?: string;
  baseModel?: string;
  triggers?: string[];
  onProgress: (label: string, fraction: number) => void;
  signal?: { cancelled?: boolean };
}): Promise<InstallJob> {
  const key = normalizeSaladKey(input.apiKey);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'Salad-Api-Key': key,
    'X-Api-Key': key,
  };
  const request = installRequest(input.versionId, input.civitaiToken);
  Object.assign(headers, request.headers);
  void import('@/src/lib/downloadTask')
    .then((task) => Promise.all([task.rememberDownloadTarget(input.endpoint), task.ensureDownloadBackground()]))
    .catch(() => undefined);
  let jobId = '';
  let lastFraction = 0;
  for (let attempt = 0; attempt < 8 && !jobId; attempt += 1) {
    if (input.signal?.cancelled) throw new Error('Install cancelled.');
    let response: Response;
    try {
      response = await fetch(`${input.endpoint}/models/install`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...request.body,
          ...(input.type ? { type: input.type } : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.filename ? { filename: input.filename } : {}),
          ...(input.baseModel ? { baseModel: input.baseModel } : {}),
          ...(input.triggers?.length ? { triggers: input.triggers } : {}),
        }),
      });
    } catch {
      input.onProgress(RECONNECTING, lastFraction);
      await wait(2000);
      continue;
    }
    const raw = await response.text();
    const failure = installFailureMessage(response.status, raw);
    if (failure.retry) {
      input.onProgress(failure.message, 0);
      await wait(3000);
      continue;
    }
    if (!response.ok) throw new Error(failure.message);
    const started = JSON.parse(raw) as InstallJob;
    jobId = started.id;
  }
  if (!jobId) throw new Error('The gateway timed out before the download could start. Still working, rechecking.');
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (input.signal?.cancelled) throw new Error('Install cancelled.');
    let response: Response;
    try {
      response = await fetch(`${input.endpoint}/models/install/${jobId}`, { headers });
    } catch {
      input.onProgress(RECONNECTING, lastFraction);
      await wait(2000);
      continue;
    }
    const raw = await response.text();
    const failure = installFailureMessage(response.status, raw);
    if (failure.retry) {
      input.onProgress(failure.message, 0);
      await wait(3000);
      continue;
    }
    if (!response.ok) throw new Error(failure.message);
    const job = JSON.parse(raw) as InstallJob;
    const fraction = job.bytesTotal > 0 ? Math.min(1, job.bytesDone / job.bytesTotal) : job.state === 'done' ? 1 : 0;
    lastFraction = fraction;
    input.onProgress(downloadSummary(job as DownloadJob), fraction);
    if (job.state === 'done') return job;
    if (job.state === 'cancelled') throw new Error('Download cancelled.');
    if (job.state === 'error') throw new Error(installFailureMessage(0, job.error).message || job.error || 'The download failed.');
    await wait(2000);
  }
  throw new Error('The download is still running. Open the model again in a minute.');
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

function gigabytes(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
