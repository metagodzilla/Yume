import { extractLoras, formatParameters, plainPrompt, type GenerationParams } from '@/src/lib/a1111';
import { bytesToBase64, base64ToBytes } from '@/src/lib/base64';
import { DEFAULT_CHECKPOINT } from '@/src/lib/defaultModel';
import type { GeneratorState } from '@/src/lib/genstore';
import { embedParameters } from '@/src/lib/pngmeta';
import { renderDemoFrames } from '@/src/lib/render';
import { classifyGatewayInput, generateUrl, saladErrorMessage } from '@/src/lib/salad';
import { normalizeSaladKey } from '@/src/lib/saladCloud';
import type { Character, SamplerId } from '@/src/lib/types';

export function embeddingTokens(state: GeneratorState): string[] {
  return state.embeddings.split(',').map((item) => item.trim()).filter(Boolean);
}

export function namedLoras(state: GeneratorState, prompt: string): { name: string; weight: number }[] {
  const extracted = extractLoras(prompt);
  const combined = [...state.loras, ...extracted.loras.filter((tag) => !state.loras.some((item) => item.name === tag.name))];
  return combined
    .map((lora) => ({ name: lora.name.trim(), weight: Number(lora.weight) || 0 }))
    .filter((lora) => lora.name);
}

export function composeGenerationPrompt(state: GeneratorState, characterText = ''): string {
  const checkpoint = state.installed.find((item) => item.versionId === state.checkpointId);
  const loraTriggers = state.triggers
    ? state.loras
        .flatMap((lora) => {
          const match = state.installed.find(
            (item) => (lora.versionId && item.versionId === lora.versionId) || item.filename === lora.name || item.name === lora.name,
          );
          return match?.triggers ?? [];
        })
        .filter(Boolean)
        .join(', ')
    : '';
  const bits = [
    state.qualityTags ? DEFAULT_CHECKPOINT.quality : '',
    state.triggers ? (checkpoint?.triggers ?? []).join(', ') : '',
    loraTriggers,
    characterText.trim(),
    embeddingTokens(state).join(', '),
    state.prompt.trim(),
  ];
  return bits.filter(Boolean).join(', ');
}

export function generationParams(state: GeneratorState, prompt: string, seed: number): GenerationParams {
  const checkpoint = state.installed.find((item) => item.versionId === state.checkpointId);
  const loras = namedLoras(state, prompt);
  return {
    prompt,
    negative: state.negative,
    steps: state.steps,
    sampler: state.sampler,
    cfg: state.cfg,
    seed,
    width: state.width,
    height: state.height,
    model: checkpoint?.name ?? DEFAULT_CHECKPOINT.name,
    modelHash: checkpoint?.hash ?? DEFAULT_CHECKPOINT.hash,
    clipSkip: state.clipSkip,
    loras,
    hires: state.hires
      ? { scale: state.hiresScale, denoise: state.hiresDenoise, upscaler: state.hiresUpscaler, steps: state.hiresSteps }
      : null,
  };
}

const SAMPLER_ID: Record<string, SamplerId> = {
  'Euler a': 'euler_a',
  Euler: 'euler',
  'DPM++ 2M': 'dpm_2m',
  'DPM++ 2M Karras': 'dpm_2m_karras',
  'DPM++ SDE Karras': 'dpm_2m_karras',
  DDIM: 'ddim',
  LCM: 'lcm',
  LMS: 'euler',
  Heun: 'euler',
  UniPC: 'dpm_2m',
};

export type SaladGenerateBody = {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  count: number;
  seed: number;
  steps: number;
  cfg: number;
  scheduler: string;
  model: string;
  model_name: string;
  model_hash: string;
  clip_skip: number;
  loras: { name: string; weight: number }[];
  embeddings: string[];
  vae: string | null;
  hires_scale: number | null;
  hires_denoise: number;
  hires_upscaler: string;
  hires_steps: number;
  mode: GeneratorState['mode'];
  strength: number;
  reference_image: string | null;
  mask: string | null;
};

