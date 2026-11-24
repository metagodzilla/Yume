import type { CloudDeployment } from '@/src/lib/storage';
import { money } from '@/src/lib/usage';

export const LIVE_GATEWAY = {
  host: 'persimmon-potato-w36vqxy5bseqmtk4.salad.cloud',
  organization: 'seeyeevang707',
  project: 'default',
  group: 'yume-server',
};

export const CHECKLIST = [
  'Creating container group',
  'Finding an RTX 4090',
  'Downloading software',
  'Starting up',
  'Downloading model',
  'Ready',
] as const;

export type CloudPhase = 'starting' | 'running' | 'stopped';

export type ChecklistStep = {
  label: string;
  state: 'done' | 'current' | 'todo';
};

export function deploymentForEndpoint(endpoint: string, saved: CloudDeployment | null): CloudDeployment | null {
  if (saved?.organization && saved.project && saved.group) return saved;
  let host = '';
  try {
    host = new URL(endpoint).host;
  } catch {
    host = endpoint.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  }
  if (host !== LIVE_GATEWAY.host) return saved;
  return {
    organization: LIVE_GATEWAY.organization,
    project: LIVE_GATEWAY.project,
    group: LIVE_GATEWAY.group,
    gpuName: saved?.gpuName || 'RTX 4090',
    gpuClassId: saved?.gpuClassId || '',
    hourlyUsd: saved?.hourlyUsd || 0,
    image: saved?.image || 'ghcr.io/metagodzilla/yume-server:latest',
  };
}

export function cloudChecklist(input: {
  hasEndpoint: boolean;
  groupStatus?: string;
  allocating?: number;
  creating?: number;
  running?: number;
  healthStatus?: number;
  readyStatus?: number;
  healthReady?: boolean;
  readyDetail?: string;
}): { phase: CloudPhase; pill: string; liveTitle: string; steps: ChecklistStep[]; authBlocked: boolean } {
  const authBlocked = input.healthStatus === 403 || input.readyStatus === 403;
  const ready = input.readyStatus === 200;
  const healthUp = input.healthStatus === 200;
  const modelWait =
    input.readyStatus === 503 ||
    input.healthReady === false ||
    /download|loading|not ready/i.test(input.readyDetail || '');
  let index = 0;
  let phase: CloudPhase = 'starting';
  let pill = 'Starting...';
  let liveTitle = 'Creating the container group';

  if (!input.hasEndpoint && !input.groupStatus) {
    return { phase: 'stopped', pill: 'Stopped', liveTitle: 'Cloud is stopped', steps: paint(-1), authBlocked: false };
  }
  if (input.groupStatus === 'stopped' || input.groupStatus === 'succeeded') {
    return { phase: 'stopped', pill: 'Stopped', liveTitle: 'Cloud is stopped', steps: paint(-1), authBlocked };
  }
  if (ready) {
    phase = 'running';
    pill = 'Running';
    index = 5;
    liveTitle = 'Ready';
  } else if (modelWait && (healthUp || input.readyStatus === 503)) {
    index = 4;
    liveTitle = 'Downloading model on cloud (first start can take ~15-25 min)';
  } else if (healthUp || (input.running ?? 0) > 0 || input.groupStatus === 'running') {
    index = 3;
    liveTitle = 'Starting up';
  } else if ((input.creating ?? 0) > 0) {
    index = 2;
    liveTitle = 'Downloading software';
  } else if ((input.allocating ?? 0) > 0 || input.groupStatus === 'deploying') {
    index = 1;
    liveTitle = 'Finding an RTX 4090';
  } else if (authBlocked) {
    index = 1;
    liveTitle = 'Gateway is up. The Salad API key is required to read /health and /ready while the model downloads.';
  } else if (input.groupStatus === 'pending' || input.hasEndpoint) {
    index = input.hasEndpoint ? 1 : 0;
    liveTitle = input.hasEndpoint ? 'Finding an RTX 4090' : 'Creating the container group';
  }
  if (input.groupStatus === 'failed') {
    pill = 'Failed';
    liveTitle = 'The container group failed';
  }
  return { phase, pill, liveTitle, steps: paint(index), authBlocked };
}

export function formatCostLine(input: { sessionUsd: number; hourly: number; upMin: number; cap: number }): string {
  const base = `${money(input.sessionUsd)} this session · ${money(input.hourly)}/h · Up ${Math.max(0, Math.round(input.upMin))} min`;
  if (input.cap <= 0) return `${base} · session cap off`;
  const left = Math.max(0, input.cap - input.sessionUsd);
  return `${base} · ${money(left)} left of your ${money(input.cap)} session cap`;
}

export function sessionUsd(upSec: number, hourly: number): number {
  if (upSec <= 0 || hourly <= 0) return 0;
  return (upSec / 3600) * hourly;
}

export function capReached(spent: number, cap: number): boolean {
  return cap > 0 && spent >= cap - 0.0001;
}

function paint(current: number): ChecklistStep[] {
  return CHECKLIST.map((label, index) => ({
    label,
    state: current < 0 ? 'todo' : index < current ? 'done' : index === current ? 'current' : 'todo',
  }));
}
