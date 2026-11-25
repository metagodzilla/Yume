/** WAI-illustrious-SDXL. The phone and a fresh cloud node start here. */
export const DEFAULT_CHECKPOINT = {
  modelId: 827184,
  versionId: 2883731,
  name: 'WAI-illustrious-SDXL',
  version: 'v17.0',
  type: 'Checkpoint' as const,
  baseModel: 'Illustrious',
  filename: 'WAI-Nsfw-Illustrious-17.safetensors',
  hash: '',
  sha256: '',
  downloadUrl: 'https://civitai.com/api/download/models/2883731',
  sampler: 'Euler a',
  steps: 28,
  cfg: 5,
  clipSkip: 2,
  width: 832,
  height: 1216,
  quality: 'masterpiece, best quality, very aesthetic, absurdres',
  negative:
    'lowres, worst quality, bad quality, bad anatomy, bad hands, signature, watermark, username, blurry',
};

export const RETIRED_CHECKPOINTS = [1337429, 1408658] as const;

export const BASE_MODELS = ['SD 1.5', 'SDXL 1.0', 'Pony', 'Illustrious', 'NoobAI', 'Flux.1 D', 'Flux.1 S'] as const;

export const MODEL_TYPES = [
  { id: 'Checkpoint', label: 'Checkpoint' },
  { id: 'LORA', label: 'LoRA' },
  { id: 'LoCon', label: 'LyCORIS' },
  { id: 'TextualInversion', label: 'Embedding' },
  { id: 'VAE', label: 'VAE' },
] as const;

export const SORTS = ['Most Downloaded', 'Highest Rated', 'Newest'] as const;

export const SAMPLERS = [
  'Euler a',
  'Euler',
  'DPM++ 2M',
  'DPM++ 2M Karras',
  'DPM++ SDE Karras',
  'DDIM',
  'LMS',
  'Heun',
  'UniPC',
  'LCM',
] as const;

export const SIZE_PRESETS: Record<string, { width: number; height: number; label: string }[]> = {
  'SD 1.5': [
    { width: 512, height: 512, label: '512 square' },
    { width: 512, height: 768, label: '512×768' },
    { width: 768, height: 512, label: '768×512' },
  ],
  'SDXL 1.0': [
    { width: 832, height: 1216, label: '832×1216' },
    { width: 1024, height: 1024, label: '1024 square' },
    { width: 1216, height: 832, label: '1216×832' },
  ],
  Pony: [
    { width: 832, height: 1216, label: '832×1216' },
    { width: 1024, height: 1024, label: '1024 square' },
    { width: 1216, height: 832, label: '1216×832' },
  ],
  Illustrious: [
    { width: 832, height: 1216, label: '832×1216' },
    { width: 1024, height: 1024, label: '1024 square' },
    { width: 1024, height: 1344, label: '1024×1344' },
    { width: 1216, height: 832, label: '1216×832' },
  ],
  NoobAI: [
    { width: 832, height: 1216, label: '832×1216' },
    { width: 1024, height: 1024, label: '1024 square' },
    { width: 1216, height: 832, label: '1216×832' },
  ],
  'Flux.1 D': [
    { width: 1024, height: 1024, label: '1024 square' },
    { width: 768, height: 1344, label: '768×1344' },
    { width: 1344, height: 768, label: '1344×768' },
  ],
  'Flux.1 S': [
    { width: 1024, height: 1024, label: '1024 square' },
    { width: 768, height: 1344, label: '768×1344' },
    { width: 1344, height: 768, label: '1344×768' },
  ],
};

export function sizesFor(baseModel: string) {
  return SIZE_PRESETS[baseModel] ?? SIZE_PRESETS['SDXL 1.0'];
}
