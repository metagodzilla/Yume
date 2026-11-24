/** Animagine XL 4.0 v4.0 on Civitai. Weights download on the server; this is the record. */
export const DEFAULT_CHECKPOINT = {
  modelId: 1188071,
  versionId: 1337429,
  name: 'Animagine XL 4.0',
  version: 'v4.0',
  type: 'Checkpoint' as const,
  baseModel: 'SDXL 1.0',
  filename: 'animagine-xl-4.0.safetensors',
  hash: '1d5b43ff75',
  sha256: '1D5B43FF75B6AB598502D4C779D2FBFA3DCECA51C60C3B609640A60772333916',
  downloadUrl: 'https://civitai.com/api/download/models/1337429',
  sampler: 'Euler a',
  steps: 25,
  cfg: 6,
  clipSkip: 2,
  width: 832,
  height: 1216,
  quality: 'masterpiece, high score, great score, absurdres',
  negative:
    'lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry',
};

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
