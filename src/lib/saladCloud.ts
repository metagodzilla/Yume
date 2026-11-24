export const SALAD_API = 'https://api.salad.com/api/public';
export const SALAD_PORTAL_API_KEYS = 'https://portal.salad.com';
export const YUME_IMAGE = 'ghcr.io/metagodzilla/yume-server:latest';
export const YUME_PROJECT = 'yume';
export const YUME_GROUP = 'yume';

export type NamedResource = { name: string; displayName: string };

export type GpuChoice = {
  id: string;
  name: string;
  priority: 'low' | 'medium' | 'high' | 'batch';
  hourly: number;
};

export type DeployPhase = 'pending' | 'allocating' | 'pulling' | 'downloading' | 'ready' | 'stopped' | 'failed';

const PRIORITIES = ['low', 'medium', 'high', 'batch'] as const;

export function maskKey(key: string | null | undefined): string {
  const trimmed = key?.trim() ?? '';
  if (!trimmed) return 'No key saved';
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

export function serverUrlFromLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = trimmed.includes('://') ? new URL(trimmed) : new URL(`https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol === 'yume:') {
    const nested = url.searchParams.get('url');
    if (!nested) return null;
    return serverUrlFromLink(nested);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  for (const name of ['key', 'apiKey', 'api_key', 'token', 'apikey']) url.searchParams.delete(name);
  url.hash = '';
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  const query = url.searchParams.toString();
  return `${url.origin}${path}${query ? `?${query}` : ''}`;
}

export function costLine(hourly: number, name: string): string {
  const rate = Number.isFinite(hourly) ? hourly : 0;
  const day = rate * 24;
  return `${name} is $${rate.toFixed(3)} per hour while it is running, about $${day.toFixed(2)} per day if you leave it on. Stopped time is not billed.`;
}

export function readNamedItems(payload: unknown): NamedResource[] {
  const source = Array.isArray(payload) ? payload : isRecord(payload) ? payload.items : undefined;
  if (!Array.isArray(source)) return [];
  const items: NamedResource[] = [];
  for (const item of source) {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim()) continue;
    const displayName = typeof item.display_name === 'string' && item.display_name.trim() ? item.display_name : item.name;
    items.push({ name: item.name, displayName });
  }
  return items;
}

export function choicesFromGpuClasses(payload: unknown): GpuChoice[] {
  const source = Array.isArray(payload) ? payload : isRecord(payload) ? payload.items : undefined;
  if (!Array.isArray(source)) return [];
  const choices: GpuChoice[] = [];
  for (const item of source) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    const prices = Array.isArray(item.prices) ? item.prices : [];
    const parsed = prices.flatMap((price) => {
      if (!isRecord(price) || typeof price.priority !== 'string') return [];
      const priority = PRIORITIES.find((entry) => entry === price.priority);
      const hourly = typeof price.price === 'string' || typeof price.price === 'number' ? Number(String(price.price).replace(/[^0-9.]/g, '')) : NaN;
      if (!priority || !Number.isFinite(hourly)) return [];
      return [{ priority, hourly }];
    });
    const low = parsed.find((price) => price.priority === 'low') ?? parsed.slice().sort((a, b) => a.hourly - b.hourly)[0];
    if (!low) continue;
    choices.push({ id: item.id, name: item.name, priority: low.priority, hourly: low.hourly });
  }
  return choices;
}

export function pickDefaultGpu(choices: GpuChoice[]): GpuChoice | null {
  return choices.find((choice) => /4090/i.test(choice.name) && choice.priority === 'low') ?? choices.find((choice) => /4090/i.test(choice.name)) ?? choices[0] ?? null;
}

export function describeDeploy(input: {
  groupStatus?: string;
  allocating?: number;
  creating?: number;
  running?: number;
  ready?: boolean;
}): { phase: DeployPhase; title: string; progress: number } {
  if (input.groupStatus === 'failed') return { phase: 'failed', title: 'The server failed', progress: 0 };
  if (input.ready) return { phase: 'ready', title: 'Ready', progress: 1 };
  if ((input.running ?? 0) > 0 || input.groupStatus === 'running') {
    return { phase: 'downloading', title: 'Downloading the model', progress: 0.72 };
  }
  if ((input.creating ?? 0) > 0) return { phase: 'pulling', title: 'Pulling the image', progress: 0.45 };
  if ((input.allocating ?? 0) > 0 || input.groupStatus === 'deploying' || input.groupStatus === 'pending') {
    return { phase: 'allocating', title: 'Finding a GPU', progress: 0.2 };
  }
  if (input.groupStatus === 'stopped' || input.groupStatus === 'succeeded') return { phase: 'stopped', title: 'Stopped', progress: 0 };
  return { phase: 'pending', title: 'Starting', progress: 0.1 };
}

export function gatewayFromGroup(group: unknown): string {
  if (!isRecord(group) || !isRecord(group.networking) || typeof group.networking.dns !== 'string') return '';
  return serverUrlFromLink(group.networking.dns) ?? '';
}

export function groupStatusOf(group: unknown): { status: string; allocating: number; creating: number; running: number } {
  const current = isRecord(group) && isRecord(group.current_state) ? group.current_state : {};
  const counts = isRecord(current.instance_status_counts) ? current.instance_status_counts : {};
  return {
    status: typeof current.status === 'string' ? current.status : '',
    allocating: numberField(counts.allocating_count),
    creating: numberField(counts.creating_count),
    running: numberField(counts.running_count),
  };
}

export function buildYumeContainerGroup(input: { apiKey: string; gpuClassId: string; image?: string; name?: string }): Record<string, unknown> {
  const key = input.apiKey.trim();
  return {
    name: input.name ?? YUME_GROUP,
    display_name: 'Yume',
    autostart_policy: false,
    restart_policy: 'always',
    replicas: 1,
    container: {
      image: input.image ?? YUME_IMAGE,
      priority: 'low',
      environment_variables: {
        YUME_API_KEY: key,
        YUME_MODEL_ID: 'cagliostrolab/animagine-xl-4.0',
        YUME_MODEL_DIR: '/models',
        YUME_LORA_DIR: '/loras',
        HF_HOME: '/models',
      },
      resources: {
        cpu: 4,
        memory: 16384,
        storage_amount: 26843545600,
        gpu_classes: [input.gpuClassId],
      },
    },
    networking: {
      protocol: 'http',
      auth: true,
      port: 8080,
      load_balancer: 'least_number_of_connections',
      client_request_timeout: 100000,
      server_response_timeout: 100000,
    },
    startup_probe: httpProbe('/ready', 60, 60, 10, 20),
    readiness_probe: httpProbe('/ready', 0, 10, 5, 3),
    liveness_probe: httpProbe('/health', 30, 30, 5, 3),
  };
}

export function shouldIdleStop(input: { idleMinutes: number; lastActivityMs: number; now: number; activeJobs: number; running: boolean }): boolean {
  if (input.idleMinutes <= 0 || !input.running || input.activeJobs > 0) return false;
  if (!input.lastActivityMs) return false;
  return input.now - input.lastActivityMs >= input.idleMinutes * 60_000;
}

export class SaladApiError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

export async function saladRequest(input: {
  apiKey: string;
  path: string;
  method?: string;
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const response = await (input.fetchImpl ?? fetch)(`${SALAD_API}${input.path}`, {
    method: input.method ?? 'GET',
    headers: {
      'Salad-Api-Key': input.apiKey.trim(),
      accept: 'application/json',
      ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const detail = isRecord(payload) && typeof payload.detail === 'string' ? payload.detail : `Salad returned ${response.status}.`;
    throw new SaladApiError(response.status, detail);
  }
  return payload;
}

function httpProbe(path: string, initialDelay: number, period: number, timeout: number, failureThreshold: number) {
  return {
    http: { path, port: 8080, scheme: 'http', headers: [] },
    initial_delay_seconds: initialDelay,
    period_seconds: period,
    timeout_seconds: timeout,
    success_threshold: 1,
    failure_threshold: failureThreshold,
  };
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
