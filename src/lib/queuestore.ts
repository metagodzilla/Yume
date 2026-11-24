import { useSyncExternalStore } from 'react';

import { publishQueue } from 'yume-queue';

import { counts, emptyQueue, enqueue, moveToTop, pauseAll, pauseJob, recover, resumeAll, resumeJob, cancelAll, cancelJob, markDone, noteJob, thermalPause, thermalResume, type JobKind, type JobStatus, type QueueState } from '@/src/lib/queue';

let state: QueueState = emptyQueue(true);
const listeners = new Set<() => void>();
let hydrated = false;

function emit() {
  listeners.forEach((listener) => listener());
  const tally = counts(state);
  const running = state.jobs.find((job) => job.status === 'running');
  publishQueue(running?.title ?? 'Yume', running?.reason ?? 'In the queue', Math.round((running?.progress ?? 0) * 100), tally.running + tally.waiting + tally.paused);
  void import('@/src/lib/storage').then(({ saveQueueBlob }) => saveQueueBlob(JSON.stringify(state))).catch(() => undefined);
}

export function getQueue(): QueueState {
  return state;
}

export function useQueue(): QueueState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getQueue,
    getQueue,
  );
}

export async function hydrateQueue() {
  if (hydrated) return;
  hydrated = true;
  try {
    const { loadQueueBlob } = await import('@/src/lib/storage');
    const raw = await loadQueueBlob();
    if (!raw) return;
    const parsed = JSON.parse(raw) as QueueState;
    if (!parsed.jobs) return;
    state = recover({ ...emptyQueue(parsed.autoResume !== false), ...parsed }, true).state;
    emit();
  } catch {
    state = emptyQueue(true);
  }
}

export function addJob(kind: JobKind, title: string) {
  state = enqueue(state, { id: `job_${Date.now().toString(36)}`, kind, title, createdAt: Date.now() });
  emit();
  return state.jobs[state.jobs.length - 1];
}

export function queueInstall(versionId: number, title: string) {
  const existing = state.jobs.find((job) => job.kind === 'install' && job.versionId === versionId && (job.status === 'waiting' || job.status === 'running'));
  if (existing) return existing;
  state = enqueue(state, { id: `install_${versionId}`, kind: 'install', title, createdAt: Date.now(), versionId });
  emit();
  return state.jobs.find((job) => job.id === `install_${versionId}`);
}

export function queueAction(action: 'pause' | 'resume' | 'cancel' | 'top', id: string) {
  if (action === 'pause') state = pauseJob(state, id);
  if (action === 'resume') state = resumeJob(state, id);
  if (action === 'cancel') state = cancelJob(state, id);
  if (action === 'top') state = moveToTop(state, id);
  emit();
}

export function queueAll(action: 'pause' | 'resume' | 'cancel') {
  if (action === 'pause') state = pauseAll(state);
  if (action === 'resume') state = resumeAll(state);
  if (action === 'cancel') state = cancelAll(state);
  emit();
}

export function setAutoResume(autoResume: boolean) {
  state = { ...state, autoResume };
  emit();
}

export function setQueueOnline(online: boolean) {
  const next = recover(state, online);
  state = next.state;
  emit();
}

export function queueCounts() {
  return counts(state);
}

export function reportJob(id: string, progress: number, reason: string, status: JobStatus = 'running') {
  state = noteJob(state, id, progress, reason, status);
  emit();
}

export function finishJob(id: string) {
  state = markDone(state, id);
  emit();
}

export function applyThermal(action: 'pause' | 'resume') {
  state = action === 'pause' ? thermalPause(state) : thermalResume(state);
  emit();
}
