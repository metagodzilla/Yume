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
