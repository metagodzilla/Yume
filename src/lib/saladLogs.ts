/** Read Salad container logs when the gateway is still closed by the startup probe. */

export type ServerLog = {
  at: number | null;
  text: string;
};

export type LogProgress = {
  logAt: number | null;
  name: string | null;
  bytesDone: number | null;
  bytesTotal: number | null;
  bytesPerSecond: number | null;
  message: string;
};

const CHECKPOINT = /checkpoint download\s+(\S+)\s+(\d+)\/(\d+)\s+bytes(?:\s+\((\d+)%\))?(?:\s+([\d.]+)\s+MB\/s)?/i;

export function logQueryBody(input: { group: string; instanceId?: string; start: string; end: string }): {
  start_time: string;
  end_time: string;
  query: string;
  page_size: number;
  sort_order: 'desc';
} {
  const group = input.group.replace(/["\\]/g, '');
  const clauses = [`resource.type = "container"`, `resource.labels.container_group_name = "${group}"`];
  const instanceId = (input.instanceId || '').replace(/["\\]/g, '');
  if (instanceId) clauses.push(`resource.labels.instance_id = "${instanceId}"`);
  return {
    start_time: input.start,
    end_time: input.end,
    query: clauses.join(' AND '),
    page_size: 50,
    sort_order: 'desc',
  };
}

export function readLogEntries(payload: unknown): ServerLog[] {
  const items = payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items) ? (payload as { items: unknown[] }).items : [];
  return items.filter((item) => item && typeof item === 'object').map((item) => {
    const row = item as Record<string, unknown>;
    const at = Date.parse(typeof row.time === 'string' ? row.time : typeof row.receive_time === 'string' ? row.receive_time : '');
    return { at: Number.isFinite(at) ? at : null, text: logText(row) };
  });
}

export function progressFromLogs(logs: ServerLog[]): LogProgress {
  let logAt: number | null = null;
  let name: string | null = null;
  let bytesDone: number | null = null;
  let bytesTotal: number | null = null;
  let bytesPerSecond: number | null = null;
  let message = '';
  for (const entry of logs) {
    if (entry.at != null && (logAt == null || entry.at > logAt)) logAt = entry.at;
    if (!message && entry.text.trim()) message = entry.text.trim().slice(0, 180);
    if (bytesTotal != null) continue;
    const match = entry.text.match(CHECKPOINT);
    if (!match) continue;
    name = match[1] || null;
    bytesDone = Number(match[2]);
    bytesTotal = Number(match[3]);
    const mega = match[5] ? Number(match[5]) : 0;
    bytesPerSecond = Number.isFinite(mega) && mega > 0 ? mega * 1024 * 1024 : null;
    message = `Downloading ${name}`;
  }
  return { logAt, name, bytesDone, bytesTotal, bytesPerSecond, message };
}

function logText(row: Record<string, unknown>): string {
  if (typeof row.text_log === 'string') return row.text_log;
  if (row.json_log && typeof row.json_log === 'object') {
    const body = row.json_log as Record<string, unknown>;
    if (typeof body.message === 'string') return body.message;
    if (typeof body.msg === 'string') return body.msg;
    try {
      return JSON.stringify(body);
    } catch {
      return '';
    }
  }
  return '';
}
