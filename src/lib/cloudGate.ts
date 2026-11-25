import { useSyncExternalStore } from 'react';

export type CloudGate = 'unknown' | 'ready' | 'starting' | 'stuck' | 'slow' | 'stopped';

let gate: CloudGate = 'unknown';
let toast: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getCloudGate(): CloudGate {
  return gate;
}

export function getCloudToast(): string | null {
  return toast;
}

export function setCloudGate(next: CloudGate) {
  const becameReady = next === 'ready' && gate !== 'ready' && gate !== 'unknown';
  gate = next;
  if (becameReady) toast = 'Cloud is ready. New pictures use the cloud.';
  emit();
}

export function dismissCloudToast() {
  if (!toast) return;
  toast = null;
  emit();
}

export function useCloudGate(): { gate: CloudGate; toast: string | null } {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => ({ gate, toast }),
    () => ({ gate, toast }),
  );
}
