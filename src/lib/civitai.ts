const ROOT = 'https://civitai.com/api/v1';

export type ContentFilter = 'all' | 'sfw' | 'nsfw';

export type CivitaiImage = {
  url: string;
  nsfw?: boolean | string;
  nsfwLevel?: number;
  type?: string;
  hash?: string;
  width?: number;
  height?: number;
  meta?: Record<string, unknown> | null;
};

export type CivitaiVersion = {
  id: number;
  modelId: number;
  name: string;
  baseModel: string;
  trainedWords: string[];
  downloadUrl: string;
  files: { name: string; sizeKB?: number; hashes?: { AutoV2?: string; SHA256?: string }; primary?: boolean }[];
  images: CivitaiImage[];
};

export type CivitaiModel = {
  id: number;
  name: string;
  type: string;
  nsfw: boolean;
  nsfwLevel?: number;
  tags?: string[];
  modelVersions: CivitaiVersion[];
};

export type CivitaiPage = {
  items: CivitaiModel[];
  nextCursor: string | null;
};

export async function searchCivitai(input: {
  query: string;
  type: string;
  baseModel: string;
  sort: string;
  contentFilter?: ContentFilter;
  nsfw?: boolean;
  cursor?: string | null;
  token?: string | null;
}): Promise<CivitaiPage> {
  const filter = input.contentFilter ?? (input.nsfw ? 'all' : 'sfw');
  const params = new URLSearchParams();
  const browsing = browsingParams(filter);
  params.set('limit', '20');
  params.set('types', input.type);
  params.set('sort', input.sort);
  params.set('nsfw', browsing.nsfw);
  params.set('browsingLevel', browsing.browsingLevel);
  if (input.baseModel) params.set('baseModels', input.baseModel);
  if (input.query.trim()) params.set('query', input.query.trim());
  if (input.cursor) params.set('cursor', input.cursor);
  const response = await fetch(`${ROOT}/models?${params.toString()}`, { headers: headers(input.token) });
  if (!response.ok) throw new Error(await failure(response, 'Civitai search failed.'));
  const body = (await response.json()) as { items?: CivitaiModel[]; metadata?: { nextCursor?: string } };
  return { items: filterModels(body.items ?? [], filter), nextCursor: body.metadata?.nextCursor ?? null };
}

export async function getCivitaiModel(id: number, token?: string | null): Promise<CivitaiModel> {
  const response = await fetch(`${ROOT}/models/${id}`, { headers: headers(token) });
  if (!response.ok) throw new Error(await failure(response, 'That model was not found on Civitai.'));
  return (await response.json()) as CivitaiModel;
}

export async function getCivitaiVersion(id: number, token?: string | null): Promise<CivitaiVersion & { model?: { name?: string; type?: string } }> {
  const response = await fetch(`${ROOT}/model-versions/${id}`, { headers: headers(token) });
  if (!response.ok) throw new Error(await failure(response, 'That model version was not found.'));
  return (await response.json()) as CivitaiVersion & { model?: { name?: string; type?: string } };
}

export async function getCivitaiImage(id: number, token?: string | null): Promise<{ id: number; meta?: Record<string, unknown> | null; url?: string }> {
  const response = await fetch(`${ROOT}/images/${id}`, { headers: headers(token) });
  if (!response.ok) throw new Error(await failure(response, 'That Civitai image was not found.'));
  return (await response.json()) as { id: number; meta?: Record<string, unknown> | null; url?: string };
}

export function versionFile(version: CivitaiVersion) {
  return version.files?.find((file) => file.primary) ?? version.files?.[0];
}

export function loraFileName(version: CivitaiVersion, modelName: string): string {
  const raw = versionFile(version)?.name || modelName;
  return raw.replace(/\.(safetensors|pt|ckpt|bin)$/i, '');
}

export function browsingParams(filter: ContentFilter): { nsfw: string; browsingLevel: string } {
  if (filter === 'sfw') return { nsfw: 'false', browsingLevel: '3' };
  if (filter === 'nsfw') return { nsfw: 'true', browsingLevel: '28' };
  return { nsfw: 'true', browsingLevel: '31' };
}

