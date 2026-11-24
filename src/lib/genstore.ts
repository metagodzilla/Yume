import { useSyncExternalStore } from 'react';

import type { ContentFilter } from '@/src/lib/civitai';
import { familyPreset } from '@/src/lib/checkpoints';
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
  prompt: string;
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
  loras: { name: string; weight: number; modelId?: number; versionId?: number }[];
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

export const initialGenerator = (): GeneratorState => ({
  prompt: '',
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
  embeddings: '',
  vae: '',
  hires: false,
  hiresScale: 1.5,
  hiresDenoise: 0.45,
  hiresUpscaler: 'Latent',
  hiresSteps: 15,
  mode: 'txt2img',
  denoise: 0.55,
  nsfw: false,
  contentFilter: 'sfw',
  installed: [defaultResource()],
  vPrediction: false,
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

export function applyCheckpoint(resource: InstalledResource) {
  const preset = familyPreset(resource.baseModel, resource.name);
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
    qualityTags: true,
    vPrediction: preset.vPrediction,
  });
}

export function resetModelDefaults(baseModel: string, name = '') {
  const preset = familyPreset(baseModel, name);
  patchGenerator({
    sampler: preset.sampler,
    steps: preset.steps,
    cfg: preset.cfg,
    clipSkip: preset.clipSkip,
    width: preset.width,
    height: preset.height,
    negative: preset.negative,
    qualityTags: true,
    vPrediction: preset.vPrediction,
  });
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
  if (versionId === DEFAULT_CHECKPOINT.versionId) return;
  const installed = state.installed.filter((item) => item.versionId !== versionId);
  const fallback = installed.find((item) => item.isDefault && item.type === 'Checkpoint') ?? installed.find((item) => item.type === 'Checkpoint');
  patchGenerator({ installed, checkpointId: fallback?.versionId ?? DEFAULT_CHECKPOINT.versionId });
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
    if (!installed.some((item) => item.versionId === DEFAULT_CHECKPOINT.versionId)) installed.unshift(defaultResource());
    const contentFilter: ContentFilter =
      parsed.contentFilter === 'all' || parsed.contentFilter === 'sfw' || parsed.contentFilter === 'nsfw'
        ? parsed.contentFilter
        : parsed.nsfw
          ? 'all'
          : 'sfw';
    state = { ...initialGenerator(), ...parsed, installed, contentFilter, nsfw: contentFilter !== 'sfw' };
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
