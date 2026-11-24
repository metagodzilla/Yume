const SECRET = /sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._\-]+|api[_-]?key["']?\s*[:=]\s*["'][^"']+/gi;

export function redact(value: string): string {
  return value
    .replace(SECRET, '[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[host]');
}

export function buildReport(input: {
  version: string;
  versionCode: number;
  device: string;
  android: string;
  settings: Record<string, unknown>;
  errors: string[];
  cloud?: string;
}): string {
  const settings = Object.entries(input.settings)
    .filter(([key]) => !/key|token|secret|password/i.test(key))
    .map(([key, value]) => `${key}: ${redact(String(value ?? ''))}`)
    .join('\n');
  const errors = input.errors.map((line) => redact(line)).join('\n');
  return [
    'Yume problem report',
    `Version: ${input.version} (${input.versionCode})`,
    `Device: ${redact(input.device)}`,
    `System: ${redact(input.android)}`,
    '',
    'Settings (secrets removed):',
    settings || '(none)',
    '',
    'Cloud check:',
    redact(input.cloud || 'Not run'),
    '',
    'Recent errors:',
    errors || '(none)',
  ].join('\n');
}
