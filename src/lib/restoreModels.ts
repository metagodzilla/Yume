import { useSyncExternalStore } from 'react';

import type { CatalogCheckpoint } from '@/src/lib/checkpoints';
import { ANIME_STUDIO_CHECKPOINT } from '@/src/lib/animeStudio';
import { BUILTIN_CHECKPOINT, forgetModel, modelsToRestore, rememberModel, type KeptLibrary, type KeptModel, emptyLibrary } from '@/src/lib/keptModels';
import { startDownload } from '@/src/lib/downloadClient';
import { normalizeSaladKey } from '@/src/lib/saladCloud';
import { loadKeptModels, saveKeptModels } from '@/src/lib/storage';

let restoringIds: number[] = [];
const listeners = new Set<() => void>();

export function currentRestoringIds(): number[] {
  return restoringIds;
}

export function useRestoringIds(): number[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentRestoringIds,
    currentRestoringIds,
  );
}

function publishRestoring(ids: number[]) {
  restoringIds = ids;
  for (const listener of listeners) listener();
}

export async function readKeptLibrary(): Promise<KeptLibrary> {
  const raw = await loadKeptModels();
  if (!raw) {
    return rememberModel(emptyLibrary(), {
      versionId: ANIME_STUDIO_CHECKPOINT.versionId,
      type: 'Checkpoint',
      name: ANIME_STUDIO_CHECKPOINT.name,
      filename: ANIME_STUDIO_CHECKPOINT.filename,
      baseModel: ANIME_STUDIO_CHECKPOINT.baseModel,
    });
  }
  try {
    const parsed = JSON.parse(raw) as KeptLibrary;
    return rememberModel(
      { models: Array.isArray(parsed.models) ? parsed.models : [], lastUsedVersionId: parsed.lastUsedVersionId ?? null },
      {
        versionId: ANIME_STUDIO_CHECKPOINT.versionId,
        type: 'Checkpoint',
        name: ANIME_STUDIO_CHECKPOINT.name,
        filename: ANIME_STUDIO_CHECKPOINT.filename,
        baseModel: ANIME_STUDIO_CHECKPOINT.baseModel,
      },
    );
  } catch {
    return rememberModel(emptyLibrary(), {
      versionId: ANIME_STUDIO_CHECKPOINT.versionId,
      type: 'Checkpoint',
      name: ANIME_STUDIO_CHECKPOINT.name,
      filename: ANIME_STUDIO_CHECKPOINT.filename,
      baseModel: ANIME_STUDIO_CHECKPOINT.baseModel,
    });
  }
}

export async function writeKeptLibrary(library: KeptLibrary): Promise<void> {
  await saveKeptModels(JSON.stringify(library));
}

export async function dropKept(versionId: number): Promise<void> {
  await writeKeptLibrary(forgetModel(await readKeptLibrary(), versionId));
}

export async function keepInstalled(model: KeptModel, lastUsed = false): Promise<KeptLibrary> {
  const next = rememberModel(await readKeptLibrary(), model, lastUsed);
  await writeKeptLibrary(next);
  return next;
}

export async function keepCatalog(models: CatalogCheckpoint[]): Promise<void> {
  let library = await readKeptLibrary();
  for (const item of models) {
    if (!item.versionId || item.versionId === BUILTIN_CHECKPOINT) continue;
    library = rememberModel(library, {
      versionId: item.versionId,
      type: item.type || 'Checkpoint',
      name: item.name,
      filename: item.filename,
      baseModel: item.baseModel,
      triggers: item.triggers,
    });
  }
  await writeKeptLibrary(library);
}

export async function restoreMissingModels(input: { endpoint: string; apiKey: string; civitaiToken?: string | null }): Promise<{ restoring: KeptModel[] }> {
  const key = normalizeSaladKey(input.apiKey);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Salad-Api-Key': key,
    'X-Api-Key': key,
    accept: 'application/json',
  };
  const response = await fetch(`${input.endpoint}/models`, { headers });
  if (!response.ok) return { restoring: [] };
  const body = (await response.json()) as { models?: CatalogCheckpoint[] };
  const models = body.models ?? [];
  await keepCatalog(models);
  const library = await readKeptLibrary();
  const missing = modelsToRestore(library, models.map((item) => item.versionId));
  const token = input.civitaiToken?.trim();
  if (token) headers['X-Civitai-Token'] = token;
  headers['Content-Type'] = 'application/json';
  if (missing.length || (library.lastUsedVersionId && library.lastUsedVersionId !== BUILTIN_CHECKPOINT)) {
    await fetch(`${input.endpoint}/models/restore`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        versionIds: missing.map((item) => item.versionId),
        lastUsedVersionId: library.lastUsedVersionId,
        models: missing.map((item) => ({
          versionId: item.versionId,
          type: item.type,
          name: item.name,
          filename: item.filename,
          baseModel: item.baseModel,
          triggers: item.triggers ?? [],
        })),
      }),
    }).catch(() => undefined);
  }
  for (const item of missing) {
    await startDownload(input.endpoint, key, item.versionId, {
      type: item.type,
      name: item.name,
      filename: item.filename,
      baseModel: item.baseModel,
      triggers: item.triggers,
    }, token).catch(() => undefined);
  }
  publishRestoring(missing.map((item) => item.versionId));
  return { restoring: missing };
}
