import { useSyncExternalStore } from 'react';

import type { ContentFilter } from '@/src/lib/civitai';
import { ANIME_STUDIO_CHECKPOINT, STUDIO_APPLIED, type StudioStyleId } from '@/src/lib/animeStudio';
import { detectLoraKind, mergeTriggerWords } from '@/src/lib/loraPrompt';
import { settleSavedPrompts } from '@/src/lib/positiveTags';
import { settingsForCheckpoint, type RecommendedSettings } from '@/src/lib/checkpoints';
import { DEFAULT_CHECKPOINT } from '@/src/lib/defaultModel';

export type InstalledResource = {
  versionId: number;
  modelId: number;
  name: string;
  version: string;
  type: string;
  baseModel: string;
  filename: string;
  hash: string;
  sha256: string;
  triggers: string[];
  isDefault: boolean;
};

export type GeneratorState = {
  describe: string;
  prompt: string;
  /** When true, Describe is converted into the Prompt box. */
  promptAuto: boolean;
  /** Last tags written from Describe, so a later edit can keep hand-added tags. */
  autoPrompt?: string;
  positive: string;
  /** When true, Positive is filled with supporting tags from the same description. */
  positiveAuto: boolean;
  autoPositive?: string;
  /** Outfit tags. Filled from Describe when clothesAuto is on, or from the selected character. */
  clothes: string;
  clothesAuto: boolean;
  autoClothes?: string;
  referencePose: boolean;
  referencePoseStrength: number;
  referenceFit: boolean;
  referenceBody: 'petite' | 'average' | 'tall';
  referenceCopy: boolean;
  referenceDenoise: number;
  referenceStyle: boolean;
  referenceStyleStrength: number;
  /** When true, liked style tags are added lightly and disliked tags go to the negative. */
  useTaste?: boolean;
  quality: string;
  qualityEdited: boolean;
  /** @deprecated Merged into positive. Kept so a 1.4.9 save still loads. */
  extraPrompt?: string;
  negative: string;
  sampler: string;
  steps: number;
  cfg: number;
  seed: string;
  seedRandom: boolean;
  width: number;
  height: number;
  clipSkip: number;
  count: number;
  qualityTags: boolean;
  triggers: boolean;
  checkpointId: number;
  loras: { name: string; weight: number; modelId?: number; versionId?: number; baseModel?: string; triggers?: string[]; triggerGroup?: number; prompt?: string; enabled?: boolean; kind?: 'character' | 'style' }[];
  regionLayout: 'side' | 'stack';
  interaction: string;
  contentFilter: ContentFilter;
  embeddings: string;
  vae: string;
  hires: boolean;
  hiresScale: number;
  hiresDenoise: number;
  hiresUpscaler: string;
  hiresSteps: number;
  mode: 'txt2img' | 'img2img' | 'inpaint';
  denoise: number;
  nsfw: boolean;
  installed: InstalledResource[];
  vPrediction: boolean;
  studioStyle: StudioStyleId;
  studioApplied?: string;
};

export const defaultResource = (): InstalledResource => ({
  versionId: DEFAULT_CHECKPOINT.versionId,
  modelId: DEFAULT_CHECKPOINT.modelId,
  name: DEFAULT_CHECKPOINT.name,
  version: DEFAULT_CHECKPOINT.version,
  type: DEFAULT_CHECKPOINT.type,
  baseModel: DEFAULT_CHECKPOINT.baseModel,
  filename: DEFAULT_CHECKPOINT.filename,
  hash: DEFAULT_CHECKPOINT.hash,
  sha256: DEFAULT_CHECKPOINT.sha256,
  triggers: [],
  isDefault: true,
});

export const studioResource = (): InstalledResource => ({
  versionId: ANIME_STUDIO_CHECKPOINT.versionId,
  modelId: ANIME_STUDIO_CHECKPOINT.modelId,
  name: ANIME_STUDIO_CHECKPOINT.name,
  version: ANIME_STUDIO_CHECKPOINT.version,
  type: ANIME_STUDIO_CHECKPOINT.type,
  baseModel: ANIME_STUDIO_CHECKPOINT.baseModel,
  filename: ANIME_STUDIO_CHECKPOINT.filename,
  hash: ANIME_STUDIO_CHECKPOINT.hash,
  sha256: ANIME_STUDIO_CHECKPOINT.sha256,
  triggers: [],
  isDefault: true,
});

