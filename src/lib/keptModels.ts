/** Models the phone remembers so a new Salad node can download them again. */

export const BUILTIN_CHECKPOINT = 1337429;
export const DISK_RESET_NOTE = 'Salad disks reset when the cloud restarts. Yume downloads your saved models again.';

export type KeptModel = {
  versionId: number;
  type: string;
  name: string;
  filename?: string;
  baseModel?: string;
  triggers?: string[];
};

export type KeptLibrary = {
  models: KeptModel[];
  lastUsedVersionId: number | null;
};

export const emptyLibrary = (): KeptLibrary => ({ models: [], lastUsedVersionId: null });

export function rememberModel(library: KeptLibrary, model: KeptModel, lastUsed = false): KeptLibrary {
  if (!model.versionId || model.versionId === BUILTIN_CHECKPOINT) {
    return lastUsed ? { ...library, lastUsedVersionId: model.versionId || library.lastUsedVersionId } : library;
  }
  const others = library.models.filter((item) => item.versionId !== model.versionId);
  return {
    models: [...others, { ...model, type: model.type || 'Checkpoint', name: model.name || `Civitai ${model.versionId}` }],
    lastUsedVersionId: lastUsed && (model.type || 'Checkpoint') === 'Checkpoint' ? model.versionId : library.lastUsedVersionId,
  };
}

export function forgetModel(library: KeptLibrary, versionId: number): KeptLibrary {
  return {
    models: library.models.filter((item) => item.versionId !== versionId),
    lastUsedVersionId: library.lastUsedVersionId === versionId ? null : library.lastUsedVersionId,
  };
}

export function modelsToRestore(library: KeptLibrary, catalogVersionIds: number[]): KeptModel[] {
  const present = new Set(catalogVersionIds);
  return library.models.filter((item) => item.versionId !== BUILTIN_CHECKPOINT && !present.has(item.versionId));
}

export function modelPresence(versionId: number, catalogVersionIds: number[], restoringIds: number[]): 'installed' | 'restoring' | 'missing' {
  if (catalogVersionIds.includes(versionId) || versionId === BUILTIN_CHECKPOINT) return 'installed';
  if (restoringIds.includes(versionId)) return 'restoring';
  return 'missing';
}

export function restoreSummary(lines: { versionId: number; name: string; percent: number | null; state: string }[]): {
  total: number;
  done: number;
  percent: number | null;
} {
  const active = lines.filter((item) => item.state === 'queued' || item.state === 'downloading' || item.state === 'done');
  if (active.length === 0) return { total: 0, done: 0, percent: null };
  const done = active.filter((item) => item.state === 'done').length;
  const percents = active.map((item) => (item.state === 'done' ? 100 : item.percent ?? 0));
  const percent = Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length);
  return { total: active.length, done, percent };
}
