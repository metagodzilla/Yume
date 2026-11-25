import { isClothesTag } from '@/src/lib/positiveTags';

export type TasteVoteName = 'like' | 'dislike';

export type ImageShot = {
  prompt: string;
  clothes: string;
  positive: string;
  extra: string;
  quality: string;
  negative: string;
  checkpoint: string;
  checkpointId: number | null;
  loras: { name: string; weight: number }[];
  sampler: string;
  steps: number;
  cfg: number;
  width: number;
  height: number;
  reference: {
    pose: boolean;
    poseStrength: number;
    fit: boolean;
    body: string;
    copy: boolean;
    denoise: number;
    style: boolean;
    styleStrength: number;
  };
};

export type TasteVote = {
  id: string;
  generationId: string;
  index: number;
  vote: TasteVoteName;
  at: number;
  shot: ImageShot;
};

export type TasteStore = {
  votes: TasteVote[];
  hidden: string[];
};

export type TasteItem = {
  key: string;
  kind: 'tag' | 'lora' | 'setting';
  label: string;
  likes: number;
  dislikes: number;
  score: number;
};

const STYLE = /quality|aesthetic|absurdres|detailed|lighting|shading|coloring|lineart|sketch|painterly|bloom|bokeh|depth of field|cinematic|dramatic|grain|masterpiece|highres|newest|background|blurry|lowres|watermark|signature|vibrant|pastel|monochrome|sparkle|glossy|volumetric/;
const IDENTITY = /^(?:\d+girls?|\d+boys?|solo|hetero|1other|adult|mature female)$/i;

let published: TasteStore = { votes: [], hidden: [] };

export function captureShot(input: {
  prompt: string;
  clothes?: string;
  positive?: string;
  extra?: string;
  quality?: string;
  negative: string;
  checkpoint: string;
  checkpointId: number | null;
  loras: { name: string; weight: number }[];
  sampler: string;
  steps: number;
  cfg: number;
  width: number;
  height: number;
  referencePose?: boolean;
  referencePoseStrength?: number;
  referenceFit?: boolean;
  referenceBody?: string;
  referenceCopy?: boolean;
  referenceDenoise?: number;
  referenceStyle?: boolean;
  referenceStyleStrength?: number;
}): ImageShot {
  return {
    prompt: input.prompt,
    clothes: input.clothes || '',
    positive: input.positive || '',
    extra: input.extra || '',
    quality: input.quality || '',
    negative: input.negative,
    checkpoint: input.checkpoint,
    checkpointId: input.checkpointId,
    loras: input.loras.filter((lora) => lora.name.trim()).map((lora) => ({ name: lora.name, weight: lora.weight })),
    sampler: input.sampler,
    steps: input.steps,
    cfg: input.cfg,
    width: input.width,
    height: input.height,
    reference: {
      pose: Boolean(input.referencePose),
      poseStrength: input.referencePoseStrength ?? 0.85,
      fit: input.referenceFit !== false,
      body: input.referenceBody || 'average',
      copy: Boolean(input.referenceCopy),
      denoise: input.referenceDenoise ?? 0.6,
      style: Boolean(input.referenceStyle),
      styleStrength: input.referenceStyleStrength ?? 0.55,
    },
  };
}

export function shotFromGeneration(input: { userPrompt?: string; finalPrompt?: string; negative?: string; model?: string; loras?: { name: string; weight: number }[]; sampler?: string; steps?: number; cfg?: number; width?: number; height?: number; shot?: ImageShot }): ImageShot {
  if (input.shot) return input.shot;
  return captureShot({
    prompt: input.userPrompt || input.finalPrompt || '',
    negative: input.negative || '',
    checkpoint: input.model || '',
    checkpointId: null,
    loras: input.loras || [],
    sampler: input.sampler || 'euler_a',
    steps: input.steps || 28,
    cfg: input.cfg || 5,
    width: input.width || 832,
    height: input.height || 1216,
  });
}

export function emptyTaste(): TasteStore {
  return { votes: [], hidden: [] };
}

export function publishTaste(store: TasteStore) {
  published = store;
}

export function currentTaste(): TasteStore {
  return published;
}

export function normTag(tag: string): string {
  let text = tag.trim().toLowerCase();
  const weighted = text.match(/^\(?([^:()]+):[\d.]+\)?$/);
  if (weighted?.[1]) text = weighted[1];
  return text.replace(/^\(+|\)+$/g, '').trim();
}

