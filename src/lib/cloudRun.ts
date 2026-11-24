export type CloudRunMode = 'live' | 'stopping' | 'stopped';

export type CloudRunState = {
  mode: CloudRunMode;
  frozenUsd: number | null;
  frozenUpSec: number | null;
};

let state: CloudRunState = { mode: 'live', frozenUsd: null, frozenUpSec: null };
let quote = { usd: 0, upSec: 0 };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function cloudRunState(): CloudRunState {
  return state;
}

export function subscribeCloudRun(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function noteLiveSession(usd: number, upSec: number) {
  quote = { usd, upSec };
}

export function liveSessionQuote() {
  return quote;
}

export function beginCloudStop(usd: number, upSec: number) {
  state = { mode: 'stopping', frozenUsd: usd, frozenUpSec: upSec };
  emit();
}

export function finishCloudStop() {
  if (state.mode !== 'stopping') return;
  state = { ...state, mode: 'stopped' };
  emit();
}

export function beginCloudStart() {
  state = { mode: 'live', frozenUsd: null, frozenUpSec: null };
  emit();
}

export const CLOUD_STOP_CHECK = {
  status: 'skip' as const,
  runs: false,
  message: 'CHECK does not stop the cloud. Stop cloud on Home sends POST /organizations/seeyeevang707/projects/default/containers/yume-server/stop.',
};
