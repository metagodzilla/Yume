const ROOT = 'https://civitai.com/api/v1';

export type CivitaiVersion = {
  id: number;
  modelId: number;
  name: string;
  baseModel: string;
  trainedWords: string[];
  downloadUrl: string;
  files: { name: string; sizeKB?: number; hashes?: { AutoV2?: string; SHA256?: string }; primary?: boolean }[];
  images: { url: string; nsfw?: boolean | string; meta?: Record<string, unknown> | null }[];
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
  nsfw: boolean;
  cursor?: string | null;
  token?: string | null;
}): Promise<CivitaiPage> {
  const params = new URLSearchParams();
  params.set('limit', '20');
  params.set('types', input.type);
  params.set('sort', input.sort);
  params.set('nsfw', input.nsfw ? 'true' : 'false');
  if (input.baseModel) params.set('baseModels', input.baseModel);
  if (input.query.trim()) params.set('query', input.query.trim());
  if (input.cursor) params.set('cursor', input.cursor);
  const response = await fetch(`${ROOT}/models?${params.toString()}`, { headers: headers(input.token) });
  if (!response.ok) throw new Error(await failure(response, 'Civitai search failed.'));
  const body = (await response.json()) as { items?: CivitaiModel[]; metadata?: { nextCursor?: string } };
  return { items: body.items ?? [], nextCursor: body.metadata?.nextCursor ?? null };
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

export function previewUrl(model: CivitaiModel, allowNsfw: boolean): string | null {
  for (const version of model.modelVersions ?? []) {
    for (const image of version.images ?? []) {
      const flagged = image.nsfw === true || image.nsfw === 'X' || image.nsfw === 'Mature';
      if (flagged && !allowNsfw) continue;
      if (image.url) return image.url;
    }
  }
  return null;
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
