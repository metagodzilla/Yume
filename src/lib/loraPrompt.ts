/** Each LoRA keeps its own prompt. The phone joins them; the server still receives weights. */

export const MAX_LORAS = 10;

export function loraCapMessage(count: number): string | null {
  return count >= MAX_LORAS ? 'You can use up to 10 LoRAs. Remove one before adding another.' : null;
}

export function splitLoraWords(text: string): string[] {
  return (text || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function wordKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Add trigger words that are not already in the box. */
export function mergeTriggerWords(existing: string, triggers: string[] | undefined): string {
  const next = splitLoraWords(existing);
  const seen = new Set(next.map(wordKey));
  for (const group of triggers ?? []) {
    for (const tag of splitLoraWords(group)) {
      const key = wordKey(tag);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      next.push(tag.trim());
    }
  }
  return next.join(', ');
}

export function loraPromptNote(triggers: string[] | undefined): string | null {
  return mergeTriggerWords('', triggers) ? null : 'This LoRA has no trigger words.';
}

export type LoraPromptBlock = { prompt?: string; enabled?: boolean };

/** Main prompt, then each enabled LoRA prompt, skipping blanks. */
export function assembleLoraPrompts(main: string, loras: LoraPromptBlock[]): string {
  const blocks = [main.trim()];
  for (const lora of loras) {
    if (lora.enabled === false) continue;
    const text = (lora.prompt || '').trim();
    if (text) blocks.push(text);
  }
  return blocks.filter(Boolean).join(', ');
}

export function loraRoundTrip<T extends { name: string; weight: number; prompt?: string; enabled?: boolean; triggers?: string[] }>(loras: T[]): T[] {
  return JSON.parse(JSON.stringify(loras)) as T[];
}

export type LoraKind = 'character' | 'style';
export type RegionLayout = 'side' | 'stack';

export type LoraCard = {
  name: string;
  weight: number;
  prompt?: string;
  enabled?: boolean;
  kind?: LoraKind;
};

export type RegionBox = {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  prompt: string;
  loraName: string;
  loraWeight: number;
};

/** Civitai character tags become Character. Everything else is Style/Other. */
export function detectLoraKind(input: { type?: string; tags?: string[]; name?: string; kind?: string }): LoraKind {
  if (input.kind === 'character' || input.kind === 'style') return input.kind;
  const blob = `${input.type || ''} ${(input.tags || []).join(' ')} ${input.name || ''}`.toLowerCase();
  return /\bcharacter\b/.test(blob) ? 'character' : 'style';
}

export function characterLoras<T extends LoraCard>(loras: T[]): T[] {
  return loras.filter((lora) => lora.kind === 'character' && lora.enabled !== false);
}

export function assignRegions(characters: LoraCard[], layout: RegionLayout = 'side'): RegionBox[] {
  const active = characters.filter((lora) => lora.enabled !== false);
  const count = active.length;
  if (count < 2) return [];
  return active.map((lora, index) => {
    const span = 1 / count;
    const box = layout === 'stack' ? { x: 0, y: index * span, w: 1, h: span } : { x: index * span, y: 0, w: span, h: 1 };
    return {
      index,
      ...box,
      prompt: (lora.prompt || '').trim(),
      loraName: lora.name,
      loraWeight: lora.weight,
    };
  });
}

const triggerCache = new Map<number, string[]>();

export function rememberTriggerWords(versionId: number, words: string[]): void {
  triggerCache.set(versionId, words.filter(Boolean));
}

export function cachedTriggerWords(versionId?: number): string[] | null {
  if (!versionId) return null;
  return triggerCache.has(versionId) ? triggerCache.get(versionId) || [] : null;
}

export async function fetchTrainedWords(versionId: number, token?: string | null): Promise<string[]> {
  const cached = cachedTriggerWords(versionId);
  if (cached) return cached;
  try {
    const { getCivitaiVersion } = await import('@/src/lib/civitai');
    const version = await getCivitaiVersion(versionId, token);
    const words = (version.trainedWords || []).map((word) => word.trim()).filter(Boolean);
    rememberTriggerWords(versionId, words);
    return words;
  } catch {
    return [];
  }
}

/** Two or more characters leave the single-prompt path. One or none stays global. */
export function regionalRequest(loras: LoraCard[], layout: RegionLayout = 'side'): { layout: RegionLayout; regions: RegionBox[] } | null {
  const regions = assignRegions(characterLoras(loras), layout);
  return regions.length >= 2 ? { layout, regions } : null;
}
