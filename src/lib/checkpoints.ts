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

export type FamilyPreset = {
  sampler: string;
  steps: number;
  cfg: number;
  clipSkip: number;
  width: number;
  height: number;
  quality: string;
  negative: string;
  vPrediction: boolean;
  hires: boolean;
  hiresScale: number;
  hiresDenoise: number;
  hiresSteps: number;
  hiresUpscaler: string;
};

export type RecommendedSettings = {
  sampler?: string;
  steps?: number;
  cfg?: number;
  clipSkip?: number;
  width?: number;
  height?: number;
};

const HIRES_OFF = { hires: false, hiresScale: 1.5, hiresDenoise: 0.4, hiresSteps: 18, hiresUpscaler: 'Latent' };
const HIRES_ON = { hires: true, hiresScale: 1.5, hiresDenoise: 0.4, hiresSteps: 18, hiresUpscaler: 'Latent' };

const ILLUSTRIOUS_NEGATIVE =
  'lowres, worst quality, bad quality, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, jpeg artifacts, signature, watermark, artist name, username, blurry, 3d, shiny skin, oversaturated';

export function isVPrediction(name: string): boolean {
  return /v[\s_-]?pred|v_prediction/i.test(name);
}

export function familyPreset(baseModel: string, name = ''): FamilyPreset {
  const family = baseFamily(baseModel);
  const text = `${name} ${baseModel}`;
  const vPrediction = isVPrediction(text);
  if (/animagine/i.test(text)) {
    return {
      sampler: 'Euler a',
      steps: 25,
      cfg: 6,
      clipSkip: 2,
      width: 832,
      height: 1216,
      quality: 'masterpiece, high score, great score, absurdres',
      negative:
        'lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry',
      vPrediction: false,
      ...HIRES_OFF,
    };
  }
  if (family === 'Illustrious') {
    return {
      sampler: 'Euler a',
      steps: 28,
      cfg: 5,
      clipSkip: /\bprefect\b/i.test(name) && !/prefectious/i.test(name) ? 1 : 2,
      width: 832,
      height: 1216,
      quality: 'masterpiece, best quality, amazing quality, very aesthetic, absurdres',
      negative: ILLUSTRIOUS_NEGATIVE,
      vPrediction,
      ...HIRES_ON,
    };
  }
  if (family === 'Pony') {
    return {
      sampler: 'Euler a',
      steps: 25,
      cfg: 7,
      clipSkip: 2,
      width: 832,
      height: 1216,
      quality: 'score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up',
      negative: 'score_6, score_5, score_4, score_3, score_2, score_1, source_pony, worst quality, low quality, bad anatomy, signature, watermark',
      vPrediction,
      ...HIRES_OFF,
    };
  }
  if (family === 'NoobAI') {
    return {
      sampler: 'Euler a',
      steps: 28,
      cfg: vPrediction ? 4.5 : 5,
      clipSkip: 2,
      width: 832,
      height: 1216,
      quality: 'masterpiece, best quality, amazing quality, very aesthetic, absurdres',
      negative: ILLUSTRIOUS_NEGATIVE,
      vPrediction,
      ...HIRES_OFF,
    };
  }
  if (family === 'Flux') {
    return {
      sampler: 'Euler',
      steps: 28,
      cfg: 3.5,
      clipSkip: 1,
      width: 1024,
      height: 1024,
      quality: '',
      negative: '',
      vPrediction: false,
      ...HIRES_OFF,
    };
  }
  if (family === 'SD 1.5') {
    return {
      sampler: 'Euler a',
      steps: 28,
      cfg: 7,
      clipSkip: 2,
      width: 512,
      height: 768,
      quality: 'masterpiece, best quality',
      negative: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, signature, watermark, username, blurry',
      vPrediction: false,
      ...HIRES_OFF,
    };
  }
  return {
    sampler: 'Euler a',
    steps: 28,
    cfg: 5,
    clipSkip: 2,
    width: 832,
    height: 1216,
    quality: 'masterpiece, best quality, very aesthetic, absurdres',
    negative: 'lowres, worst quality, bad quality, bad anatomy, bad hands, signature, watermark, username, blurry',
    vPrediction,
    ...HIRES_OFF,
  };
}

export function settingsForCheckpoint(baseModel: string, name = '', recommended?: RecommendedSettings): FamilyPreset {
  const preset = familyPreset(baseModel, name);
  return {
    ...preset,
    sampler: recommended?.sampler?.trim() || preset.sampler,
    steps: numberOr(recommended?.steps, preset.steps),
    cfg: numberOr(recommended?.cfg, preset.cfg),
    clipSkip: numberOr(recommended?.clipSkip, preset.clipSkip),
    width: numberOr(recommended?.width, preset.width),
    height: numberOr(recommended?.height, preset.height),
  };
}

export function recommendedFromMeta(meta: Record<string, unknown> | null | undefined): RecommendedSettings {
  if (!meta) return {};
  const steps = Number(meta.steps);
  const cfg = Number(meta.cfgScale ?? meta.cfg);
  const clipSkip = Number(meta.clipSkip);
  const size = String(meta.size || meta.Size || '');
  const parsed = size.match(/(\d+)\s*[x×]\s*(\d+)/i);
  return {
    sampler: typeof meta.sampler === 'string' ? meta.sampler : undefined,
    steps: Number.isFinite(steps) && steps > 0 ? steps : undefined,
    cfg: Number.isFinite(cfg) && cfg > 0 ? cfg : undefined,
    clipSkip: Number.isFinite(clipSkip) && clipSkip > 0 ? clipSkip : undefined,
    width: parsed ? Number(parsed[1]) : undefined,
    height: parsed ? Number(parsed[2]) : undefined,
  };
}

export const WAI_ILLUSTRIOUS = {
  modelId: 827184,
  versionId: 2883731,
  name: 'WAI-illustrious-SDXL',
  version: 'v17.0',
  type: 'Checkpoint' as const,
  baseModel: 'Illustrious',
  filename: 'WAI-Nsfw-Illustrious-17.safetensors',
};

export function illustriousOffer(checkpointBase: string, loraBase: string, installed: { type?: string; baseModel?: string }[]): '' | 'switch' | 'install' {
  if (baseFamily(loraBase) !== 'Illustrious' || baseFamily(checkpointBase) === 'Illustrious') return '';
  const have = installed.some((item) => (item.type ?? 'Checkpoint') === 'Checkpoint' && baseFamily(item.baseModel ?? '') === 'Illustrious');
  return have ? 'switch' : 'install';
}

export function loraBaseWarning(checkpointBase: string, loraBase: string): string {
  if (!loraBase.trim()) return '';
  if (baseFamily(checkpointBase) === baseFamily(loraBase)) return '';
  return `This LoRA is ${baseLabel(loraBase)} and the checkpoint is ${baseLabel(checkpointBase)}. They do not match, so the picture can come out wrong.`;
}

export function loadedModelName(models: { versionId: number; name: string }[], active: number | null): string {
  const match = models.find((item) => item.versionId === active);
  return match?.name || 'Animagine XL 4.0';
}

export function defaultsForBase(
  baseModel: string,
  recommended?: { clipSkip?: number; width?: number; height?: number },
): { clipSkip: number; width: number; height: number } {
  const preset = familyPreset(baseModel);
  return {
    clipSkip: numberOr(recommended?.clipSkip, preset.clipSkip),
    width: numberOr(recommended?.width, preset.width),
    height: numberOr(recommended?.height, preset.height),
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
