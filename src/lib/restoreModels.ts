import { useSyncExternalStore } from 'react';

import type { CatalogCheckpoint } from '@/src/lib/checkpoints';
import { WAI_ILLUSTRIOUS } from '@/src/lib/checkpoints';
import { RETIRED_CHECKPOINTS } from '@/src/lib/defaultModel';
import { forgetModel, modelsToRestore, rememberModel, type KeptLibrary, type KeptModel, emptyLibrary } from '@/src/lib/keptModels';
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

function withoutRetired(library: KeptLibrary): KeptLibrary {
  const retired = new Set<number>(RETIRED_CHECKPOINTS);
  return {
    models: library.models.filter((item) => !retired.has(item.versionId)),
    lastUsedVersionId: library.lastUsedVersionId != null && retired.has(library.lastUsedVersionId) ? WAI_ILLUSTRIOUS.versionId : library.lastUsedVersionId,
  };
}

function withWai(library: KeptLibrary): KeptLibrary {
  return rememberModel(withoutRetired(library), {
    versionId: WAI_ILLUSTRIOUS.versionId,
    type: 'Checkpoint',
    name: WAI_ILLUSTRIOUS.name,
    filename: WAI_ILLUSTRIOUS.filename,
    baseModel: WAI_ILLUSTRIOUS.baseModel,
  }, library.lastUsedVersionId == null);
}

export async function readKeptLibrary(): Promise<KeptLibrary> {
  const raw = await loadKeptModels();
  if (!raw) return withWai(emptyLibrary());
  try {
    const parsed = JSON.parse(raw) as KeptLibrary;
    return withWai({ models: Array.isArray(parsed.models) ? parsed.models : [], lastUsedVersionId: parsed.lastUsedVersionId ?? null });
  } catch {
    return withWai(emptyLibrary());
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
    if (!item.versionId || RETIRED_CHECKPOINTS.includes(item.versionId as (typeof RETIRED_CHECKPOINTS)[number])) continue;
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
  if (missing.length || library.lastUsedVersionId) {
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
