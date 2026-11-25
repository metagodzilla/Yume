export const ANIME_STUDIO_VERSION = 1408658;
export const STUDIO_APPLIED = '1.5.2';

export const STUDIO_STYLES = [
  { id: 'anime', label: 'Anime color', suffix: 'anime style, vibrant colors, clean line art, detailed eyes, cel shading' },
  { id: 'chibi', label: 'Chibi', suffix: 'chibi, super deformed, cute, big head, small body' },
  { id: 'shonen', label: 'Shonen action', suffix: 'shonen, dynamic action, speed lines, dramatic lighting' },
  { id: 'shojo', label: 'Shojo soft', suffix: 'shojo, soft lighting, sparkles, gentle, pastel' },
  { id: 'webtoon', label: 'Webtoon', suffix: 'webtoon, clean panel style, bold outlines, flat colors' },
] as const;

export type StudioStyleId = (typeof STUDIO_STYLES)[number]['id'] | 'off';

export const STUDIO_QUALITY = 'masterpiece, best quality, very aesthetic, absurdres';
export const STUDIO_NEGATIVE =
  'blurry, low quality, extra fingers, photorealistic, 3d render, watermark, text, lowres, bad anatomy, bad hands, worst quality, jpeg artifacts, signature';

export const STUDIO_SIZES = [
  { width: 896, height: 1152, label: '3:4' },
  { width: 1024, height: 1024, label: '1:1' },
  { width: 1152, height: 896, label: '4:3' },
] as const;

export const ANIME_STUDIO_CHECKPOINT = {
  modelId: 1188071,
  versionId: ANIME_STUDIO_VERSION,
  name: 'Animagine XL 4.0 Opt',
  version: 'opt',
  type: 'Checkpoint' as const,
  baseModel: 'SDXL 1.0',
  filename: 'animagine-xl-4.0-opt.safetensors',
  hash: '',
  sha256: '',
  triggers: [] as string[],
  isDefault: true,
  sampler: 'Euler a',
  steps: 26,
  cfg: 6,
  clipSkip: 2,
  width: 896,
  height: 1152,
  quality: STUDIO_QUALITY,
  negative: STUDIO_NEGATIVE,
};

export function studioSuffix(id: string | undefined): string {
  return STUDIO_STYLES.find((item) => item.id === id)?.suffix ?? '';
}

export function scaleLoraStack<T extends { weight: number }>(loras: T[]): T[] {
  const high = loras.filter((item) => item.weight >= 0.8);
  if (high.length < 3) return loras;
  return loras.map((item) => (item.weight >= 0.8 ? { ...item, weight: Math.round(item.weight * 0.75 * 100) / 100 } : item));
}
