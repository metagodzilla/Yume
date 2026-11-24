import type { InstalledResource } from '@/src/lib/genstore';

/** Explore is the Civitai browser. `/models` is a hidden tab and lands on Home. */
export const BROWSE_CIVITAI_ROUTE = '/(tabs)/explore';

export type CatalogCheckpoint = {
  versionId: number;
  modelId?: number;
  name: string;
  version?: string;
  type?: string;
  baseModel?: string;
  filename?: string;
  hash?: string;
  sha256?: string;
  triggers?: string[];
  isDefault?: boolean;
  source?: string;
  path?: string;
  recommended?: { clipSkip?: number; width?: number; height?: number };
};

export type BaseFamily = 'SD 1.5' | 'SDXL' | 'Pony' | 'Illustrious' | 'NoobAI' | 'Flux' | 'Other';

export function modelCardPress(): { action: 'open-sheet'; browse: typeof BROWSE_CIVITAI_ROUTE } {
  return { action: 'open-sheet', browse: BROWSE_CIVITAI_ROUTE };
}

export function routeLeavesCreate(path: string): boolean {
  const bare = path.replace(/\/$/, '') || '/';
  return bare === '/models' || bare === '/(tabs)/models' || bare === '/' || bare === '/(tabs)' || bare === '/(tabs)/index';
}

export function baseFamily(baseModel: string): BaseFamily {
  const text = baseModel.toLowerCase();
  if (text.includes('illustrious')) return 'Illustrious';
  if (text.includes('pony')) return 'Pony';
  if (text.includes('noob')) return 'NoobAI';
  if (text.includes('flux')) return 'Flux';
  if (text.includes('sd 1.5') || text.includes('sd1.5') || text.includes('sd1')) return 'SD 1.5';
  if (text.includes('sdxl') || text.includes('xl')) return 'SDXL';
  return 'Other';
}

export function baseLabel(baseModel: string): string {
  const family = baseFamily(baseModel);
  if (family === 'SDXL') return 'SDXL';
  if (family === 'Other') return baseModel.trim() || 'SDXL';
  return family;
}

export function defaultsForBase(
  baseModel: string,
  recommended?: { clipSkip?: number; width?: number; height?: number },
): { clipSkip: number; width: number; height: number } {
  const family = baseFamily(baseModel);
  const fallback =
    family === 'SD 1.5'
      ? { clipSkip: 2, width: 512, height: 768 }
      : family === 'Flux'
        ? { clipSkip: 1, width: 1024, height: 1024 }
        : { clipSkip: 2, width: 832, height: 1216 };
  return {
    clipSkip: numberOr(recommended?.clipSkip, fallback.clipSkip),
    width: numberOr(recommended?.width, fallback.width),
    height: numberOr(recommended?.height, fallback.height),
  };
}

export function isCheckpoint(item: { type?: string }): boolean {
  return (item.type || 'Checkpoint') === 'Checkpoint';
}

export function toInstalled(record: CatalogCheckpoint): InstalledResource {
  return {
    versionId: record.versionId,
    modelId: record.modelId ?? 0,
    name: record.name,
    version: record.version || '',
    type: record.type || 'Checkpoint',
    baseModel: record.baseModel || 'SDXL 1.0',
    filename: record.filename || '',
    hash: record.hash || '',
    sha256: record.sha256 || '',
    triggers: record.triggers ?? [],
    isDefault: Boolean(record.isDefault),
  };
}

function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
