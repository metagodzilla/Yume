export type UpdateManifest = {
  version: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
  notes?: string;
};

export function parseManifest(raw: string): UpdateManifest {
  const body = JSON.parse(raw) as Partial<UpdateManifest>;
  if (!body.version || typeof body.versionCode !== 'number' || !body.apkUrl || !body.sha256) {
    throw new Error('That update file is missing a version, version code, APK address, or checksum.');
  }
  return {
    version: body.version,
    versionCode: body.versionCode,
    apkUrl: body.apkUrl,
    sha256: body.sha256.toLowerCase(),
    notes: body.notes,
  };
}

export function updateAvailable(localVersionCode: number, manifest: UpdateManifest): boolean {
  return manifest.versionCode > localVersionCode && Boolean(manifest.apkUrl.trim());
}

export function checksumMatches(actual: string, expected: string): boolean {
  return actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

export const GITHUB_LATEST_RELEASE = 'https://api.github.com/repos/metagodzilla/Yume/releases/latest';

export type GithubRelease = {
  version: string;
  versionCode: number | null;
  apkUrl: string;
  apkName: string;
  notes: string;
};

export function compareVersions(local: string, remote: string): number {
  const parse = (value: string) =>
    value
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const left = parse(local);
  const right = parse(remote);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (right[index] ?? 0) - (left[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function parseGithubRelease(payload: unknown): GithubRelease {
  if (!payload || typeof payload !== 'object') throw new Error('GitHub did not return a release.');
  const body = payload as {
    tag_name?: string;
    name?: string;
    body?: string;
    message?: string;
    assets?: { name?: string; browser_download_url?: string }[];
  };
  if (body.message && !body.tag_name) throw new Error(body.message);
  const assets = body.assets ?? [];
  const apk = assets.find((asset) => asset.name?.toLowerCase().endsWith('.apk') && asset.browser_download_url);
  if (!apk?.browser_download_url || !apk.name) throw new Error('The latest GitHub release has no APK asset.');
  const version = (body.tag_name || body.name || '').replace(/^v/i, '').trim();
  if (!version) throw new Error('The latest GitHub release has no version name.');
  const notes = body.body ?? '';
  const fromNotes = notes.match(/versionCode:\s*(\d+)/i);
  const fromName = apk.name.match(/vc(\d+)/i);
  const versionCode = fromNotes ? Number(fromNotes[1]) : fromName ? Number(fromName[1]) : null;
  return { version, versionCode, apkUrl: apk.browser_download_url, apkName: apk.name, notes };
}

export function releaseStatus(
  localVersion: string,
  localCode: number,
  release: Pick<GithubRelease, 'version' | 'versionCode'>,
): { available: boolean; label: string } {
  const version = release.version.replace(/^v/i, '');
  if (release.versionCode != null) {
    if (release.versionCode > localCode) return { available: true, label: `Update available v${version}` };
    return { available: false, label: 'Up to date' };
  }
  if (compareVersions(localVersion, release.version) > 0) return { available: true, label: `Update available v${version}` };
  return { available: false, label: 'Up to date' };
}

export async function checkGithubRelease(
  localVersion: string,
  localCode: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ label: string; apkUrl: string | null; bad: boolean }> {
  let response: Response;
  try {
    response = await fetchImpl(GITHUB_LATEST_RELEASE, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'yume' },
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'The phone could not reach GitHub.';
    return { label: message, apkUrl: null, bad: true };
  }
  if (response.status === 404) return { label: 'No GitHub release yet', apkUrl: null, bad: false };
  if (!response.ok) {
    const text = (await response.text()).replace(/\s+/g, ' ').slice(0, 180);
    return { label: `HTTP ${response.status}. ${text || 'GitHub rejected the update check.'}`, apkUrl: null, bad: true };
  }
  try {
    const release = parseGithubRelease(await response.json());
    const status = releaseStatus(localVersion, localCode, release);
    return { label: status.label, apkUrl: status.available ? release.apkUrl : null, bad: false };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'The GitHub release could not be read.';
    return { label: message, apkUrl: null, bad: true };
  }
}
