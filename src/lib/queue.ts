export type JobKind = 'generate' | 'mesh' | 'install' | 'update' | 'offline-download' | 'offline-generate' | 'deploy';

export type JobStatus = 'waiting' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export type Job = {
  id: string;
  kind: JobKind;
  title: string;
  status: JobStatus;
  progress: number;
  order: number;
  createdAt: number;
  pausedByUser: boolean;
  reason?: string;
  serverJobId?: string;
  retries: number;
  error?: string;
};

export type QueueState = {
  jobs: Job[];
  autoResume: boolean;
  online: boolean;
};

export type QueueEffect =
  | { type: 'start'; id: string }
  | { type: 'poll'; id: string }
  | { type: 'cancel-server'; id: string; serverJobId?: string }
  | { type: 'retry'; id: string; delayMs: number };

export function emptyQueue(autoResume = true): QueueState {
  return { jobs: [], autoResume, online: true };
}

export function enqueue(state: QueueState, job: Omit<Job, 'status' | 'progress' | 'pausedByUser' | 'retries' | 'order'> & { order?: number }): QueueState {
  const order = job.order ?? nextOrder(state);
  const next: Job = { ...job, status: 'waiting', progress: 0, pausedByUser: false, retries: 0, order };
  return { ...state, jobs: [...state.jobs, next].sort(byOrder) };
}

export function pauseJob(state: QueueState, id: string): QueueState {
  return mapJob(state, id, (job) => ({
    ...job,
    status: 'paused',
    pausedByUser: true,
    reason: job.status === 'running' ? 'Will stop after this step. A GPU image cannot pause halfway through.' : 'Paused.',
  }));
}

export function resumeJob(state: QueueState, id: string): QueueState {
  return mapJob(state, id, (job) =>
    job.status === 'paused' || job.status === 'failed'
      ? { ...job, status: 'waiting', pausedByUser: false, reason: undefined, error: undefined }
      : job,
  );
}

export function cancelJob(state: QueueState, id: string): QueueState {
  return mapJob(state, id, (job) =>
    job.status === 'done' || job.status === 'cancelled' ? job : { ...job, status: 'cancelled', pausedByUser: false, reason: 'Cancelled.' },
  );
}

export function pauseAll(state: QueueState): QueueState {
  return {
    ...state,
    jobs: state.jobs.map((job) =>
      job.status === 'waiting' || job.status === 'running'
        ? {
            ...job,
            status: 'paused' as const,
            pausedByUser: true,
            reason: job.status === 'running' ? 'Will stop after this step. A GPU image cannot pause halfway through.' : 'Paused.',
          }
        : job,
    ),
  };
}

export function resumeAll(state: QueueState): QueueState {
  return { ...state, jobs: state.jobs.map((job) => (job.status === 'paused' ? { ...job, status: 'waiting', pausedByUser: false, reason: undefined } : job)) };
}

export function cancelAll(state: QueueState): QueueState {
  return { ...state, jobs: state.jobs.map((job) => (active(job) || job.status === 'paused' ? { ...job, status: 'cancelled' as const, reason: 'Cancelled.' } : job)) };
}

export function moveToTop(state: QueueState, id: string): QueueState {
  const min = Math.min(...state.jobs.filter((job) => job.status === 'waiting').map((job) => job.order), 0);
  return mapJob(state, id, (job) => (job.status === 'waiting' ? { ...job, order: min - 1 } : job));
}

/** Recover after process death, reboot, or a dropped network. User pauses stay paused. */
export function recover(state: QueueState, online: boolean): { state: QueueState; effects: QueueEffect[] } {
  const effects: QueueEffect[] = [];
  const jobs = state.jobs.map((job) => {
    if (job.pausedByUser) return job;
    if (!online && (job.status === 'waiting' || job.status === 'running')) {
      return { ...job, status: 'paused' as const, pausedByUser: false, reason: 'Waiting for a connection.' };
    }
    if (job.status === 'running') {
      return { ...job, status: 'waiting' as const, reason: 'The app stopped while this was running. It will start again.' };
    }
    if (online && job.status === 'paused' && state.autoResume) {
      effects.push({ type: 'retry', id: job.id, delayMs: backoff(job.retries) });
      return { ...job, status: 'waiting' as const, reason: undefined, retries: job.retries + (job.reason?.includes('connection') ? 1 : 0) };
    }
    return job;
  });
  return { state: { ...state, online, jobs }, effects };
}

export function markRunning(state: QueueState, id: string, serverJobId?: string): QueueState {
  return mapJob(state, id, (job) => ({ ...job, status: 'running', serverJobId, progress: Math.max(job.progress, 0.05), reason: undefined }));
}

export function markProgress(state: QueueState, id: string, progress: number): QueueState {
  return mapJob(state, id, (job) => ({ ...job, progress: Math.max(0, Math.min(1, progress)) }));
}

export function markDone(state: QueueState, id: string): QueueState {
  return mapJob(state, id, (job) => ({ ...job, status: 'done', progress: 1 }));
}

export function noteJob(state: QueueState, id: string, progress: number, reason: string, status: JobStatus = 'running'): QueueState {
  return mapJob(state, id, (job) => ({
    ...job,
    status,
    progress: Math.max(0, Math.min(1, progress)),
    reason,
  }));
}

export function markFailed(state: QueueState, id: string, error: string, online: boolean): { state: QueueState; effects: QueueEffect[] } {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return { state, effects: [] };
  const network = /network|timeout|unreachable|fetch/i.test(error);
  if (network && state.autoResume && !job.pausedByUser && job.retries < 4) {
    const next = mapJob(state, id, (item) => ({
      ...item,
      status: 'paused' as const,
      pausedByUser: false,
      reason: 'Waiting for a connection.',
      error,
      retries: item.retries + 1,
    }));
    return { state: { ...next, online }, effects: online ? [{ type: 'retry', id, delayMs: backoff(job.retries + 1) }] : [] };
  }
  return { state: mapJob(state, id, (item) => ({ ...item, status: 'failed', error })), effects: [] };
}

export function counts(state: QueueState): { running: number; waiting: number; paused: number } {
  return {
    running: state.jobs.filter((job) => job.status === 'running').length,
    waiting: state.jobs.filter((job) => job.status === 'waiting').length,
    paused: state.jobs.filter((job) => job.status === 'paused').length,
  };
}

export function backoff(retries: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, retries));
}

function active(job: Job): boolean {
  return job.status === 'waiting' || job.status === 'running';
}

function nextOrder(state: QueueState): number {
  return state.jobs.reduce((max, job) => Math.max(max, job.order), 0) + 1;
}

function byOrder(a: Job, b: Job): number {
  return a.order - b.order;
}

function mapJob(state: QueueState, id: string, update: (job: Job) => Job): QueueState {
  return { ...state, jobs: state.jobs.map((job) => (job.id === id ? update(job) : job)).sort(byOrder) };
}
