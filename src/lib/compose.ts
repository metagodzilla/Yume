import { characterClause } from '@/src/lib/prompt';
import type { AspectId, Character, UserStyle, Wildcard } from '@/src/lib/types';
import { aspectComposition } from '@/src/lib/library';

export function expandWildcards(text: string, wildcards: Wildcard[], rng: () => number = Math.random): string {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const card = wildcards.find((item) => item.token.toLowerCase() === token.toLowerCase());
    if (!card || card.values.length === 0) return match;
    const index = Math.min(card.values.length - 1, Math.floor(rng() * card.values.length));
    return card.values[index] ?? match;
  });
}

export function composePreview(input: {
  userPrompt: string;
  enhance: boolean;
  expandSnippets: boolean;
  style: UserStyle;
  aspectId: AspectId | string;
  character: Character | null;
  wildcards: Wildcard[];
  rng?: () => number;
}): string {
  const scene = input.userPrompt.trim().replace(/\s+/g, ' ');
  let text = scene;
  if (input.enhance) {
    const parts = [input.style.prefix];
    const who = input.character ? characterClause(input.character) : '';
    if (who) parts.push(who);
    if (scene) parts.push(`Scene: ${scene}`);
    parts.push(aspectComposition(input.aspectId), input.style.suffix);
    text = parts.filter(Boolean).join('. ');
  }
  if (input.expandSnippets) text = expandWildcards(text, input.wildcards, input.rng);
  if (text.length > 4000) text = `${text.slice(0, 3997)}...`;
  return text;
}

export function openAISize(model: 'gpt-image-1' | 'dall-e-3', width: number, height: number): string {
  const ratio = width / Math.max(1, height);
  if (model === 'dall-e-3') {
    if (ratio > 1.15) return '1792x1024';
    if (ratio < 0.87) return '1024x1792';
    return '1024x1024';
  }
  if (ratio > 1.15) return '1536x1024';
  if (ratio < 0.87) return '1024x1536';
  return '1024x1024';
}
