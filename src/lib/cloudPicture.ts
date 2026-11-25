import { bytesToBase64, base64ToBytes } from '@/src/lib/base64';
import { normalizeEndpoint } from '@/src/lib/salad';
import type { Generation } from '@/src/lib/types';
import { captureShot } from '@/src/lib/taste';

export async function cloudPost(endpoint: string, key: string, path: string, body: Record<string, unknown>): Promise<{ image?: string; mask?: string; width: number; height: number; prompt?: string; mode?: string; page?: string; bubbles?: number }> {
  const root = normalizeEndpoint(endpoint);
  if (!root || !key) throw new Error('Connect the cloud before using this. Upscale and manga redraw run on the cloud.');
  const response = await fetch(`${root}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'Salad-Api-Key': key,
      'X-Api-Key': key,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { detail?: string; image?: string; mask?: string; width?: number; height?: number; prompt?: string; mode?: string; page?: string; bubbles?: number };
  if (!response.ok) throw new Error(payload.detail || 'The cloud could not finish that picture.');
  return { image: payload.image, mask: payload.mask, width: payload.width || 0, height: payload.height || 0, prompt: payload.prompt, mode: payload.mode, page: payload.page, bubbles: payload.bubbles };
}

export function pictureRecord(input: { id: string; uri: string; uris?: string[]; originalUri?: string; prompt: string; negative: string; model: string; width: number; height: number; provider: Generation['provider'] }): Generation {
  return {
    id: input.id,
    createdAt: Date.now(),
    userPrompt: input.prompt,
    enhancedPrompt: input.prompt,
    finalPrompt: input.prompt,
    negative: input.negative,
    styleId: 'watercolor',
    styleName: input.model,
    aspectId: input.height >= input.width ? 'wallpaper' : 'landscape',
    count: 1,
    characterId: null,
    characterName: null,
    imageUris: input.uris?.length ? input.uris : [input.uri],
    ...(input.originalUri ? { originalUri: input.originalUri } : {}),
    source: input.provider === 'salad' ? 'salad' : 'demo',
    model: input.model,
    provider: input.provider,
    enhance: false,
    seed: null,
    seeds: [],
    steps: 16,
    cfg: 5,
    sampler: 'euler_a',
    width: input.width,
    height: input.height,
    saladModel: '',
    loras: [],
    shot: captureShot({
      prompt: input.prompt,
      negative: input.negative,
      checkpoint: input.model,
      checkpointId: null,
      loras: [],
      sampler: 'euler_a',
      steps: 16,
      cfg: 5,
      width: input.width,
      height: input.height,
    }),
  };
}

export function imageBytes(payload: string): Uint8Array {
  return base64ToBytes(payload);
}

export function imageField(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}
