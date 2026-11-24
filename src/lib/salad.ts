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

export const LIVE_GATEWAY_URL = 'https://persimmon-potato-w36vqxy5bseqmtk4.salad.cloud';
export const KEY_AS_URL_OFFER = 'This looks like your API key — move it to Key?';
export const KEY_MOVED_NOTICE = 'The saved server address was a Salad API key. It was moved to Key. Paste the gateway URL, or use the live server.';
export const KEY_CLEARED_NOTICE = 'The saved server address was a Salad API key, so it was cleared. Your Key was left as it is. Paste the gateway URL, or use the live server.';

export function redactSecrets(value: string): string {
  return value
    .replace(/salad_cloud_user_\S+/gi, 'salad_cloud_user_…')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-…');
}

export function looksLikeSaladKey(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/salad_cloud_user_/i.test(text)) return true;
  return !/^https?:\/\//i.test(text) && !text.includes('.');
}

export function isGatewayUrl(value: string): boolean {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text) || looksLikeSaladKey(text)) return false;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname;
    if (!host || host.includes('_') || host.includes(' ')) return false;
    return host === 'localhost' || host.includes('.');
  } catch {
    return false;
  }
}

export type GatewayInput =
  | { kind: 'empty' }
  | { kind: 'key'; key: string }
  | { kind: 'url'; url: string }
  | { kind: 'invalid' };

export function classifyGatewayInput(value: string): GatewayInput {
  const text = value.trim();
  if (!text) return { kind: 'empty' };
  if (looksLikeSaladKey(text)) {
    const match = text.match(/salad_cloud_user_[A-Za-z0-9_-]+/i);
    const key = match ? match[0] : text.replace(/^https?:\/\//i, '');
    return { kind: 'key', key };
  }
  const url = normalizeEndpoint(text);
  return url ? { kind: 'url', url } : { kind: 'invalid' };
}

export function migrateKeyStoredAsUrl(url: string, existingKey: string | null): { url: string; key: string | null; moved: boolean; notice: string | null } {
  const classified = classifyGatewayInput(url);
  if (classified.kind !== 'key') return { url, key: existingKey, moved: false, notice: null };
  const hadKey = Boolean(existingKey?.trim());
  return {
    url: '',
    key: hadKey ? existingKey : classified.key,
    moved: true,
    notice: hadKey ? KEY_CLEARED_NOTICE : KEY_MOVED_NOTICE,
  };
}

function safeWhere(url?: string): string {
  if (!url) return '';
  const base = url.replace(/\/(generate|health|ready|stats)$/i, '');
  if (!isGatewayUrl(base) || redactSecrets(url) !== url) return ' The saved address is not an http(s) gateway URL.';
  return ` Tried ${url}.`;
}

export function saladErrorMessage(input: { aborted: boolean; status?: number; body?: string; url?: string }): string {
  const where = safeWhere(input.url);
  if (input.aborted) {
    return `Salad is still waking up and did not answer in time.${where} The first SDXL picture can take a few minutes.`;
  }
  const status = input.status ?? 0;
  const detail = scrub(input.body ?? '');
  if (status === 401 || status === 403) {
    return `HTTP ${status}.${where} Salad rejected that key. Gateway auth is on, so the request needs the Salad-Api-Key header.`;
  }
  if (status === 404) {
    return `HTTP 404.${where} That address has no /generate path. Use the gateway URL with no extra path.`;
  }
  if (status === 408 || status === 502 || status === 503 || status === 504) {
    return `HTTP ${status}.${where} ${detail || 'The node is not ready yet.'}`;
  }
  if (status === 400) {
    return `HTTP 400.${where} ${detail || 'Salad could not use that request.'}`;
  }
  if (!status) {
    return `Couldn't reach that Salad endpoint.${where} ${detail || 'The phone got no HTTP response. Check the URL.'}`;
  }
  return detail ? `HTTP ${status}.${where} ${detail}` : `HTTP ${status}.${where} Salad had a problem drawing.`;
}

function scrub(body: string): string {
  const trimmed = redactSecrets(body.replace(/\s+/g, ' ').trim());
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown };
    const detail = parsed.detail ?? parsed.message;
    if (typeof detail === 'string') return redactSecrets(detail).slice(0, 180);
  } catch {
    // The body was not JSON.
  }
  return trimmed.slice(0, 180);
}

export function normalizeEndpoint(value: string): string {
  const text = value.trim();
  if (!text || looksLikeSaladKey(text)) return '';
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  if (!isGatewayUrl(withScheme)) return '';
  const url = new URL(withScheme);
  const path = url.pathname.replace(/\/+$/, '').replace(/\/(generate|health|ready|stats)$/i, '');
  return `${url.origin}${path === '/' ? '' : path}`;
}

export function generateUrl(endpoint: string): string {
  const base = normalizeEndpoint(endpoint);
  return base ? `${base}/generate` : '';
}

export function endpointDiffersFromLive(saved: string): boolean {
  return normalizeEndpoint(saved) !== normalizeEndpoint(LIVE_GATEWAY_URL);
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
  const classified = classifyGatewayInput(input.endpoint);
  if (classified.kind === 'key') throw new Error('That saved address is a Salad API key, not a gateway URL. Open Connect and move it to Key.');
  if (classified.kind !== 'url') throw new Error('Add a gateway URL that starts with https://. Connect can fill in the live server.');
  const endpoint = classified.url;
  const target = generateUrl(endpoint);
  if (!input.apiKey.trim()) {
    throw new Error('Add the Salad API key in Settings. It is stored in Secure Store and sent only to that endpoint.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 180_000);
  let response: Response;
  try {
    response = await fetchImpl(target, {
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
    const message = error instanceof Error ? error.message : '';
    throw new Error(saladErrorMessage({ aborted, body: aborted ? '' : message, url: target }));
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  if (!response.ok) throw new Error(saladErrorMessage({ aborted: false, status: response.status, body: raw, url: target }));
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
