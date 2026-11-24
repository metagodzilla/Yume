import { base64ToBytes, bytesToBase64 } from '@/src/lib/base64';
import type { LoraSpec, SamplerId } from '@/src/lib/types';

export type SaladRequest = {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  count: number;
  seed: number;
  steps: number;
  cfg: number;
  scheduler: SamplerId;
  model?: string;
  loras: { name: string; weight: number }[];
  reference_image?: string;
  strength?: number;
  mode?: 'txt2img' | 'img2img';
};

export function buildSaladBody(input: {
  prompt: string;
  negative: string;
  width: number;
  height: number;
  count: number;
  seed: number;
  steps: number;
  cfg: number;
  sampler: SamplerId;
  model: string;
  loras: LoraSpec[];
  referencePng?: Uint8Array | null;
}): SaladRequest {
  const body: SaladRequest = {
    prompt: input.prompt,
    negative_prompt: input.negative,
    width: input.width,
    height: input.height,
    count: input.count,
    seed: input.seed,
    steps: input.steps,
    cfg: input.cfg,
    scheduler: input.sampler,
    loras: input.loras.map((lora) => ({ name: lora.name, weight: lora.weight })),
  };
  const model = input.model.trim();
  if (model) body.model = model;
  if (input.referencePng && input.referencePng.length > 0) {
    body.reference_image = bytesToBase64(input.referencePng);
    body.strength = 0.45;
    body.mode = 'img2img';
  }
  return body;
}

export function saladErrorMessage(input: { aborted: boolean; status?: number; body?: string }): string {
  if (input.aborted) {
    return 'Salad is still waking up. The first drawing after a pause can take several minutes while a GPU node starts and the model loads. Wait until the container group says Ready, then try again.';
  }
  const status = input.status ?? 0;
  const detail = scrub(input.body ?? '');
  if (status === 401 || status === 403) {
    return 'Salad rejected that key. In Settings, paste the same key you set as YUME_API_KEY on the container. If Container Gateway auth is on, that key also has to be your Salad API key.';
  }
  if (status === 404) {
    return 'That Salad address has no /generate path. Check the endpoint URL in Settings. It should be the Container Gateway URL, with no extra path.';
  }
  if (status === 408 || status === 502 || status === 503 || status === 504) {
    return 'The Salad node is not ready yet. Cold starts are free, but the first request can sit there while the image downloads and the model loads. Give it a few minutes and draw again.';
  }
  if (status === 400) {
    return detail ? `Salad could not use that request. ${detail}` : 'Salad could not use that request. Check the size, steps, and LoRA names.';
  }
  if (!status) {
    return "Couldn't reach that Salad endpoint. Check the URL, and remember a sleeping node can take a few minutes to answer.";
  }
  return detail ? `Salad returned an error. ${detail}` : 'Salad had a problem drawing. Try again in a moment.';
}

function scrub(body: string): string {
  const trimmed = body.replace(/\s+/g, ' ').trim();
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown };
    const detail = parsed.detail ?? parsed.message;
    if (typeof detail === 'string') return detail.replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-…').slice(0, 180);
  } catch {
    // The body was not JSON.
  }
  return trimmed.replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-…').slice(0, 180);
}

export function normalizeEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

type SaladResponse = { images?: unknown; seeds?: unknown; model?: unknown; consistency?: unknown };

export async function generateSalad(
  input: {
    endpoint: string;
    apiKey: string;
    body: SaladRequest;
    timeoutMs?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ images: Uint8Array[]; seeds: number[]; model: string; consistency: string }> {
  const endpoint = normalizeEndpoint(input.endpoint);
  if (!endpoint) throw new Error('Add the Salad endpoint in Settings. It is the Container Gateway URL.');
  if (!input.apiKey.trim()) {
    throw new Error('Add the Salad API key in Settings. It is stored in Secure Store and sent only to that endpoint.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 170_000);
  let response: Response;
  try {
    response = await fetchImpl(`${endpoint}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey.trim()}`,
        'X-Api-Key': input.apiKey.trim(),
        'Salad-Api-Key': input.apiKey.trim(),
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new Error(saladErrorMessage({ aborted }));
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  if (!response.ok) throw new Error(saladErrorMessage({ aborted: false, status: response.status, body: raw }));
  let parsed: SaladResponse;
  try {
    parsed = JSON.parse(raw) as SaladResponse;
  } catch {
    throw new Error('Salad answered, but not with image data. Check that the endpoint is the Yume container.');
  }
  if (!Array.isArray(parsed.images) || parsed.images.length === 0) {
    throw new Error('Salad returned no images. If the node just woke up, try once more.');
  }
  const images = parsed.images.map((item) => {
    if (typeof item !== 'string' || !item) throw new Error('Salad returned an image Yume could not read.');
    return base64ToBytes(item);
  });
  const seeds = Array.isArray(parsed.seeds) ? parsed.seeds.filter((seed) => typeof seed === 'number') : [];
  return {
    images,
    seeds,
    model: typeof parsed.model === 'string' ? parsed.model : 'salad',
    consistency: typeof parsed.consistency === 'string' ? parsed.consistency : 'txt2img',
  };
}
