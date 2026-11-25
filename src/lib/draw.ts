import { extractLoras, formatParameters, plainPrompt, type GenerationParams } from '@/src/lib/a1111';
import { bytesToBase64, base64ToBytes } from '@/src/lib/base64';
import { scaleLoraStack, studioSuffix } from '@/src/lib/animeStudio';
import { DEFAULT_CHECKPOINT } from '@/src/lib/defaultModel';
import type { GeneratorState } from '@/src/lib/genstore';
import { embedParameters } from '@/src/lib/pngmeta';
import { renderDemoFrames } from '@/src/lib/render';
import { classifyGatewayInput, generateUrl, saladErrorMessage } from '@/src/lib/salad';
import { expandSeeds } from '@/src/lib/seeds';
import { normalizeSaladKey } from '@/src/lib/saladCloud';
import { characterOutfitTags, isClothesTag } from '@/src/lib/positiveTags';
import { characterClause } from '@/src/lib/prompt';
import { applyTaste, currentTaste, tagsOf } from '@/src/lib/taste';
import type { Character, SamplerId } from '@/src/lib/types';

export function embeddingTokens(state: GeneratorState): string[] {
  return state.embeddings.split(',').map((item) => item.trim()).filter(Boolean);
}

export function namedLoras(state: GeneratorState, prompt: string): { name: string; weight: number; versionId?: number; baseModel?: string; triggers?: string[] }[] {
  const extracted = extractLoras(prompt);
  const combined = [...state.loras, ...extracted.loras.filter((tag) => !state.loras.some((item) => item.name === tag.name))];
  return combined
    .map((lora) => {
      const versionId = 'versionId' in lora && typeof lora.versionId === 'number' ? lora.versionId : undefined;
      const baseModel = 'baseModel' in lora && typeof lora.baseModel === 'string' ? lora.baseModel : undefined;
      const triggers = 'triggers' in lora && Array.isArray(lora.triggers) ? lora.triggers.filter((item) => typeof item === 'string') : undefined;
      return {
        name: lora.name.trim(),
        weight: Number(lora.weight) || 0,
        ...(versionId ? { versionId } : {}),
        ...(baseModel ? { baseModel } : {}),
        ...(triggers?.length ? { triggers } : {}),
      };
    })
    .filter((lora) => lora.name || lora.versionId);
}

export function positiveText(state: { positive?: string }): string {
  return (state.positive || '').trim();
}

const LORA_STYLE_BLOCKLIST = new Set([
  'monochrome',
  'greyscale',
  'grayscale',
  'sketch',
  'lineart',
  'line art',
  'manga',
  'comic',
  '1koma',
  '4koma',
  'speech bubble',
  'partially colored',
  'spot color',
]);

