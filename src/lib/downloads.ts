export type DownloadJob = {
  id: string;
  versionId: number;
  state: string;
  bytesDone: number;
  bytesTotal: number;
  bytesPerSecond?: number;
  etaSeconds?: number | null;
  error?: string;
  name?: string;
  type?: string;
  record?: { name?: string; type?: string; filename?: string; versionId?: number } | null;
};

export const RECONNECTING = 'Reconnecting';

export function downloadPercent(job: Pick<DownloadJob, 'bytesDone' | 'bytesTotal' | 'state'>): number | null {
  if (job.state === 'done') return 100;
  if (job.bytesTotal > 0) return Math.max(0, Math.min(100, Math.round((job.bytesDone / job.bytesTotal) * 100)));
  return null;
}

export function formatBytes(bytes: number): string {
  const size = Math.max(0, bytes);
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${Math.round(size)} B`;
}

export function formatSpeed(bytesPerSecond: number | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '';
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function downloadTitle(job: DownloadJob): string {
  return job.record?.name || job.name || `Version ${job.versionId}`;
}

export function downloadKind(job: DownloadJob): string {
  const raw = (job.record?.type || job.type || 'Checkpoint').toLowerCase();
  if (raw.includes('lora') || raw.includes('locon') || raw.includes('dora')) return 'LoRA';
  if (raw.includes('textual') || raw.includes('embed')) return 'Embedding';
  return 'Checkpoint';
}

export function downloadButtons(state: string): { pause: boolean; resume: boolean; cancel: boolean; retry: boolean } {
  if (state === 'paused') return { pause: false, resume: true, cancel: true, retry: false };
  if (state === 'error') return { pause: false, resume: false, cancel: true, retry: true };
  if (state === 'cancelled') return { pause: false, resume: false, cancel: false, retry: true };
  if (state === 'done') return { pause: false, resume: false, cancel: false, retry: false };
  return { pause: true, resume: false, cancel: true, retry: false };
}

export function downloadSummary(job: DownloadJob): string {
  const percent = downloadPercent(job);
  const amount = job.bytesTotal > 0 ? `${formatBytes(job.bytesDone)} / ${formatBytes(job.bytesTotal)}` : formatBytes(job.bytesDone);
  const speed = formatSpeed(job.bytesPerSecond);
  const eta = formatEta(job.etaSeconds);
  return [job.state, percent == null ? null : `${percent}%`, amount, speed, eta ? `ETA ${eta}` : ''].filter(Boolean).join(' · ');
}
