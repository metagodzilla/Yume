import { DEFAULT_CHECKPOINT, SAMPLERS } from '@/src/lib/defaultModel';

export type LoraTag = { name: string; weight: number };

export type GenerationParams = {
  prompt: string;
  negative: string;
  steps: number;
  sampler: string;
  cfg: number;
  seed: number;
  width: number;
  height: number;
  model: string;
  modelHash: string;
  clipSkip: number;
  loras: LoraTag[];
  hires?: { scale: number; denoise: number; upscaler: string; steps: number } | null;
};

const LORA = /<lora:([^:>]+):([0-9]*\.?[0-9]+)>/gi;

export function extractLoras(prompt: string): { prompt: string; loras: LoraTag[] } {
  const loras: LoraTag[] = [];
  const next = prompt.replace(LORA, (_, name: string, weight: string) => {
    const parsed = Number(weight);
    loras.push({ name: name.trim(), weight: Number.isFinite(parsed) ? parsed : 1 });
    return '';
  });
  return { prompt: next.replace(/[ \t]{2,}/g, ' ').replace(/\s+,/g, ',').trim(), loras };
}

/** Turns emphasis syntax into plain words for a backend that does not weight tokens. */
export function plainPrompt(prompt: string): string {
  let text = prompt.replace(LORA, '');
  text = text.replace(/\(([^():]+):([0-9]*\.?[0-9]+)\)/g, '$1');
  text = text.replace(/[\[\]()]/g, '');
  return text.replace(/[ \t]{2,}/g, ' ').trim();
}

export function formatParameters(input: GenerationParams): string {
  const parts = [
    `Steps: ${input.steps}`,
    `Sampler: ${input.sampler}`,
    `CFG scale: ${trimNumber(input.cfg)}`,
    `Seed: ${input.seed}`,
    `Size: ${input.width}x${input.height}`,
    `Model: ${input.model}`,
    `Model hash: ${input.modelHash}`,
    `Clip skip: ${input.clipSkip}`,
  ];
  if (input.loras.length) {
    const hashes = input.loras.map((lora) => `${lora.name}: ${lora.weight}`).join(', ');
    parts.push(`Lora hashes: "${hashes}"`);
  }
  if (input.hires) {
    parts.push(`Hires upscale: ${trimNumber(input.hires.scale)}`);
    parts.push(`Hires upscaler: ${input.hires.upscaler}`);
    parts.push(`Hires steps: ${input.hires.steps}`);
    parts.push(`Denoising strength: ${trimNumber(input.hires.denoise)}`);
  }
  const negative = input.negative.trim();
  const head = input.prompt.trim();
  return `${head}\nNegative prompt: ${negative}\n${parts.join(', ')}`;
}

export function parseParameters(raw: string): Partial<GenerationParams> & { missing?: string[] } {
  const text = raw.replace(/\r/g, '').trim();
  const negativeAt = text.search(/\nNegative prompt:/i);
  const settingsAt = text.search(/\nSteps:/i);
  const promptEnd = negativeAt >= 0 ? negativeAt : settingsAt >= 0 ? settingsAt : text.length;
  const prompt = text.slice(0, promptEnd).trim();
  let negative = '';
  if (negativeAt >= 0) {
    const after = text.slice(negativeAt + '\nNegative prompt:'.length);
    const end = after.search(/\nSteps:/i);
    negative = (end >= 0 ? after.slice(0, end) : after).trim();
  }
  const settings = settingsAt >= 0 ? text.slice(settingsAt) : '';
  const sampler = readString(settings, 'Sampler') || DEFAULT_CHECKPOINT.sampler;
  const size = readString(settings, 'Size');
  const [width, height] = (size || `${DEFAULT_CHECKPOINT.width}x${DEFAULT_CHECKPOINT.height}`).split('x').map((item) => Number(item));
  const loraBlob = readString(settings, 'Lora hashes').replace(/^"|"$/g, '');
  const loras = loraBlob
    ? loraBlob.split(',').map((part) => {
        const [name, weight] = part.split(':');
        return { name: (name || '').trim(), weight: Number(weight) || 1 };
      }).filter((lora) => lora.name)
    : extractLoras(prompt).loras;
  const hiresScale = readNumber(settings, 'Hires upscale');
  return {
    prompt,
    negative,
    steps: readNumber(settings, 'Steps') || DEFAULT_CHECKPOINT.steps,
    sampler: (SAMPLERS as readonly string[]).includes(sampler) ? sampler : sampler || DEFAULT_CHECKPOINT.sampler,
    cfg: readNumber(settings, 'CFG scale') || DEFAULT_CHECKPOINT.cfg,
    seed: readNumber(settings, 'Seed') || 0,
    width: width || DEFAULT_CHECKPOINT.width,
    height: height || DEFAULT_CHECKPOINT.height,
    model: readString(settings, 'Model'),
    modelHash: readString(settings, 'Model hash').toLowerCase(),
    clipSkip: readNumber(settings, 'Clip skip') || DEFAULT_CHECKPOINT.clipSkip,
    loras,
    hires: hiresScale
      ? {
          scale: hiresScale,
          denoise: readNumber(settings, 'Denoising strength') || 0.45,
          upscaler: readString(settings, 'Hires upscaler') || 'Latent',
          steps: readNumber(settings, 'Hires steps') || 15,
        }
      : null,
  };
}

export function civitaiImageId(value: string): number | null {
  const text = value.trim();
  const match = text.match(/civitai\.com\/images\/(\d+)/i);
  if (match) return Number(match[1]);
  if (/^\d+$/.test(text) && text.length >= 4) return Number(text);
  return null;
}

function readString(text: string, label: string): string {
  const match = text.match(new RegExp(`${label}:\\s*([^,\\n]+)`, 'i'));
  return match?.[1]?.trim() ?? '';
}

function readNumber(text: string, label: string): number {
  const match = text.match(new RegExp(`${label}:\\s*(-?[0-9]*\\.?[0-9]+)`, 'i'));
  return match ? Number(match[1]) : 0;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
