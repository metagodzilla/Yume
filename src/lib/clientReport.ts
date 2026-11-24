import { Platform } from 'react-native';

import { recentFaults, redactValue, type ServerFault } from '@/src/lib/reportText';
import { APP_VERSION, APP_VERSION_CODE } from '@/src/lib/version';

export { rememberFault, redactValue, reportDocument } from '@/src/lib/reportText';
export type { AppFault, ServerFault } from '@/src/lib/reportText';

export function clientReportBody(): Record<string, unknown> {
  const faults = recentFaults();
  return redactValue({
    appVersion: APP_VERSION,
    versionCode: APP_VERSION_CODE,
    device: Platform.OS,
    errors: faults,
    request: faults.length ? faults[faults.length - 1] : null,
  }) as Record<string, unknown>;
}

export async function sendClientReport(endpoint: string, apiKey: string): Promise<void> {
  if (!endpoint || !apiKey) return;
  await fetch(`${endpoint}/client-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'Salad-Api-Key': apiKey, 'X-Api-Key': apiKey },
    body: JSON.stringify(clientReportBody()),
  });
}

export async function fetchServerErrors(endpoint: string, apiKey: string): Promise<ServerFault[]> {
  if (!endpoint || !apiKey) return [];
  const response = await fetch(`${endpoint}/errors`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Salad-Api-Key': apiKey, 'X-Api-Key': apiKey },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${endpoint}/errors`);
  const body = (await response.json()) as { errors?: ServerFault[] };
  return Array.isArray(body.errors) ? body.errors : [];
}
