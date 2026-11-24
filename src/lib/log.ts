export type LogEntry = { at: number; level: 'error' | 'warn' | 'info'; message: string };

const entries: LogEntry[] = [];
let installed = false;

export function pushLog(level: LogEntry['level'], message: string) {
  entries.push({ at: Date.now(), level, message: message.slice(0, 500) });
  if (entries.length > 80) entries.shift();
}

export function getLog(): LogEntry[] {
  return entries.slice();
}

export function installErrorHooks() {
  if (installed || typeof globalThis === 'undefined') return;
  installed = true;
  const target = globalThis as { onunhandledrejection?: ((event: PromiseRejectionEvent) => void) | null };
  const previous = target.onunhandledrejection;
  target.onunhandledrejection = (event) => {
    const reason = (event as { reason?: unknown }).reason;
    pushLog('error', reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection'));
    previous?.(event);
  };
}
