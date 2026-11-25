/** Watch a Salad start. A pull that keeps moving is slow, not stuck. */

export const STUCK_QUIET_MS = 10 * 60 * 1000;
export const STUCK_STATE_MS = 30 * 60 * 1000;
export const SLOW_PERCENT_PER_MIN = 2;
export const MAX_AUTO_MOVES = 3;

export type CloudSample = {
  now: number;
  instanceState: string;
  pullingPercent: number | null;
  updateTime: string | null;
  readyStatus: number | null;
  healthStatus: number | null;
  modelDone: number | null;
  startupMessage: string;
  active: boolean;
  /** Newest Salad container log time. Null means this sample did not see one. */
  logAt?: number | null;
};

export type CloudWatch = {
  startedAt: number | null;
  state: string;
  stateSince: number;
  pullPercent: number | null;
  pullSince: number;
  signature: string;
  signatureSince: number;
  samples: { at: number; percent: number }[];
  autoMoves: number;
  movedFor: string;
  lastLogAt: number | null;
  modelDone: number | null;
};

export type CloudWatchView = {
  watch: CloudWatch;
  kind: 'ok' | 'slow' | 'stuck';
  autoMove: boolean;
  eta: string | null;
  banner: string;
};

export function emptyCloudWatch(): CloudWatch {
  return {
    startedAt: null,
    state: '',
    stateSince: 0,
    pullPercent: null,
    pullSince: 0,
    signature: '',
    signatureSince: 0,
    samples: [],
    autoMoves: 0,
    movedFor: '',
    lastLogAt: null,
    modelDone: null,
  };
}

export function formatPullEta(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return `about ${hours} hr left`;
}

export function pullRate(samples: { at: number; percent: number }[]): { perMinute: number; etaMs: number } | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || last.at - first.at < 30_000) return null;
  const gained = last.percent - first.percent;
  const minutes = (last.at - first.at) / 60_000;
  if (minutes <= 0) return null;
  const perMinute = gained / minutes;
  if (perMinute <= 0) return { perMinute: 0, etaMs: Number.POSITIVE_INFINITY };
  const remain = Math.max(0, 100 - last.percent);
  return { perMinute, etaMs: (remain / perMinute) * 60_000 };
}

export function observeCloud(watch: CloudWatch, sample: CloudSample, autoFix: boolean): CloudWatchView {
  if (!sample.active) {
    return {
      watch: { ...watch, startedAt: null, state: '', signature: '', samples: [], movedFor: '', lastLogAt: null, modelDone: null },
      kind: 'ok',
      autoMove: false,
      eta: null,
      banner: '',
    };
  }
  const state = sample.instanceState || 'unknown';
  const lastLogAt = sample.logAt != null ? sample.logAt : watch.lastLogAt;
  const signature = [state, sample.pullingPercent ?? '', sample.updateTime ?? '', sample.readyStatus ?? '', sample.healthStatus ?? '', sample.modelDone ?? '', lastLogAt ?? '', sample.startupMessage].join('|');
  const next: CloudWatch = {
    ...watch,
    startedAt: watch.startedAt ?? sample.now,
    state,
    stateSince: watch.state === state && watch.state !== '' ? watch.stateSince : sample.now,
    pullPercent: sample.pullingPercent,
    pullSince: sample.pullingPercent == null ? watch.pullSince : sample.pullingPercent !== watch.pullPercent ? sample.now : watch.pullSince,
    signature,
    signatureSince: signature === watch.signature && watch.signature !== '' ? watch.signatureSince : sample.now,
    samples: sample.pullingPercent == null ? watch.samples : [...watch.samples, { at: sample.now, percent: sample.pullingPercent }].slice(-8),
    lastLogAt,
    modelDone: sample.modelDone,
  };
  const rate = pullRate(next.samples);
  const eta = rate && Number.isFinite(rate.etaMs) ? formatPullEta(rate.etaMs) : null;
  const pullQuiet = sample.now - next.pullSince;
  const healthUp = sample.healthStatus === 200;
  const unreachable = sample.healthStatus == null || (sample.healthStatus !== 200 && sample.healthStatus !== 403);
  const logsQuiet = lastLogAt == null || sample.now - lastLogAt >= STUCK_QUIET_MS;
  const downloading = state.includes('download') || state.includes('pull');
  const running = state === 'running' || (state.includes('run') && !downloading);
  let kind: CloudWatchView['kind'] = 'ok';
  let reason: 'pull' | 'logs' | '' = '';
  if (downloading && sample.pullingPercent != null && pullQuiet >= STUCK_QUIET_MS) {
    kind = 'stuck';
    reason = 'pull';
  } else if (downloading && rate && rate.perMinute > 0 && rate.perMinute <= SLOW_PERCENT_PER_MIN) kind = 'slow';
  else if (running && !healthUp && unreachable && logsQuiet && sample.now - next.stateSince >= STUCK_QUIET_MS) {
    kind = 'stuck';
    reason = 'logs';
  }
  const episode = `${state}|${reason}|${next.pullSince}|${lastLogAt ?? ''}`;
  const autoMove = kind === 'stuck' && autoFix && next.autoMoves < MAX_AUTO_MOVES && next.movedFor !== episode;
  const banner =
    kind === 'stuck'
      ? next.autoMoves >= MAX_AUTO_MOVES
        ? 'Stuck on a bad Salad machine. Automatic moves are paused for this session.'
        : reason === 'logs'
          ? 'Stuck on a bad Salad machine. No server logs for 10 minutes, and the server is not answering.'
          : 'Stuck on a bad Salad machine. The image download has not moved for 10 minutes.'
      : kind === 'slow'
        ? 'Slow machine. The server software is still downloading. You can move to a new machine.'
        : '';
  return { watch: next, kind, autoMove, eta, banner };
}

export function noteCloudMove(watch: CloudWatch, now: number, auto: boolean): CloudWatch {
  const episode = `${watch.state}|${watch.pullSince}|${watch.signatureSince}`;
  return {
    ...watch,
    autoMoves: auto ? watch.autoMoves + 1 : watch.autoMoves,
    movedFor: episode,
    pullSince: now,
    signatureSince: now,
    stateSince: now,
    samples: [],
  };
}
