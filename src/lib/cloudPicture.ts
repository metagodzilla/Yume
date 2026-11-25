import { bytesToBase64, base64ToBytes } from '@/src/lib/base64';
import { followJob, type JobView } from '@/src/lib/cloudJob';
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
  const payload = (await response.json().catch(() => ({}))) as JobView & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || 'The cloud could not finish that picture.');
  const finished = payload.id && !payload.image && !payload.mask && !payload.images
    ? await followJob({
        id: payload.id,
        read: () => readJob(`${root}/jobs/${payload.id}`, key),
        result: () => readJob(`${root}/jobs/${payload.id}/result`, key),
      })
    : payload;
  return { image: finished.image, mask: finished.mask, width: finished.width || 0, height: finished.height || 0, prompt: finished.prompt, mode: finished.mode, page: finished.page, bubbles: finished.bubbles };
}

async function readJob(url: string, key: string): Promise<JobView> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${key}`, 'Salad-Api-Key': key, 'X-Api-Key': key } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'fetch failed';
    throw new Error(message);
  }
  const payload = (await response.json().catch(() => ({}))) as JobView & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
  return payload;
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
