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

export function summarizeHttpBody(body: string, status?: number): string {
  if (!isHtml(body)) return body;
  if (status === 503 || /503|no instance|no healthy|not ready|unavailable/i.test(body.slice(0, 1200))) {
    return 'Salad gateway 503: no instance ready';
  }
  if (status) return `Salad gateway ${status}`;
  return 'Salad gateway returned an HTML error page';
}

function isHtml(body: string): boolean {
  const sample = body.trim().slice(0, 400).toLowerCase();
  return sample.startsWith('<!doctype') || sample.startsWith('<html') || sample.includes('<html') || sample.includes('<head') || sample.includes('<body');
}

export function scrubText(value: string, secrets: string[] = []): string {
  let next = summarizeHttpBody(value);
  if (next === value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 2) {
      try {
        return JSON.stringify(redactValue(JSON.parse(trimmed), secrets));
      } catch {
        // The text was not JSON.
      }
    }
  }
  next = next.replace(SECRET, (match, tokenEq: string | undefined, bearer: string | undefined) => (tokenEq ? 'token=…' : bearer ? 'bearer …' : match.startsWith('sk-') ? 'sk-…' : 'salad_cloud_user_…'));
  for (const secret of secrets) {
    const needle = secret.trim();
    if (needle.length < 8) continue;
    next = next.split(needle).join('***');
  }
  return next;
}

export function redactValue(value: unknown, secrets: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'environment_variables' && item && typeof item === 'object' && !Array.isArray(item)) {
        const hidden: Record<string, string> = {};
        for (const name of Object.keys(item as Record<string, unknown>)) hidden[name] = '***';
        out[key] = hidden;
        continue;
      }
      out[key] = /token|authorization|api[-_]?key|password|secret/i.test(key) ? '[redacted]' : redactValue(item, secrets);
    }
    return out;
  }
  if (typeof value === 'string') return scrubText(value, secrets);
  return value;
}

export function rememberFault(fault: AppFault, secrets: string[] = []): void {
  recent.push(redactValue(fault, secrets) as AppFault);
  if (recent.length > 20) recent.shift();
}

export function recentFaults(): AppFault[] {
  return recent.slice();
}

export function reportDocument(server: ServerFault[], client: Record<string, unknown>, secrets: string[] = []): string {
  const prepared = server.map((item) => ({
    ...item,
    endpoint: typeof item.endpoint === 'string' ? summarizeHttpBody(item.endpoint, item.status) : item.endpoint,
    message: typeof item.message === 'string' ? summarizeHttpBody(item.message, item.status) : item.message,
  }));
  return JSON.stringify(redactValue({ client, server: prepared }, secrets), null, 2);
}
