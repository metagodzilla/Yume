import { useSyncExternalStore } from 'react';

export type CloudGate = 'unknown' | 'ready' | 'starting' | 'stuck' | 'slow' | 'stopped';

export type CloudSnapshot = { gate: CloudGate; toast: string | null };

let gate: CloudGate = 'unknown';
let toast: string | null = null;
let snapshot: CloudSnapshot = { gate, toast };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function commit() {
  if (snapshot.gate === gate && snapshot.toast === toast) return;
  snapshot = { gate, toast };
  emit();
}

export function getCloudGate(): CloudGate {
  return gate;
}

export function getCloudToast(): string | null {
  return toast;
}

/** Stable object. useSyncExternalStore loops if this returns a new object every call. */
export function getCloudSnapshot(): CloudSnapshot {
  return snapshot;
}

export function setCloudGate(next: CloudGate) {
  if (next === gate) return;
  const becameReady = next === 'ready' && gate !== 'unknown';
  gate = next;
  if (becameReady) toast = 'Cloud is ready. New pictures use the cloud.';
  commit();
}

export function dismissCloudToast() {
  if (!toast) return;
  toast = null;
  commit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCloudGate(): CloudSnapshot {
  return useSyncExternalStore(subscribe, getCloudSnapshot, getCloudSnapshot);
}
