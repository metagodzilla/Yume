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

export function readInstalledVersionCode(nativeBuildVersion: string | null | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(nativeBuildVersion ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type ReleaseDecision = {
  label: string;
  apkUrl: string | null;
  bad: boolean;
  retry: boolean;
  latestVersion: string | null;
  latestCode: number | null;
};

export function decideReleaseCheck(input: {
  status: number;
  release: GithubRelease | null;
  localVersion: string;
  localCode: number;
}): ReleaseDecision {
  if (input.status === 304 && !input.release) {
    return { label: 'GitHub returned 304 without a release. Tap Update to try again.', apkUrl: null, bad: true, retry: true, latestVersion: null, latestCode: null };
  }
  if (input.status === 403 || input.status === 429) {
    return { label: 'GitHub rate limit. Tap Update to try again.', apkUrl: null, bad: true, retry: false, latestVersion: null, latestCode: null };
  }
  if (input.status === 404) {
    return { label: 'No GitHub release yet', apkUrl: null, bad: false, retry: false, latestVersion: null, latestCode: null };
  }
  if (!input.release || input.status >= 400) {
    return { label: `HTTP ${input.status}. GitHub rejected the update check.`, apkUrl: null, bad: true, retry: false, latestVersion: null, latestCode: null };
  }
  const status = releaseStatus(input.localVersion, input.localCode, input.release);
  return {
    label: status.label,
    apkUrl: status.available ? input.release.apkUrl : null,
    bad: false,
    retry: false,
    latestVersion: input.release.version,
    latestCode: input.release.versionCode,
  };
}

let cachedRelease: GithubRelease | null = null;
let cachedEtag: string | null = null;

export type UpdateCheckResult = ReleaseDecision & { checkedAt: number };

export async function checkGithubRelease(
  localVersion: string,
  localCode: number,
  fetchImpl: typeof fetch = fetch,
  options?: { force?: boolean },
): Promise<UpdateCheckResult> {
  const checkedAt = Date.now();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'yume',
    'Cache-Control': 'no-cache, no-store',
    Pragma: 'no-cache',
  };
  if (!options?.force && cachedEtag) headers['If-None-Match'] = cachedEtag;
  let response: Response;
  try {
    response = await fetchImpl(`${GITHUB_LATEST_RELEASE}?ts=${checkedAt}`, {
      headers,
      cache: 'no-store',
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'The phone could not reach GitHub.';
    return { label: message, apkUrl: null, bad: true, retry: false, latestVersion: null, latestCode: null, checkedAt };
  }
  if (response.status === 304) {
    if (!cachedRelease && !options?.force) return checkGithubRelease(localVersion, localCode, fetchImpl, { force: true });
    const decided = decideReleaseCheck({ status: 304, release: cachedRelease, localVersion, localCode });
    return { ...decided, checkedAt };
  }
  if (response.status === 403 || response.status === 429) {
    return { ...decideReleaseCheck({ status: response.status, release: null, localVersion, localCode }), checkedAt };
  }
  if (response.status === 404) {
    return { ...decideReleaseCheck({ status: 404, release: null, localVersion, localCode }), checkedAt };
  }
  if (!response.ok) {
    const text = (await response.text()).replace(/\s+/g, ' ').slice(0, 140);
    return { label: `HTTP ${response.status}. ${text || 'GitHub rejected the update check.'}`, apkUrl: null, bad: true, retry: false, latestVersion: null, latestCode: null, checkedAt };
  }
  try {
    const release = parseGithubRelease(await response.json());
    cachedRelease = release;
    cachedEtag = response.headers.get('etag');
    return { ...decideReleaseCheck({ status: response.status, release, localVersion, localCode }), checkedAt };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'The GitHub release could not be read.';
    return { label: message, apkUrl: null, bad: true, retry: false, latestVersion: null, latestCode: null, checkedAt };
  }
}
