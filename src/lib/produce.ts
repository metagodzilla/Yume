import { openAISize } from '@/src/lib/compose';
import { cleanLoras } from '@/src/lib/library';
import { editOpenAIImage, generateOpenAI } from '@/src/lib/openai';
import { renderDemoFrames } from '@/src/lib/render';
import { buildSaladBody, generateSalad } from '@/src/lib/salad';
import { styleById } from '@/src/lib/presets';
import type { AspectId, Character, ModelId, ProviderId, SamplerId, StyleId } from '@/src/lib/types';

export function resolveSeeds(mode: 'random' | 'fixed', seed: number, count: number, rng: () => number = Math.random): number[] {
  const base = mode === 'fixed' ? Math.max(0, Math.floor(seed)) : Math.floor(rng() * 2_147_483_647);
  return Array.from({ length: count }, (_, index) => (base + index) % 2_147_483_647);
}

function demoStyle(id: string): StyleId {
  const known = styleById(id);
  return known.id === id ? known.id : 'watercolor';
}

export async function produceImages(input: {
  provider: ProviderId;
  prompt: string;
  negative: string;
  styleId: string;
  aspectId: AspectId;
  character: Character | null;
  count: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: SamplerId;
  seedMode: 'random' | 'fixed';
  seed: number;
  saladModel: string;
  loras: { id: string; name: string; weight: number }[];
  openaiModel: ModelId;
  openaiKey: string | null;
  saladEndpoint: string;
  saladKey: string | null;
  platform: string;
  rng?: () => number;
  variant?: number;
  angle?: 'front' | 'three-quarter' | 'side' | 'three-quarter-back' | 'back' | 'face';
  referencePng?: Uint8Array | null;
}): Promise<{ pngs: Uint8Array[]; seeds: number[]; source: 'demo' | 'openai' | 'salad'; model: string; warning?: string; consistency: string }> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('The prompt that will be sent is empty. Write something, or reset the preview.');
  const count = Math.max(1, Math.min(4, Math.round(input.count)));
  const seeds = resolveSeeds(input.seedMode, input.seed, count, input.rng);
  const loras = cleanLoras(input.loras);

  if (input.provider === 'demo') {
    const pngs = renderDemoFrames({
      prompt,
      styleId: demoStyle(input.styleId),
      aspectId: input.aspectId,
      character: input.character,
      count,
      seed: seeds[0],
      variant: input.variant,
      angle: input.angle,
    });
    return {
      pngs,
      seeds,
      source: 'demo',
      model: 'demo',
      consistency: 'demo-seed',
      warning: input.referencePng ? 'Demo studio kept the seed and ignored the reference pixels.' : undefined,
    };
  }

  if (input.provider === 'openai') {
    if (input.platform === 'web') {
      throw new Error('OpenAI blocks browser calls. Use Demo studio here, Salad if you have a gateway, or open Yume in Expo Go to use an OpenAI key.');
    }
    if (!input.openaiKey) throw new Error('No OpenAI key yet. Add one in Settings, or switch the provider to Demo or Salad.');
    const size = openAISize(input.openaiModel, input.width, input.height);
    if (input.referencePng && input.openaiModel === 'gpt-image-1') {
      const edited = await editOpenAIImage({
        apiKey: input.openaiKey,
        prompt,
        png: input.referencePng,
        size,
      });
      return { pngs: [edited], seeds, source: 'openai', model: input.openaiModel, consistency: 'openai-edit' };
    }
    const result = await generateOpenAI({
      apiKey: input.openaiKey,
      model: input.openaiModel,
      prompt,
      aspectId: input.aspectId,
      count,
      size,
    });
    return {
      pngs: result.images,
      seeds,
      source: 'openai',
      model: input.openaiModel,
      warning:
        result.warning ??
        (input.referencePng
          ? 'dall-e-3 cannot edit a reference image, so this angle is a new picture from the same description.'
          : undefined),
      consistency: input.referencePng ? 'openai-regenerate' : 'txt2img',
    };
  }

  if (!input.saladKey) throw new Error('Add the Salad API key in Settings. It stays in Secure Store on this phone.');
  const result = await generateSalad({
    endpoint: input.saladEndpoint,
    apiKey: input.saladKey,
    body: buildSaladBody({
      prompt,
      negative: input.negative,
      width: input.width,
      height: input.height,
      count,
      seed: seeds[0] ?? 1,
      steps: input.steps,
      cfg: input.cfg,
      sampler: input.sampler,
      model: input.saladModel,
      loras,
      referencePng: input.referencePng,
    }),
  });
  return {
    pngs: result.images,
    seeds: result.seeds.length ? result.seeds : seeds,
    source: 'salad',
    model: result.model,
    consistency: result.consistency,
  };
}