export const initialGenerator = (): GeneratorState => ({
  describe: '',
  prompt: '',
  promptAuto: false,
  autoPrompt: '',
  positive: '',
  positiveAuto: false,
  autoPositive: '',
  clothes: '',
  clothesAuto: false,
  autoClothes: '',
  referencePose: false,
  referencePoseStrength: 0.85,
  referenceFit: true,
  referenceBody: 'average',
  referenceCopy: false,
  referenceDenoise: 0.6,
  referenceStyle: false,
  referenceStyleStrength: 0.55,
  useTaste: true,
  quality: DEFAULT_CHECKPOINT.quality,
  qualityEdited: false,
  extraPrompt: '',
  negative: DEFAULT_CHECKPOINT.negative,
  sampler: DEFAULT_CHECKPOINT.sampler,
  steps: DEFAULT_CHECKPOINT.steps,
  cfg: DEFAULT_CHECKPOINT.cfg,
  seed: '1',
  seedRandom: true,
  width: DEFAULT_CHECKPOINT.width,
  height: DEFAULT_CHECKPOINT.height,
  clipSkip: DEFAULT_CHECKPOINT.clipSkip,
  count: 1,
  qualityTags: true,
  triggers: true,
  checkpointId: DEFAULT_CHECKPOINT.versionId,
  loras: [],
  regionLayout: 'side',
  interaction: '',
  embeddings: '',
  vae: '',
  hires: false,
  hiresScale: 1.5,
  hiresDenoise: 0.4,
  hiresUpscaler: 'Latent',
  hiresSteps: 18,
  mode: 'txt2img',
  denoise: 0.55,
  nsfw: false,
  contentFilter: 'sfw',
  installed: [defaultResource()],
  vPrediction: false,
  studioStyle: 'anime',
  studioApplied: STUDIO_APPLIED,
});

let state = initialGenerator();
const listeners = new Set<() => void>();
let hydrated = false;

function emit() {
  for (const listener of listeners) listener();
}

export function getGenerator(): GeneratorState {
  return state;
}

export function patchGenerator(patch: Partial<GeneratorState>) {
  const contentFilter = patch.contentFilter ?? state.contentFilter;
  state = { ...state, ...patch, contentFilter, nsfw: contentFilter !== 'sfw' };
  emit();
  void persist();
}

export function toggleLora(lora: { name: string; weight: number; modelId?: number; versionId?: number }) {
  const same = (item: GeneratorState['loras'][number]) =>
    lora.versionId && item.versionId ? item.versionId === lora.versionId : item.name === lora.name;
  const exists = state.loras.some(same);
  patchGenerator({ loras: exists ? state.loras.filter((item) => !same(item)) : [...state.loras, lora] });
}

export function installLocal(resource: InstalledResource) {
  const others = state.installed.filter((item) => item.versionId !== resource.versionId);
  const installed = [...others, resource];
  patchGenerator({ installed, checkpointId: resource.type === 'Checkpoint' ? resource.versionId : state.checkpointId });
}

export function applyCheckpoint(resource: InstalledResource, recommended?: RecommendedSettings) {
  const preset = settingsForCheckpoint(resource.baseModel, resource.name, recommended);
  const installed = [
    ...state.installed
      .filter((item) => item.versionId !== resource.versionId)
      .map((item) => (item.type === 'Checkpoint' ? { ...item, isDefault: false } : item)),
    { ...resource, isDefault: resource.type === 'Checkpoint' },
  ];
  patchGenerator({
    installed,
    checkpointId: resource.type === 'Checkpoint' ? resource.versionId : state.checkpointId,
    sampler: preset.sampler,
    steps: preset.steps,
    cfg: preset.cfg,
    clipSkip: preset.clipSkip,
    width: preset.width,
    height: preset.height,
    negative: preset.negative,
    ...(state.qualityEdited ? {} : { quality: preset.quality }),
    qualityTags: true,
    hires: preset.hires,
    hiresScale: preset.hiresScale,
    hiresDenoise: preset.hiresDenoise,
    hiresSteps: preset.hiresSteps,
    hiresUpscaler: preset.hiresUpscaler,
    vPrediction: preset.vPrediction,
  });
  void import('@/src/lib/restoreModels').then(({ keepInstalled }) =>
    keepInstalled(
      {
        versionId: resource.versionId,
        type: resource.type,
        name: resource.name,
        filename: resource.filename,
        baseModel: resource.baseModel,
        triggers: resource.triggers,
      },
      resource.type === 'Checkpoint',
    ),
  );
}

