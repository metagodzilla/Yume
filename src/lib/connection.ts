export type HealthInfo = {
  gpu?: string;
  vramUsedMb?: number | null;
  vramTotalMb?: number | null;
  model?: string;
  ready?: boolean;
};

export type Probe = {
  ok: boolean;
  status?: number;
  ms: number;
  body?: HealthInfo & { detail?: string; status?: string };
  error?: string;
};

export type ConnectionKind = 'demo' | 'connected' | 'starting' | 'offline' | 'auth';

export type ConnectionState = {
  kind: ConnectionKind;
  title: string;
  detail: string;
  latencyMs?: number;
  gpu?: string;
  model?: string;
};

export function interpretConnection(input: {
  provider: string;
  endpoint: string;
  hasKey: boolean;
  health?: Probe;
  ready?: Probe;
  auth?: Probe;
}): ConnectionState {
  const endpoint = input.endpoint.trim();
  if (input.provider === 'demo' || !endpoint) {
    return {
      kind: 'demo',
      title: 'Demo mode',
      detail: 'No Salad server is configured. Drawing stays on this phone.',
    };
  }
  const health = input.health;
  if (!health || health.error || !health.ok) {
    const reason = explainFailure(health);
    return { kind: 'offline', title: 'Offline', detail: reason };
  }
  const ready = input.ready;
  if (!ready || !ready.ok) {
    const detail =
      ready?.status === 503
        ? ready.body?.detail || 'The server answered, but the model is not ready yet.'
        : explainFailure(ready);
    return {
      kind: 'starting',
      title: 'Starting up',
      detail,
      latencyMs: health.ms,
      gpu: health.body?.gpu,
      model: health.body?.model,
    };
  }
  if (!input.hasKey) {
    return { kind: 'auth', title: 'Auth failed', detail: 'No API key is saved for this server.' };
  }
  if (input.auth && !input.auth.ok && (input.auth.status === 401 || input.auth.status === 403)) {
    return { kind: 'auth', title: 'Auth failed', detail: 'The server rejected the API key.' };
  }
  if (input.auth && !input.auth.ok) {
    return { kind: 'offline', title: 'Offline', detail: explainFailure(input.auth) };
  }
  return {
    kind: 'connected',
    title: 'Connected',
    detail: [health.body?.gpu, health.body?.model || 'Animagine XL 4.0'].filter(Boolean).join(' · '),
    latencyMs: health.ms,
    gpu: health.body?.gpu,
    model: health.body?.model || 'Animagine XL 4.0',
  };
}

function explainFailure(probe?: Probe): string {
  if (!probe) return 'No response from the server.';
  if (probe.error?.toLowerCase().includes('abort') || probe.error?.toLowerCase().includes('timeout')) {
    return 'The server did not answer in time.';
  }
  if (probe.status === 401 || probe.status === 403) return 'The server rejected the API key.';
  if (!probe.status) return probe.error || 'The server could not be reached. Check the URL.';
  if (probe.body?.detail) return String(probe.body.detail);
  return `The server returned ${probe.status}.`;
}

export async function probe(url: string, init: RequestInit, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<Probe> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const ms = Date.now() - started;
    let body: Probe['body'];
    try {
      body = (await response.json()) as Probe['body'];
    } catch {
      body = undefined;
    }
    return { ok: response.ok, status: response.status, ms, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { ok: false, ms: Date.now() - started, error: aborted ? 'timeout' : message };
  } finally {
    clearTimeout(timer);
  }
}
