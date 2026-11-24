export const CLOUD_OFF_INSTALL = 'Cloud is off - Start cloud and install';

export function isServerInstalled(catalogVersionIds: number[], doneJobVersionIds: number[], versionId: number): boolean {
  return catalogVersionIds.includes(versionId) || doneJobVersionIds.includes(versionId);
}

export function cloudIsOff(input: { groupStatus?: string; readyStatus?: number }): boolean {
  const status = (input.groupStatus || '').toLowerCase();
  if (!status || status === 'stopped' || status === 'succeeded' || status === 'stopping' || status === 'failed') return true;
  return input.readyStatus !== 200;
}

export function needsCloudStart(groupStatus?: string): boolean {
  const status = (groupStatus || '').toLowerCase();
  return !status || status === 'stopped' || status === 'succeeded' || status === 'failed' || status === 'stopping';
}

export function installAction(input: { cloudReady: boolean; serverInstalled: boolean }): 'installed' | 'install' | 'start-and-install' {
  if (input.serverInstalled) return 'installed';
  if (!input.cloudReady) return 'start-and-install';
  return 'install';
}

export function canUseAsDefault(serverInstalled: boolean): boolean {
  return serverInstalled;
}

export function installRequest(versionId: number, civitaiToken?: string | null): { body: { versionId: number }; headers: Record<string, string> } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = civitaiToken?.trim();
  if (token) headers['X-Civitai-Token'] = token;
  return { body: { versionId }, headers };
}
