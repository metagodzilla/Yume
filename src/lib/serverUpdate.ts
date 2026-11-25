export type ServerReleaseAsset = { name?: string; browser_download_url?: string };
export type ServerRelease = { tag_name?: string; assets?: ServerReleaseAsset[] };

export type ServerCodeOffer = { ref: string; version: string; shaUrl: string };

const SERVER_TAG = /^server-v(\d+\.\d+\.\d+)$/;

export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number(part) || 0);
  const b = right.split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

export function newerServerRelease(releases: ServerRelease[], runningVersion: string): ServerCodeOffer | null {
  for (const release of releases) {
    const match = SERVER_TAG.exec(release.tag_name || '');
    const sha = release.assets?.find((asset) => asset.name === 'yume-server-code.sha256');
    if (!match || !sha?.browser_download_url) continue;
    if (compareVersions(match[1], runningVersion) > 0) {
      return { ref: release.tag_name || '', version: match[1], shaUrl: sha.browser_download_url };
    }
  }
  return null;
}

export function serverUpdateCall(input: { endpoint: string; adminToken: string; gatewayKey: string; ref: string; sha256: string }) {
  const endpoint = input.endpoint.replace(/\/$/, '');
  return {
    url: `${endpoint}/admin/update`,
    method: 'POST' as const,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': input.adminToken,
      Authorization: `Bearer ${input.gatewayKey}`,
      'X-Api-Key': input.gatewayKey,
      'Salad-Api-Key': input.gatewayKey,
    },
    body: JSON.stringify({ ref: input.ref, sha256: input.sha256 }),
  };
}

export function mintAdminToken(bytes = 16): string {
  const values = new Uint8Array(bytes);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.getRandomValues) cryptoRef.getRandomValues(values);
  else for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 256);
  return [...values].map((value) => value.toString(16).padStart(2, '0')).join('');
}