export function splitPromptTags(text: string): string[] {
  return (text || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function triggerGroups(triggers: string[] | undefined): string[][] {
  return (triggers ?? []).map((group) => splitPromptTags(group)).filter((group) => group.length > 0);
}

/** Prefer a trained-word group that does not force an outfit. Otherwise keep the name and drop the clothes. */
export function pickCleanTriggerGroup(groups: string[][]): string[] {
  const scored = groups.map((group) => {
    const clean = group.filter((tag) => !isClothesTag(tag));
    return { clean, clothes: group.length - clean.length };
  });
  const free = scored.filter((item) => item.clothes === 0 && item.clean.length > 0);
  const pool = free.length ? free : scored.filter((item) => item.clean.length > 0);
  if (!pool.length) return [];
  pool.sort((left, right) => left.clean.length - right.clean.length || left.clothes - right.clothes);
  return pool[0]!.clean;
}

export function defaultOutfitTags(character: Character | null | undefined, loras: { triggers?: string[] }[]): string[] {
  const tags = [...characterOutfitTags(character)];
  const seen = new Set(tags.map((tag) => tag.toLowerCase()));
  for (const lora of loras) {
    for (const group of triggerGroups(lora.triggers)) {
      for (const tag of group) {
        const key = normTag(tag);
        if (!key || !isClothesTag(tag) || seen.has(key)) continue;
        seen.add(key);
        tags.push(tag.trim());
      }
    }
  }
  return tags;
}

export function outfitNegative(base: string, defaults: string[], clothes: string): string {
  const used = new Set(splitPromptTags(clothes).map(normTag));
  const existing = new Set(
    splitPromptTags(base).map((tag) => normTag(tag.replace(/^\(+/, '').replace(/\)+$/, '').split(':')[0] || '')),
  );
  const adds: string[] = [];
  for (const tag of defaults) {
    const key = normTag(tag);
    if (!key || used.has(key) || existing.has(key)) continue;
    existing.add(key);
    adds.push(`(${tag}:0.4)`);
  }
  return [base.trim(), ...adds].filter(Boolean).join(', ');
}

export function sentNegative(state: GeneratorState, character: Character | null = null): string {
  return outfitNegative(state.negative, defaultOutfitTags(character, state.loras), state.clothes || '');
}

export function loraTriggerTags(
  lora: { triggers?: string[]; triggerGroup?: number },
  match: { triggers?: string[] } | undefined,
  reserved: Set<string>,
  typed: Set<string>,
): string[] {
  const own = triggerGroups(lora.triggers);
  const groups = own.length ? own : triggerGroups(match?.triggers);
  const selected = groups[lora.triggerGroup ?? 0] ?? groups[0] ?? [];
  const group = selected.some((tag) => isClothesTag(tag)) ? pickCleanTriggerGroup(groups) : selected.filter((tag) => !isClothesTag(tag));
  const tags: string[] = [];
  for (const tag of group) {
    const key = normTag(tag);
    if (!key || reserved.has(key)) continue;
    if (LORA_STYLE_BLOCKLIST.has(key) && !typed.has(key)) continue;
    reserved.add(key);
    tags.push(tag);
  }
  return tags;
}

export function composeGenerationPrompt(state: GeneratorState, characterText = ''): string {
  const checkpoint = state.installed.find((item) => item.versionId === state.checkpointId);
  const style = state.studioStyle && state.studioStyle !== 'off' ? studioSuffix(state.studioStyle) : '';
  const typed = new Set(
    [state.prompt, state.clothes || '', positiveText(state), state.extraPrompt || ''].flatMap((part) => splitPromptTags(part).map(normTag)),
  );
  const reserved = new Set<string>([
    ...typed,
    ...splitPromptTags(style).map(normTag),
    ...splitPromptTags(state.quality || '').map(normTag),
  ]);
  const loraTriggers = state.triggers
    ? state.loras
        .flatMap((lora) => {
          const match = state.installed.find(
            (item) => (lora.versionId && item.versionId === lora.versionId) || item.filename === lora.name || item.name === lora.name,
          );
          return loraTriggerTags(lora, match, reserved, typed);
        })
        .join(', ')
    : '';
  const afterStyle = [
    state.triggers ? (checkpoint?.triggers ?? []).join(', ') : '',
    characterText.trim(),
    embeddingTokens(state).join(', '),
  ];
  const head = [state.prompt.trim(), loraTriggers, (state.clothes || '').trim(), positiveText(state), (state.extraPrompt || '').trim(), style, ...afterStyle]
    .filter(Boolean)
    .join(', ');
  const quality = (state.quality || '').trim();
  return [head, quality].filter(Boolean).join(', ');
}

export function generationParams(state: GeneratorState, prompt: string, seed: number, character: Character | null = null): GenerationParams {
  const checkpoint = state.installed.find((item) => item.versionId === state.checkpointId);
  const loras = namedLoras(state, prompt);
  return {
    prompt,
    negative: sentNegative(state, character),
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
  loras: { name: string; weight: number; versionId?: number; baseModel?: string; triggers?: string[] }[];
  embeddings: string[];
  vae: string | null;
  hires_scale: number | null;
  hires_denoise: number;
  hires_upscaler: string;
  hires_steps: number;
  mode: GeneratorState['mode'];
  strength: number;
  pose: boolean;
  pose_strength: number;
  pose_fit: boolean;
  pose_body: 'petite' | 'average' | 'tall';
  pose_height_cm: number | null;
  pose_bust_cm: number | null;
  pose_hip_cm: number | null;
  copy_picture: boolean;
  style: boolean;
  style_strength: number;
  reference_image: string | null;
  mask: string | null;
  prediction_type: 'epsilon' | 'v_prediction';
};

export function sentWithTaste(state: GeneratorState, prompt: string, character: Character | null = null): { prompt: string; negative: string } {
  const blocked = [state.prompt, state.clothes || '', state.positive || '', state.extraPrompt || '', state.quality || '', character ? characterClause(character) : ''].flatMap((part) => tagsOf(part));
  return applyTaste({
    enabled: state.useTaste !== false,
    prompt,
    negative: sentNegative(state, character),
    blocked,
    store: currentTaste(),
  });
}

export function buildSaladGenerateBody(
  state: GeneratorState,
  prompt: string,
  seed: number,
  initPng?: Uint8Array | null,
  maskPng?: Uint8Array | null,
  character: Character | null = null,
): SaladGenerateBody {
  const tasted = sentWithTaste(state, prompt, character);
  const params = generationParams(state, tasted.prompt, seed, character);
  return {
    prompt: tasted.prompt,
    negative_prompt: tasted.negative,
    width: state.width,
    height: state.height,
    count: state.count,
    seed,
    steps: state.steps,
    cfg: state.cfg,
    scheduler: state.sampler,
    model: String(state.installed.find((item) => item.versionId === state.checkpointId)?.versionId ?? DEFAULT_CHECKPOINT.versionId),
    model_name: params.model,
    model_hash: params.modelHash,
    clip_skip: state.clipSkip,
    loras: scaleLoraStack(namedLoras(state, prompt)).map((lora) => ({
      name: lora.name,
      weight: lora.weight,
      ...(lora.versionId ? { versionId: lora.versionId } : {}),
      ...(lora.baseModel ? { baseModel: lora.baseModel } : {}),
      ...(lora.triggers?.length ? { triggers: lora.triggers } : {}),
    })),
    embeddings: embeddingTokens(state),
    vae: state.vae || null,
    hires_scale: state.hires ? state.hiresScale : null,
    hires_denoise: state.hiresDenoise,
    hires_upscaler: state.hiresUpscaler,
    hires_steps: state.hiresSteps,
    mode: state.referenceCopy ? 'img2img' : state.mode,
    strength: state.referenceDenoise ?? 0.6,
    pose: Boolean(state.referencePose) && Boolean(initPng),
    pose_strength: state.referencePoseStrength ?? 0.85,
    pose_fit: state.referenceFit !== false,
    pose_body: state.referenceBody || 'average',
    pose_height_cm: character?.measurements?.heightCm ?? null,
    pose_bust_cm: character?.measurements?.bustCm ?? null,
    pose_hip_cm: character?.measurements?.hipCm ?? null,
    copy_picture: Boolean(state.referenceCopy) && Boolean(initPng),
    style: Boolean(state.referenceStyle) && Boolean(initPng),
    style_strength: state.referenceStyleStrength ?? 0.55,
    reference_image: initPng ? bytesToBase64(initPng) : null,
    mask: maskPng ? bytesToBase64(maskPng) : null,
    prediction_type: state.vPrediction ? 'v_prediction' : 'epsilon',
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
}): Promise<{ pngs: Uint8Array[]; parameters: string; seeds: number[]; warning?: string }> {
  const seeds = input.seed < 0 ? expandSeeds(Math.floor(Math.random() * 2_147_483_647), input.state.count) : expandSeeds(input.seed, input.state.count);
  const tasted = sentWithTaste(input.state, input.prompt, input.character);
  const params = generationParams(input.state, tasted.prompt, seeds[0] ?? 0, input.character);
  params.negative = tasted.negative;
  params.prompt = tasted.prompt;
  const parameters = formatParameters(params);
  if (input.provider !== 'salad') {
    const pngs = renderDemoFrames({
      prompt: plainPrompt(input.prompt),
      styleId: 'watercolor',
      aspectId: input.state.height >= input.state.width ? 'wallpaper' : 'landscape',
      character: input.character,
      count: input.state.count,
      seed: seeds[0] ?? 0,
    }).map((png, index) => embedParameters(png, formatParameters({ ...params, seed: seeds[index] ?? seeds[0] ?? 0 })));
    return {
      pngs,
      parameters,
      seeds,
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
      body: JSON.stringify(buildSaladGenerateBody(input.state, tasted.prompt, input.seed, input.initPng, input.maskPng, input.character)),
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
  const body = JSON.parse(raw) as { images?: string[]; seeds?: number[] };
  if (!body.images?.length) throw new Error('Salad returned no images.');
  const returned = Array.isArray(body.seeds) ? body.seeds.filter((seed) => typeof seed === 'number' && seed >= 0) : [];
  return { pngs: body.images.map((item) => base64ToBytes(item)), parameters, seeds: returned.length ? returned : seeds };
}
