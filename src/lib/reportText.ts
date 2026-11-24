export type AppFault = {
  time: number;
  source: 'generate' | 'install' | 'search' | 'check';
  message: string;
  endpoint?: string;
  status?: number;
  payload?: unknown;
  response?: string;
};

export type ServerFault = {
  time?: number;
  source?: string;
  endpoint?: string;
  status?: number;
  message?: string;
  payload?: unknown;
  traceback?: string;
};

const recent: AppFault[] = [];
const SECRET = /salad_cloud_user_\S+|sk-[A-Za-z0-9_-]{6,}|(token=)[^&\s]+|(bearer\s+)\S+/gi;

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /token|authorization|api[-_]?key|password|secret/i.test(key) ? '[redacted]' : redactValue(item);
    }
    return out;
  }
  if (typeof value === 'string') {
    return value.replace(SECRET, (match, tokenEq, bearer) => (tokenEq ? 'token=…' : bearer ? 'bearer …' : match.startsWith('sk-') ? 'sk-…' : 'salad_cloud_user_…'));
  }
  return value;
}

export function rememberFault(fault: AppFault): void {
  recent.push({
    ...fault,
    payload: redactValue(fault.payload),
    response: typeof fault.response === 'string' ? String(redactValue(fault.response)) : fault.response,
  });
  if (recent.length > 20) recent.shift();
}

export function recentFaults(): AppFault[] {
  return recent.slice();
}

export function reportDocument(server: ServerFault[], client: Record<string, unknown>): string {
  return JSON.stringify({ client, server }, null, 2);
}