export function buildSaladGenerateBody(
  state: GeneratorState,
  prompt: string,
  seed: number,
  initPng?: Uint8Array | null,
  maskPng?: Uint8Array | null,
): SaladGenerateBody {
  const params = generationParams(state, prompt, seed);
  return {
    prompt,
    negative_prompt: state.negative,
    width: state.width,
    height: state.height,
    count: state.count,
    seed,
    steps: state.steps,
    cfg: state.cfg,
    scheduler: state.sampler,
    model: params.model,
    model_name: params.model,
    model_hash: params.modelHash,
    clip_skip: state.clipSkip,
    loras: namedLoras(state, prompt).map((lora) => ({ name: lora.name, weight: lora.weight })),
    embeddings: embeddingTokens(state),
    vae: state.vae || null,
    hires_scale: state.hires ? state.hiresScale : null,
    hires_denoise: state.hiresDenoise,
    hires_upscaler: state.hiresUpscaler,
    hires_steps: state.hiresSteps,
    mode: state.mode,
    strength: state.denoise,
    reference_image: initPng ? bytesToBase64(initPng) : null,
    mask: maskPng ? bytesToBase64(maskPng) : null,
  };
}

export function sentPositiveText(state: GeneratorState, characterText = ''): string {
  const prompt = composeGenerationPrompt(state, characterText);
  const body = buildSaladGenerateBody(state, prompt, 0);
  const tags = body.loras.map((lora) => `<lora:${lora.name}:${lora.weight}>`).filter((tag) => !body.prompt.includes(tag));
  return [body.prompt, ...tags].filter(Boolean).join(', ');
}

export function samplerId(name: string): SamplerId {
  return SAMPLER_ID[name] ?? 'euler_a';
}

export async function drawFrames(input: {
  state: GeneratorState;
  prompt: string;
  seed: number;
  provider: 'demo' | 'openai' | 'salad';
  endpoint: string;
  apiKey: string | null;
  character: Character | null;
  initPng?: Uint8Array | null;
  maskPng?: Uint8Array | null;
}): Promise<{ pngs: Uint8Array[]; parameters: string; warning?: string }> {
  const params = generationParams(input.state, input.prompt, input.seed);
  const parameters = formatParameters(params);
  if (input.provider !== 'salad') {
    const pngs = renderDemoFrames({
      prompt: plainPrompt(input.prompt),
      styleId: 'watercolor',
      aspectId: input.state.height >= input.state.width ? 'wallpaper' : 'landscape',
      character: input.character,
      count: input.state.count,
      seed: input.seed,
    }).map((png, index) => embedParameters(png, formatParameters({ ...params, seed: input.seed + index })));
    return {
      pngs,
      parameters,
      warning:
        input.provider === 'openai'
          ? 'OpenAI ignores checkpoints, LoRAs, and sampler names. Demo painted this frame and still wrote the Civitai metadata.'
          : input.state.mode !== 'txt2img'
            ? 'Demo studio records img2img and inpaint settings in the metadata. It does not edit the source pixels.'
            : undefined,
    };
  }
  const classified = classifyGatewayInput(input.endpoint);
  if (classified.kind === 'key') throw new Error('That saved address is a Salad API key, not a gateway URL. Open Connect and move it to Key.');
  if (classified.kind !== 'url') throw new Error('Add a gateway URL that starts with https://. Connect can fill in the live server.');
  const endpoint = classified.url;
  const target = generateUrl(endpoint);
  const apiKey = normalizeSaladKey(input.apiKey);
  if (!apiKey) throw new Error('Add the Salad API key in Settings.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  let response: Response;
  try {
    response = await fetch(target, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Api-Key': apiKey,
        'Salad-Api-Key': apiKey,
      },
      body: JSON.stringify(buildSaladGenerateBody(input.state, input.prompt, input.seed, input.initPng, input.maskPng)),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    const message = error instanceof Error ? error.message : '';
    throw new Error(saladErrorMessage({ aborted, body: aborted ? '' : message, url: target }));
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  if (!response.ok) throw new Error(saladErrorMessage({ aborted: false, status: response.status, body: raw, url: target }));
  const body = JSON.parse(raw) as { images?: string[] };
  if (!body.images?.length) throw new Error('Salad returned no images.');
  return { pngs: body.images.map((item) => base64ToBytes(item)), parameters };
}
