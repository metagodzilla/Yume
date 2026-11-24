import { STYLES, aspectById } from '@/src/lib/presets';
import type {
  AspectId,
  Library,
  LoraSpec,
  PromptTemplate,
  SamplerId,
  UserStyle,
  Wildcard,
} from '@/src/lib/types';

export const SAMPLERS: { id: SamplerId; label: string }[] = [
  { id: 'euler_a', label: 'Euler a' },
  { id: 'euler', label: 'Euler' },
  { id: 'dpm_2m', label: 'DPM++ 2M' },
  { id: 'dpm_2m_karras', label: 'DPM++ 2M Karras' },
  { id: 'ddim', label: 'DDIM' },
  { id: 'lcm', label: 'LCM' },
];

export const BASE_NEGATIVE =
  'lowres, bad anatomy, bad hands, extra fingers, missing fingers, text, watermark, signature, logo, blurry, worst quality, low quality';

const EXTRA_NEGATIVE: Record<string, string> = {
  manga: 'color, chromatic aberration',
  mecha: 'deformed machinery, melted metal',
  watercolor: 'harsh neon, plastic skin',
  shojo: 'harsh shadows',
};

export const FRAME_PIXELS: Record<AspectId, { width: number; height: number }> = {
  wallpaper: { width: 832, height: 1216 },
  avatar: { width: 1024, height: 1024 },
  landscape: { width: 1216, height: 832 },
  manga: { width: 832, height: 1216 },
};

export function defaultNegative(styleId: string): string {
  const extra = EXTRA_NEGATIVE[styleId];
  return extra ? `${BASE_NEGATIVE}, ${extra}` : BASE_NEGATIVE;
}

export function builtinStyles(): UserStyle[] {
  return STYLES.map((style, order) => ({
    id: style.id,
    name: style.label,
    note: style.note,
    blurb: style.blurb,
    prefix: style.lead,
    suffix: style.finish,
    negative: defaultNegative(style.id),
    steps: 28,
    cfg: 5.5,
    sampler: 'euler_a',
    swatch: style.swatch,
    builtIn: true,
    order,
  }));
}

export function defaultWildcards(): Wildcard[] {
  return [
    { id: 'hair_color', token: 'hair_color', values: ['black', 'chestnut', 'sakura pink', 'silver', 'midnight blue', 'snow white'] },
    { id: 'eye_color', token: 'eye_color', values: ['amber', 'sea blue', 'crimson', 'gold', 'violet'] },
    { id: 'outfit', token: 'outfit', values: ['a school blazer', 'a kimono', 'an oversized hoodie', 'a witch cape', 'streetwear'] },
    { id: 'expression', token: 'expression', values: ['a gentle smile', 'a fierce look', 'a sleepy expression', 'a shy expression'] },
    { id: 'setting', token: 'setting', values: ['a shrine courtyard', 'a night rooftop', 'a blossom street', 'a mossy forest', 'a quiet bedroom'] },
  ];
}

export function defaultTemplates(): PromptTemplate[] {
  return [
    {
      id: 'rain-shrine',
      name: 'Rain shrine',
      prompt: 'waiting in the rain, {outfit}, {hair_color} hair, {eye_color} eyes, {expression}, {setting}',
      negative: '',
    },
    {
      id: 'portrait',
      name: 'Quiet portrait',
      prompt: 'close portrait, looking at the viewer, {hair_color} hair, {eye_color} eyes, {expression}',
      negative: '',
    },
  ];
}

export function defaultLibrary(): Library {
  return { styles: builtinStyles(), wildcards: defaultWildcards(), templates: defaultTemplates() };
}