export function resetModelDefaults(baseModel: string, name = '') {
  const preset = settingsForCheckpoint(baseModel, name);
  patchGenerator({
    sampler: preset.sampler,
    steps: preset.steps,
    cfg: preset.cfg,
    clipSkip: preset.clipSkip,
    width: preset.width,
    height: preset.height,
    negative: preset.negative,
    ...(state.qualityEdited ? {} : { quality: preset.quality }),
    qualityTags: true,
    hires: preset.hires,
    hiresScale: preset.hiresScale,
    hiresDenoise: preset.hiresDenoise,
    hiresSteps: preset.hiresSteps,
    hiresUpscaler: preset.hiresUpscaler,
    vPrediction: preset.vPrediction,
  });
}

export function resetBuiltPrompt(baseModel: string, name = '') {
  const preset = settingsForCheckpoint(baseModel, name);
  patchGenerator({ quality: preset.quality, qualityEdited: false, qualityTags: true, extraPrompt: '' });
}

export function resetQualityTags(baseModel: string, name = '') {
  const preset = settingsForCheckpoint(baseModel, name);
  patchGenerator({ quality: preset.quality, qualityEdited: false, qualityTags: true });
}

export function addLora(lora: { name: string; weight: number; modelId?: number; versionId?: number; triggers?: string[]; baseModel?: string; kind?: 'character' | 'style'; tags?: string[]; type?: string }): { ok: boolean; message: string | null } {
  const same = (item: GeneratorState['loras'][number]) =>
    lora.versionId && item.versionId ? item.versionId === lora.versionId : item.name === lora.name;
  const existing = state.loras.find(same);
  if (!existing && state.loras.length >= 10) {
    return { ok: false, message: 'You can use up to 10 LoRAs. Remove one before adding another.' };
  }
  const triggers = lora.triggers?.length ? lora.triggers : existing?.triggers;
  const prompt = mergeTriggerWords(existing?.prompt || '', triggers);
  const kind = existing?.kind || detectLoraKind({ type: lora.type, tags: lora.tags, name: lora.name, kind: lora.kind });
  const others = state.loras.filter((item) => !same(item));
  patchGenerator({
    loras: [...others, { name: lora.name, weight: lora.weight, modelId: lora.modelId, versionId: lora.versionId, baseModel: lora.baseModel, triggers, triggerGroup: existing?.triggerGroup ?? 0, prompt, enabled: existing?.enabled !== false, kind }],
    triggers: true,
  });
  if (lora.versionId) {
    void import('@/src/lib/restoreModels').then(({ keepInstalled }) =>
      keepInstalled({ versionId: lora.versionId!, type: 'LORA', name: lora.name, triggers }),
    );
  }
  return { ok: true, message: prompt.trim() ? null : 'This LoRA has no trigger words.' };
}

export async function addLoraWithTriggers(
  lora: { name: string; weight: number; modelId?: number; versionId?: number; triggers?: string[]; baseModel?: string; kind?: 'character' | 'style'; tags?: string[]; type?: string },
  token?: string | null,
): Promise<{ ok: boolean; message: string | null }> {
  let triggers = lora.triggers;
  if ((!triggers || !triggers.length) && lora.versionId) {
    const { fetchTrainedWords } = await import('@/src/lib/loraPrompt');
    triggers = await fetchTrainedWords(lora.versionId, token);
  }
  return addLora({ ...lora, triggers });
}

export function rememberServerModels(records: InstalledResource[]) {
  const checkpoints = records.filter((item) => item.type === 'Checkpoint');
  const rest = state.installed.filter((item) => item.type !== 'Checkpoint' && !checkpoints.some((record) => record.versionId === item.versionId));
  const installed = [...checkpoints, ...rest];
  const checkpointId = installed.some((item) => item.versionId === state.checkpointId)
    ? state.checkpointId
    : checkpoints.find((item) => item.isDefault)?.versionId ?? state.checkpointId;
  patchGenerator({ installed, checkpointId });
}

