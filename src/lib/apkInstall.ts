export type DownloadBytes = { bytesWritten: number; totalBytes: number };

export function downloadLabel(progress: DownloadBytes): string {
  const written = Math.max(0, progress.bytesWritten);
  const total = progress.totalBytes;
  if (total > 0) {
    const percent = Math.min(100, Math.round((written / total) * 100));
    return `Downloading ${percent}% (${megabytes(written)} / ${megabytes(total)} MB)`;
  }
  return `Downloading ${megabytes(written)} MB`;
}

export function describeUpdateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const text = raw.replace(/^[\w.$]+:\s*/g, '').replace(/\s+/g, ' ').trim();
  if (/Allow from this source|install unknown apps|install-permission screen/i.test(text)) return text;
  if (/ActivityNotFound|no installer|no app that can install/i.test(text)) {
    return 'Android has no installer that can open this APK.';
  }
  if (/Permission Denial|SecurityException|FileUriExposed|blocked the installer|blocked Yume/i.test(text)) {
    return 'Android blocked Yume from handing the APK to the installer. Allow installs from Yume, then tap Update again.';
  }
  if (/content URI|file provider/i.test(text)) return 'The downloaded APK could not be shared with the Android installer.';
  const status = text.match(/\b(\d{3})\b/);
  if (/UnableToDownload|download failed|HTTP/i.test(text) && status) return `The APK download failed (HTTP ${status[1]}).`;
  if (/UnableToDownload|download failed/i.test(text)) return 'The APK download failed. Check the connection and tap Update again.';
  if (/network|failed to connect|Unable to resolve|timeout/i.test(text)) return 'The phone could not reach GitHub to download the update.';
  if (!text || text === '[object Object]') return 'The update could not be installed.';
  return text.slice(0, 180);
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
