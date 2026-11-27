import type { Generation, SamplerId } from '@/src/lib/types';

export type GalleryTile = {
  key: string;
  generationId: string;
  index: number;
  uri: string;
  prompt: string;
  createdAt: number;
  favorite: boolean;
  seed: number | null;
};

const SAMPLER_LABEL: Record<SamplerId, string> = {
  euler_a: 'Euler a',
  euler: 'Euler',
  dpm_2m: 'DPM++ 2M',
  dpm_2m_karras: 'DPM++ 2M Karras',
  ddim: 'DDIM',
  lcm: 'LCM',
};

export function galleryTiles(history: Generation[]): GalleryTile[] {
  return [...history]
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((item) =>
      item.imageUris.map((uri, index) => ({
        key: `${item.id}:${index}`,
        generationId: item.id,
        index,
        uri,
        prompt: item.finalPrompt || item.userPrompt || '',
        createdAt: item.createdAt,
        favorite: (item.favoriteIndexes ?? []).includes(index),
        seed: item.seeds?.[index] ?? item.seed ?? null,
      })),
    );
}

export function filterTiles(tiles: GalleryTile[], input: { query?: string; favoritesOnly?: boolean }): GalleryTile[] {
  const query = (input.query ?? '').trim().toLowerCase();
  return tiles.filter((tile) => {
    if (input.favoritesOnly && !tile.favorite) return false;
    if (query && !tile.prompt.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function withFavorite(item: Generation, index: number): Generation {
  const current = new Set(item.favoriteIndexes ?? []);
  if (current.has(index)) current.delete(index);
  else current.add(index);
  return { ...item, favoriteIndexes: [...current].sort((a, b) => a - b) };
}

export function dropTiles(history: Generation[], keys: { generationId: string; index: number }[]): { next: Generation[]; removed: string[] } {
  const grouped = new Map<string, Set<number>>();
  for (const key of keys) {
    const set = grouped.get(key.generationId) ?? new Set<number>();
    set.add(key.index);
    grouped.set(key.generationId, set);
  }
  const removed: string[] = [];
  const next = history.flatMap((item) => {
    const drop = grouped.get(item.id);
    if (!drop?.size) return [item];
    const imageUris: string[] = [];
    const seeds: number[] = [];
    const favoriteIndexes: number[] = [];
    item.imageUris.forEach((uri, index) => {
      if (drop.has(index)) {
        removed.push(uri);
        return;
      }
      if ((item.favoriteIndexes ?? []).includes(index)) favoriteIndexes.push(imageUris.length);
      imageUris.push(uri);
      if (item.seeds?.[index] != null) seeds.push(item.seeds[index]);
    });
    if (!imageUris.length) return [];
    return [{ ...item, imageUris, seeds, seed: seeds[0] ?? null, count: imageUris.length, favoriteIndexes }];
  });
  return { next, removed };
}

export function samplerLabel(sampler: SamplerId): string {
  return SAMPLER_LABEL[sampler] ?? 'Euler a';
}

export function reusePatch(generation: Generation, imageIndex: number) {
  const seed = generation.seeds?.[imageIndex] ?? generation.seed;
  return {
    prompt: generation.userPrompt,
    negative: generation.negative,
    sampler: samplerLabel(generation.sampler),
    steps: generation.steps,
    cfg: generation.cfg,
    width: generation.width,
    height: generation.height,
    seed: seed == null ? '' : String(seed),
    seedRandom: seed == null,
    count: 1,
    loras: generation.loras.map((lora) => ({
      name: lora.name,
      weight: lora.weight,
      ...(lora.modelId ? { modelId: lora.modelId } : {}),
      ...(lora.versionId ? { versionId: lora.versionId } : {}),
      ...(lora.prompt != null ? { prompt: lora.prompt } : {}),
      ...(lora.enabled === false ? { enabled: false } : {}),
      ...(lora.kind ? { kind: lora.kind } : {}),
      ...(lora.triggers?.length ? { triggers: lora.triggers } : {}),
    })),
    ...(generation.regionLayout ? { regionLayout: generation.regionLayout } : {}),
    ...(generation.interaction ? { interaction: generation.interaction } : {}),
  };
}

export function metadataLines(generation: Generation, imageIndex: number): string[] {
  const seed = generation.seeds?.[imageIndex] ?? generation.seed;
  const loras = generation.loras.map((lora) => `${lora.name}:${lora.weight}`).join(', ');
  const seconds = generation.durationMs != null ? `${(generation.durationMs / 1000).toFixed(1)}s` : '';
  return [
    generation.finalPrompt || generation.userPrompt,
    generation.negative ? `Negative: ${generation.negative}` : '',
    generation.model ? `Model: ${generation.model}` : '',
    loras ? `LoRAs: ${loras}` : '',
    `Sampler: ${samplerLabel(generation.sampler)}`,
    `Steps ${generation.steps} · CFG ${generation.cfg}`,
    seed == null ? '' : `Seed ${seed}`,
    `${generation.width}×${generation.height}`,
    seconds ? `Time ${seconds}` : '',
  ].filter(Boolean);
}