export function replaceServerCheckpoints(records: InstalledResource[], activeId: number | null) {
  const extras = state.installed.filter((item) => item.type !== 'Checkpoint');
  const installed = [...records.map((item) => ({ ...item, isDefault: item.versionId === activeId })), ...extras];
  const stillSelected = records.some((item) => item.versionId === state.checkpointId);
  const checkpointId = stillSelected
    ? state.checkpointId
    : activeId && records.some((item) => item.versionId === activeId)
      ? activeId
      : records[0]?.versionId ?? state.checkpointId;
  patchGenerator({ installed, checkpointId });
}

export function setDefaultCheckpoint(versionId: number) {
  const installed = state.installed.map((item) => ({
    ...item,
    isDefault: item.type === 'Checkpoint' && item.versionId === versionId,
  }));
  const chosen = installed.find((item) => item.versionId === versionId);
  patchGenerator({
    installed,
    checkpointId: versionId,
    ...(chosen
      ? {
          width: chosen.baseModel.startsWith('Flux') ? 1024 : chosen.baseModel === 'SD 1.5' ? 512 : state.width,
          height: chosen.baseModel.startsWith('Flux') ? 1024 : chosen.baseModel === 'SD 1.5' ? 512 : state.height,
        }
      : {}),
  });
}

export function removeLocal(versionId: number) {
  const installed = state.installed.filter((item) => item.versionId !== versionId);
  const fallback = installed.find((item) => item.isDefault && item.type === 'Checkpoint') ?? installed.find((item) => item.type === 'Checkpoint');
  patchGenerator({ installed: fallback ? installed : [defaultResource(), ...installed], checkpointId: fallback?.versionId ?? DEFAULT_CHECKPOINT.versionId });
  void import('@/src/lib/restoreModels').then(({ dropKept }) => dropKept(versionId));
}

function persist() {
  void import('@/src/lib/storage').then(({ saveGeneratorBlob }) => saveGeneratorBlob(JSON.stringify(state))).catch(() => undefined);
}

export async function hydrateFromDisk() {
  if (hydrated) return;
  hydrated = true;
  try {
    const { loadGeneratorBlob } = await import('@/src/lib/storage');
    const raw = await loadGeneratorBlob();
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<GeneratorState>;
    const installed = Array.isArray(parsed.installed) && parsed.installed.length ? parsed.installed : [defaultResource()];
    const retired = new Set([1337429, 1408658]);
    const keptInstalled = installed.filter((item) => !retired.has(item.versionId));
    if (!keptInstalled.some((item) => item.versionId === DEFAULT_CHECKPOINT.versionId)) keptInstalled.unshift(defaultResource());
    const contentFilter: ContentFilter =
      parsed.contentFilter === 'all' || parsed.contentFilter === 'sfw' || parsed.contentFilter === 'nsfw'
        ? parsed.contentFilter
        : parsed.nsfw
          ? 'all'
          : 'sfw';
    const fresh = initialGenerator();
    const settled = settleSavedPrompts(parsed);
    state = { ...fresh, ...parsed, ...settled, installed: keptInstalled, contentFilter, nsfw: contentFilter !== 'sfw' };
    if (retired.has(state.checkpointId) || !state.installed.some((item) => item.versionId === state.checkpointId)) {
      state = {
        ...state,
        checkpointId: DEFAULT_CHECKPOINT.versionId,
        ...(state.qualityEdited ? {} : { quality: fresh.quality, negative: fresh.negative, sampler: fresh.sampler, steps: fresh.steps, cfg: fresh.cfg, width: fresh.width, height: fresh.height, clipSkip: fresh.clipSkip }),
      };
    }
    emit();
  } catch {
    state = initialGenerator();
  }
}

export function hydrateGenerator() {
  void hydrateFromDisk();
}

export function useGenerator(): GeneratorState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      hydrateGenerator();
      return () => listeners.delete(listener);
    },
    getGenerator,
    getGenerator,
  );
}