export function tagsOf(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isStyleTag(tag: string): boolean {
  const text = normTag(tag);
  if (!text || IDENTITY.test(text) || isClothesTag(text)) return false;
  return STYLE.test(text);
}

export function castVote(store: TasteStore, vote: TasteVote): TasteStore {
  const existing = store.votes.find((item) => item.id === vote.id);
  if (existing?.vote === vote.vote) return { ...store, votes: store.votes.filter((item) => item.id !== vote.id) };
  return { ...store, votes: [...store.votes.filter((item) => item.id !== vote.id), vote] };
}

export function hideTasteItem(store: TasteStore, key: string): TasteStore {
  return store.hidden.includes(key) ? store : { ...store, hidden: [...store.hidden, key] };
}

export function learnTaste(store: TasteStore): TasteItem[] {
  const hidden = new Set(store.hidden);
  const rows = new Map<string, TasteItem>();
  const bump = (key: string, kind: TasteItem['kind'], label: string, vote: TasteVoteName) => {
    if (hidden.has(key) || !label.trim()) return;
    const row = rows.get(key) ?? { key, kind, label, likes: 0, dislikes: 0, score: 0 };
    if (vote === 'like') row.likes += 1;
    else row.dislikes += 1;
    row.score = row.likes - row.dislikes;
    rows.set(key, row);
  };
  for (const vote of store.votes) {
    const parts = [vote.shot.prompt, vote.shot.positive, vote.shot.extra, vote.shot.quality];
    for (const tag of parts.flatMap(tagsOf)) bump(`tag:${normTag(tag)}`, 'tag', tag, vote.vote);
    for (const lora of vote.shot.loras) {
      if (!lora.name.trim()) continue;
      bump(`lora:${lora.name.trim().toLowerCase()}`, 'lora', `${lora.name}:${lora.weight}`, vote.vote);
    }
    bump(`setting:sampler:${vote.shot.sampler}`, 'setting', vote.shot.sampler, vote.vote);
    bump(`setting:steps:${vote.shot.steps}`, 'setting', `${vote.shot.steps} steps`, vote.vote);
    bump(`setting:cfg:${vote.shot.cfg}`, 'setting', `CFG ${vote.shot.cfg}`, vote.vote);
  }
  return [...rows.values()].sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || a.label.localeCompare(b.label));
}

export function suggestedSettings(store: TasteStore): { sampler: string | null; steps: number | null; cfg: number | null } {
  const items = learnTaste(store);
  const best = (prefix: string) => items.filter((item) => item.key.startsWith(prefix) && item.likes >= 2 && item.score >= 2).sort((a, b) => b.score - a.score)[0];
  const sampler = best('setting:sampler:');
  const steps = best('setting:steps:');
  const cfg = best('setting:cfg:');
  return {
    sampler: sampler ? sampler.key.slice('setting:sampler:'.length) : null,
    steps: steps ? Number(steps.key.slice('setting:steps:'.length)) : null,
    cfg: cfg ? Number(cfg.key.slice('setting:cfg:'.length)) : null,
  };
}

export function applyTaste(input: { enabled: boolean; prompt: string; negative: string; blocked: string[]; store: TasteStore }): { prompt: string; negative: string } {
  if (!input.enabled) return { prompt: input.prompt, negative: input.negative };
  const blocked = new Set(input.blocked.map(normTag).filter(Boolean));
  for (const tag of [...tagsOf(input.prompt), ...tagsOf(input.negative)]) blocked.add(normTag(tag));
  const items = learnTaste(input.store);
  const liked = items.filter((item) => item.kind === 'tag' && item.likes >= 2 && item.score >= 2 && isStyleTag(item.label) && !blocked.has(normTag(item.label))).slice(0, 4);
  const disliked = items
    .filter((item) => item.kind === 'tag' && item.dislikes >= 2 && item.score <= -2 && !isClothesTag(item.label) && !IDENTITY.test(normTag(item.label)) && !blocked.has(normTag(item.label)))
    .slice(0, 6);
  const prompt = [...tagsOf(input.prompt), ...liked.map((item) => `(${normTag(item.label)}:0.35)`)].join(', ');
  const negative = [...tagsOf(input.negative), ...disliked.map((item) => `(${normTag(item.label)}:0.4)`)].join(', ');
  return { prompt, negative };
}

export function mergeTaste(current: TasteStore, incoming: TasteStore): TasteStore {
  const votes = new Map(current.votes.map((vote) => [vote.id, vote]));
  for (const vote of incoming.votes) votes.set(vote.id, vote);
  return { votes: [...votes.values()], hidden: [...new Set([...current.hidden, ...incoming.hidden])] };
}

export function isTasteStore(value: unknown): value is TasteStore {
  if (!value || typeof value !== 'object') return false;
  const store = value as TasteStore;
  return Array.isArray(store.votes) && Array.isArray(store.hidden);
}