export function isNsfwSignal(flag?: boolean | string, level?: number): boolean {
  if (flag === true || flag === 'Mature' || flag === 'X' || flag === 'XXX') return true;
  if (flag === false || flag === 'None' || flag === 'Soft' || flag === 'PG' || flag === 'PG13') return false;
  if (typeof level !== 'number' || !Number.isFinite(level)) return false;
  return level === 4 || level === 8 || level === 16 || level === 32 || (level >= 4 && (level & 1) === 0) || (level & 28) !== 0;
}

export function modelPasses(model: { nsfw?: boolean | string; nsfwLevel?: number }, filter: ContentFilter): boolean {
  if (filter === 'all') return true;
  const nsfw = isNsfwSignal(model.nsfw, model.nsfw === false ? undefined : model.nsfwLevel);
  return filter === 'nsfw' ? nsfw : !nsfw;
}

export function filterModels(items: CivitaiModel[], filter: ContentFilter): CivitaiModel[] {
  if (filter === 'all') return items;
  return items.filter((item) => modelPasses(item, filter));
}

export function isVideoPreview(image: { url?: string; type?: string }): boolean {
  if (image.type === 'video') return true;
  return /\.(mp4|webm|mov)(\?|$)/i.test(image.url ?? '');
}

export function thumbnailUrl(url: string): string {
  return url.includes('/original=true/') ? url.replace('/original=true/', '/width=450/') : url;
}

export type PreviewPick = { url: string; kind: 'image' | 'video'; blurhash?: string; nsfwLevel?: number };

export function pickPreview(model: CivitaiModel, filter: ContentFilter): PreviewPick | null {
  const images = (model.modelVersions ?? []).flatMap((version) => version.images ?? []).filter((image) => image.url);
  const stills = images.filter((image) => !isVideoPreview(image));
  const videos = images.filter((image) => isVideoPreview(image));
  const pool = stills.length ? stills : videos;
  const match = pool.find((image) => mediaAllowed(image, filter));
  if (!match?.url) return null;
  return {
    url: match.url,
    kind: isVideoPreview(match) ? 'video' : 'image',
    blurhash: typeof match.hash === 'string' ? match.hash : undefined,
    nsfwLevel: match.nsfwLevel,
  };
}

export function previewUrl(model: CivitaiModel, allowNsfw: boolean): string | null {
  return pickPreview(model, allowNsfw ? 'all' : 'sfw')?.url ?? null;
}

export function civitaiModelUrl(modelId: number, versionId?: number | null): string {
  const version = versionId && versionId > 0 ? `?modelVersionId=${versionId}` : '';
  return `https://civitai.com/models/${modelId}${version}`;
}

export function civitaiSearchUrl(name: string): string {
  return `https://civitai.com/search/models?query=${encodeURIComponent(name.trim())}`;
}

export function loraPage(input: { name: string; modelId?: number | null; versionId?: number | null }): { url: string; label: string } {
  if (input.modelId && input.modelId > 0) {
    return { url: civitaiModelUrl(input.modelId, input.versionId), label: 'Open on Civitai' };
  }
  return { url: civitaiSearchUrl(input.name || 'lora'), label: 'Search on Civitai' };
}

function mediaAllowed(image: CivitaiImage, filter: ContentFilter): boolean {
  if (filter === 'all') return true;
  const nsfw = isNsfwSignal(image.nsfw, image.nsfwLevel);
  return filter === 'nsfw' ? nsfw : !nsfw;
}

function headers(token?: string | null): HeadersInit {
  return token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {};
}

async function failure(response: Response, fallback: string): Promise<string> {
  if (response.status === 401) return 'Civitai rejected that API token.';
  if (response.status === 429) return 'Civitai asked us to slow down. Try the search again in a moment.';
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (body.error || body.message) return body.error || body.message || fallback;
  } catch {
    // The body was not JSON.
  }
  return fallback;
}
