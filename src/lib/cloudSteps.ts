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

export type CloudPhase = 'starting' | 'running' | 'stopping' | 'stopped';

export type ChecklistStep = {
  label: string;
  state: 'done' | 'current' | 'todo';
  percent: number | null;
};

export const RTX_4090_LOW_HOURLY = 0.253;

export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  }
}

export function deploymentForEndpoint(endpoint: string, saved: CloudDeployment | null): CloudDeployment | null {
  if (hostOf(endpoint) === LIVE_GATEWAY.host) {
    return {
      organization: LIVE_GATEWAY.organization,
      project: LIVE_GATEWAY.project,
      group: LIVE_GATEWAY.group,
      gpuName: saved?.gpuName || 'RTX 4090',
      gpuClassId: saved?.gpuClassId || '',
      hourlyUsd: saved?.hourlyUsd || RTX_4090_LOW_HOURLY,
      image: saved?.image || 'ghcr.io/metagodzilla/yume-server:latest',
    };
  }
  if (saved?.organization && saved.project && saved.group) return saved;
  return null;
}

export function resolveHourly(input: { userRate: number; touched: boolean; gpuName?: string; priority?: string; liveGateway?: boolean }): number {
  if (input.touched) return input.userRate;
  const gpu = input.gpuName || '';
  const low4090 = /4090/i.test(gpu) && (input.priority || 'low').toLowerCase() === 'low';
  if (low4090 || (input.liveGateway && (input.priority || 'low').toLowerCase() === 'low')) return RTX_4090_LOW_HOURLY;
  return input.userRate;
}

export function uptimeSeconds(startTime: string | null, now = Date.now()): number {
  if (!startTime) return 0;
  const parsed = Date.parse(startTime);
  if (!Number.isFinite(parsed) || parsed < Date.parse('2020-01-01')) return 0;
  return Math.max(0, Math.floor((now - parsed) / 1000));
}

export type CheckLine = { name: string; url: string; pass: boolean; status?: number; message: string };

export function checkLine(name: string, url: string, probe?: { ok?: boolean; status?: number; error?: string; detail?: string }): CheckLine {
  if (!url) return { name, url, pass: false, message: 'No URL.' };
  if (probe?.error) return { name, url, pass: false, status: probe.status, message: probe.error };
  if (!probe || probe.status == null) return { name, url, pass: false, message: 'No response.' };
  const pass = Boolean(probe.ok);
  return { name, url, pass, status: probe.status, message: probe.detail || (pass ? 'OK' : `HTTP ${probe.status}`) };
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
  probeError?: string;
  pullPercent?: number | null;
  modelDone?: number | null;
  modelTotal?: number | null;
}): { phase: CloudPhase; pill: string; liveTitle: string; steps: ChecklistStep[]; authBlocked: boolean; overall: number | null } {
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

  if (ready) {
    const steps = paint(5, input);
    return { phase: 'running', pill: 'Running', liveTitle: 'Ready', steps, authBlocked: false, overall: 100 };
  }
  if (!input.hasEndpoint && !input.groupStatus) {
    const steps = paint(-1, input);
    return { phase: 'stopped', pill: 'Stopped', liveTitle: 'Cloud is stopped', steps, authBlocked: false, overall: null };
  }
  if (input.groupStatus === 'stopping') {
    const steps = paint(-1, input);
    return { phase: 'stopping', pill: 'Stopping', liveTitle: 'Stopping', steps, authBlocked, overall: null };
  }
  if (input.groupStatus === 'stopped' || input.groupStatus === 'succeeded') {
    const steps = paint(-1, input);
    return { phase: 'stopped', pill: 'Stopped', liveTitle: 'Cloud is stopped', steps, authBlocked, overall: null };
  }
  if (modelWait && (healthUp || input.readyStatus === 503)) {
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
  } else if (input.probeError) {
    index = 0;
    liveTitle = input.probeError;
  } else if (input.groupStatus === 'pending') {
    index = 0;
    liveTitle = 'Creating the container group';
  } else if (input.hasEndpoint) {
    index = 0;
    liveTitle = 'Waiting for the gateway';
  }
  if (input.groupStatus === 'failed') {
    pill = 'Failed';
    liveTitle = 'The container group failed';
  }
  const steps = paint(index, input);
  return { phase, pill, liveTitle, steps, authBlocked, overall: overallPercent(steps) };
}

export function formatCostLine(input: { sessionUsd: number; hourly: number; upMin: number; cap: number; final?: boolean }): string {
  if (input.final) return `Final session cost ${money(input.sessionUsd)} · timer stopped`;
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

function paint(current: number, input: { pullPercent?: number | null; modelDone?: number | null; modelTotal?: number | null }): ChecklistStep[] {
  return CHECKLIST.map((label, index) => {
    const state = current < 0 ? 'todo' : index < current ? 'done' : index === current ? 'current' : 'todo';
    return { label, state, percent: stepPercent(index, state, input) };
  });
}

function stepPercent(index: number, state: ChecklistStep['state'], input: { pullPercent?: number | null; modelDone?: number | null; modelTotal?: number | null }): number | null {
  if (state === 'done') return 100;
  if (state !== 'current') return null;
  if (index === 2 && input.pullPercent != null) return clampPercent(input.pullPercent);
  if (index === 4 && input.modelTotal && input.modelTotal > 0 && input.modelDone != null) {
    return clampPercent((input.modelDone / input.modelTotal) * 100);
  }
  if (index === 5) return 100;
  return null;
}

function overallPercent(steps: ChecklistStep[]): number | null {
  if (steps.length === 0) return null;
  if (steps.every((step) => step.state === 'done')) return 100;
  const current = steps.find((step) => step.state === 'current');
  if (!current || current.percent == null) return null;
  const done = steps.filter((step) => step.state === 'done').length;
  return clampPercent(((done * 100 + current.percent) / steps.length));
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
