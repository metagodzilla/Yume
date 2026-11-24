import { extractLoras, formatParameters, plainPrompt, type GenerationParams } from '@/src/lib/a1111';
import { bytesToBase64, base64ToBytes } from '@/src/lib/base64';
import { DEFAULT_CHECKPOINT } from '@/src/lib/defaultModel';
import type { GeneratorState } from '@/src/lib/genstore';
import { embedParameters } from '@/src/lib/pngmeta';
import { renderDemoFrames } from '@/src/lib/render';
import { saladErrorMessage, normalizeEndpoint } from '@/src/lib/salad';
import type { Character, SamplerId } from '@/src/lib/types';

export function composeGenerationPrompt(state: GeneratorState, characterText = ''): string {
  const checkpoint = state.installed.find((item) => item.versionId === state.checkpointId);
  const bits = [
    state.qualityTags ? DEFAULT_CHECKPOINT.quality : '',
    state.triggers ? (checkpoint?.triggers ?? []).join(', ') : '',
    characterText.trim(),
    state.embeddings.trim(),
    state.prompt.trim(),
  ];
  return bits.filter(Boolean).join(', ');
}

export function generationParams(state: GeneratorState, prompt: string, seed: number): GenerationParams {
  const checkpoint = state.installed.find((item) => item.versionId === state.checkpointId);
  const extracted = extractLoras(prompt);
  const loras = [...state.loras, ...extracted.loras.filter((tag) => !state.loras.some((item) => item.name === tag.name))];
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
  const endpoint = normalizeEndpoint(input.endpoint);
  if (!endpoint) throw new Error('Add the Salad endpoint in Settings. The container downloads and runs the checkpoint.');
  if (!input.apiKey?.trim()) throw new Error('Add the Salad API key in Settings.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 170_000);
  let response: Response;
  try {
    response = await fetch(`${endpoint}/generate`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey.trim()}`,
        'X-Api-Key': input.apiKey.trim(),
        'Salad-Api-Key': input.apiKey.trim(),
      },
      body: JSON.stringify({
        prompt: input.prompt,
        negative_prompt: input.state.negative,
        width: input.state.width,
        height: input.state.height,
        count: input.state.count,
        seed: input.seed,
        steps: input.state.steps,
        cfg: input.state.cfg,
        scheduler: input.state.sampler,
        model: params.model,
        model_name: params.model,
        model_hash: params.modelHash,
        clip_skip: input.state.clipSkip,
        loras: params.loras,
        embeddings: input.state.embeddings.split(',').map((item) => item.trim()).filter(Boolean),
        vae: input.state.vae || null,
        hires_scale: input.state.hires ? input.state.hiresScale : null,
        hires_denoise: input.state.hiresDenoise,
        hires_upscaler: input.state.hiresUpscaler,
        hires_steps: input.state.hiresSteps,
        mode: input.state.mode,
        strength: input.state.denoise,
        reference_image: input.initPng ? bytesToBase64(input.initPng) : null,
        mask: input.maskPng ? bytesToBase64(input.maskPng) : null,
      }),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new Error(saladErrorMessage({ aborted }));
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  if (!response.ok) throw new Error(saladErrorMessage({ aborted: false, status: response.status, body: raw }));
  const body = JSON.parse(raw) as { images?: string[] };
  if (!body.images?.length) throw new Error('Salad returned no images.');
  return { pngs: body.images.map((item) => base64ToBytes(item)), parameters };
}
