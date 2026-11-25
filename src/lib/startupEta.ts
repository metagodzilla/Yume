import { formatBytes, formatEta, formatSpeed } from '@/src/lib/downloads';
import { formatPullEta, pullRate } from '@/src/lib/stuckCloud';

export const SERVER_IMAGE_BYTES = 3.39 * 1024 * 1024 * 1024;
const TYPICAL_SECONDS = [60, 5 * 60, 8 * 60, 2 * 60, 12 * 60, 0];

export type WeightFile = {
  name: string;
  type: string;
  versionId: number | null;
  bytesDone: number;
  bytesTotal: number;
  speed: number;
  state: string;
  etaSeconds: number | null;
};

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatReadyIn(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `Ready in ~${minutes} min`;
  return `Ready in ~${Math.max(1, Math.round(minutes / 60))} hr`;
}

export function softwareDetail(samples: { at: number; percent: number }[], percent: number | null): { line: string; etaSeconds: number | null } {
  const rate = pullRate(samples);
  const etaSeconds = rate && Number.isFinite(rate.etaMs) ? rate.etaMs / 1000 : null;
  const bytesPerSecond = rate && rate.perMinute > 0 ? (rate.perMinute / 100) * SERVER_IMAGE_BYTES / 60 : 0;
  const bits = [
    percent == null ? '' : `${Math.round(percent)}%`,
    rate && rate.perMinute > 0 ? `${rate.perMinute.toFixed(1)}%/min` : '',
    formatSpeed(bytesPerSecond),
    etaSeconds != null ? formatPullEta(etaSeconds * 1000) : '',
  ].filter(Boolean);
  return { line: bits.join(' · '), etaSeconds };
}

export function fileLine(file: WeightFile): string {
  if (file.state === 'waiting' || file.state === 'queued' || file.state === 'paused') return 'waiting';
  if (file.state === 'done') return '';
  const done = formatBytes(file.bytesDone);
  const total = file.bytesTotal > 0 ? formatBytes(file.bytesTotal) : '';
  return [total ? `${done} / ${total}` : done, formatSpeed(file.speed), formatEta(file.etaSeconds)].filter(Boolean).join(' · ');
}

export function filesForPhase(index: number, files: WeightFile[]): WeightFile[] {
  if (index === 4) return files.filter((file) => /checkpoint/i.test(file.type));
  if (index === 5) return files.filter((file) => !/checkpoint/i.test(file.type));
  return [];
}

export function parseProgressFiles(payload: unknown): WeightFile[] {
  const list = payload && typeof payload === 'object' && Array.isArray((payload as { files?: unknown }).files) ? (payload as { files: unknown[] }).files : [];
  return list.filter((item) => item && typeof item === 'object').map((item) => {
    const row = item as Record<string, unknown>;
    return {
      name: String(row.name || 'File'),
      type: String(row.type || 'Model'),
      versionId: typeof row.versionId === 'number' ? row.versionId : null,
      bytesDone: Number(row.bytes_done ?? row.bytesDone ?? 0) || 0,
      bytesTotal: Number(row.bytes_total ?? row.bytesTotal ?? 0) || 0,
      speed: Number(row.speed ?? row.bytesPerSecond ?? 0) || 0,
      state: String(row.state || 'waiting'),
      etaSeconds: typeof row.eta_seconds === 'number' ? row.eta_seconds : typeof row.etaSeconds === 'number' ? row.etaSeconds : null,
    };
  });
}

export function phaseDetail(index: number, input: { elapsedMs: number; pullLine: string; modelLine: string; note: string }): string {
  if (index === 1) return `${formatElapsed(input.elapsedMs)} elapsed · usually 2–8 min`;
  if (index === 2) return [input.pullLine, input.note].filter(Boolean).join(' · ');
  if (index === 3) return `${formatElapsed(input.elapsedMs)} elapsed`;
  if (index === 4) return [input.modelLine, input.note].filter(Boolean).join(' · ');
  if (index === 0 || index === 5) return input.note;
  return '';
}

export function overallEtaSeconds(currentIndex: number, currentEta: number | null, restoreEta = 0): number | null {
  if (currentIndex < 0 || currentIndex >= 6) return null;
  const current = currentEta != null && currentEta > 0 ? currentEta : TYPICAL_SECONDS[currentIndex] ?? 0;
  let later = 0;
  for (let index = currentIndex + 1; index < TYPICAL_SECONDS.length; index += 1) later += TYPICAL_SECONDS[index] ?? 0;
  return current + later + Math.max(0, restoreEta);
}