export function sortStyles(styles: UserStyle[]): UserStyle[] {
  return [...styles].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function styleByStoredId(styles: UserStyle[], id: string): UserStyle {
  return sortStyles(styles).find((style) => style.id === id) ?? sortStyles(styles)[0] ?? builtinStyles()[0];
}

function reindex(styles: UserStyle[]): UserStyle[] {
  return sortStyles(styles).map((style, order) => ({ ...style, order }));
}

export function upsertStyle(styles: UserStyle[], style: UserStyle): UserStyle[] {
  const next = styles.some((item) => item.id === style.id)
    ? styles.map((item) => (item.id === style.id ? style : item))
    : [...styles, style];
  return reindex(next);
}

export function duplicateStyle(styles: UserStyle[], id: string, newId: string): UserStyle[] {
  const source = styles.find((style) => style.id === id);
  if (!source) return styles;
  const copy: UserStyle = {
    ...source,
    id: newId,
    name: `Copy of ${source.name}`,
    builtIn: false,
    order: styles.length,
  };
  return reindex([...styles, copy]);
}

export function deleteStyle(styles: UserStyle[], id: string): UserStyle[] {
  return reindex(styles.filter((style) => style.id !== id));
}

export function moveStyle(styles: UserStyle[], id: string, direction: -1 | 1): UserStyle[] {
  const ordered = sortStyles(styles);
  const index = ordered.findIndex((style) => style.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return ordered;
  const next = ordered.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next.map((style, order) => ({ ...style, order }));
}

export function restoreBuiltins(styles: UserStyle[]): UserStyle[] {
  const custom = styles.filter((style) => !style.builtIn);
  return reindex([...builtinStyles(), ...custom]);
}

export function pixelsForAspect(aspectId: AspectId): { width: number; height: number } {
  return FRAME_PIXELS[aspectId] ?? FRAME_PIXELS.wallpaper;
}

export function aspectComposition(aspectId: string): string {
  const known = aspectById(aspectId);
  return known.composition;
}

export function snapSize(value: number, min = 512, max = 1536): number {
  const rounded = Math.round(value / 8) * 8;
  return Math.max(min, Math.min(max, rounded));
}

export function clampSteps(value: number): number {
  return Math.max(1, Math.min(50, Math.round(value)));
}

export function clampCfg(value: number): number {
  const next = Math.round(value * 10) / 10;
  return Math.max(1, Math.min(20, next));
}

export function clampCount(value: number): number {
  return Math.max(1, Math.min(4, Math.round(value)));
}

export function cleanLoras(loras: LoraSpec[]): LoraSpec[] {
  return loras
    .map((lora) => ({
      ...lora,
      name: lora.name.trim(),
      weight: Math.max(0, Math.min(2, Number(lora.weight) || 0)),
    }))
    .filter((lora) => lora.name.length > 0);
}

export type Bundle = { version: 1; styles: UserStyle[]; wildcards: Wildcard[]; templates: PromptTemplate[] };

function isStyle(value: unknown): value is UserStyle {
  if (!value || typeof value !== 'object') return false;
  const style = value as UserStyle;
  return typeof style.id === 'string' && typeof style.name === 'string' && typeof style.prefix === 'string' && typeof style.suffix === 'string';
}

export function exportBundle(library: Library): string {
  const bundle: Bundle = {
    version: 1,
    styles: sortStyles(library.styles),
    wildcards: library.wildcards,
    templates: library.templates,
  };
  return JSON.stringify(bundle, null, 2);
}

export function parseBundle(raw: string): { ok: true; bundle: Bundle } | { ok: false; error: string } {
  if (raw.length > 1_000_000) return { ok: false, error: 'That file is too large to import.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'That is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'The file has no style list.' };
  const record = parsed as Partial<Bundle>;
  if (!Array.isArray(record.styles) || !record.styles.every(isStyle)) {
    return { ok: false, error: 'The file needs a styles array.' };
  }
  return {
    ok: true,
    bundle: {
      version: 1,
      styles: record.styles,
      wildcards: Array.isArray(record.wildcards) ? record.wildcards.filter((item) => item && typeof item.token === 'string') : [],
      templates: Array.isArray(record.templates) ? record.templates.filter((item) => item && typeof item.name === 'string' && typeof item.prompt === 'string') : [],
    },
  };
}

export function mergeLibrary(current: Library, bundle: Bundle): Library {
  const styles = [...current.styles];
  for (const style of bundle.styles) {
    const index = styles.findIndex((item) => item.id === style.id);
    if (index >= 0) styles[index] = style;
    else styles.push(style);
  }
  const wildcards = [...current.wildcards];
  for (const card of bundle.wildcards) {
    const index = wildcards.findIndex((item) => item.id === card.id || item.token === card.token);
    if (index >= 0) wildcards[index] = card;
    else wildcards.push(card);
  }
  const templates = [...current.templates];
  for (const template of bundle.templates) {
    const index = templates.findIndex((item) => item.id === template.id);
    if (index >= 0) templates[index] = template;
    else templates.push(template);
  }
  return { styles: reindex(styles), wildcards, templates };
}

export function replaceLibrary(bundle: Bundle): Library {
  return {
    styles: reindex(bundle.styles.length ? bundle.styles : builtinStyles()),
    wildcards: bundle.wildcards,
    templates: bundle.templates,
  };
}
