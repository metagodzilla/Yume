import { useSyncExternalStore } from 'react';

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
  loras: { name: string; weight: number }[];
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
  installed: [defaultResource()],
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
  state = { ...state, ...patch };
  emit();
  void persist();
}

export function installLocal(resource: InstalledResource) {
  const others = state.installed.filter((item) => item.versionId !== resource.versionId);
  const installed = [...others, resource];
  patchGenerator({ installed, checkpointId: resource.type === 'Checkpoint' ? resource.versionId : state.checkpointId });
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
    state = { ...initialGenerator(), ...parsed, installed, nsfw: parsed.nsfw === true };
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
