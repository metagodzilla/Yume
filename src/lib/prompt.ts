import {
  EXPRESSIONS,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  LIGHTING,
  OUTFITS,
  POSES,
  SETTINGS,
  aspectById,
  styleById,
  traitLabel,
  traitPrompt,
} from '@/src/lib/presets';
import { adultTags, bodyShapeTags, isChildTag, measurementLine } from '@/src/lib/measurements';
import type { AspectId, Character, StyleId } from '@/src/lib/types';

const QUALITY =
  'coherent face, clean linework, no watermark, no signature, no logo, no random letters';

export function hairPhrase(color: string, style: string): string {
  const colorText = traitPrompt(HAIR_COLORS, color, (text) => text);
  const styleText = traitPrompt(HAIR_STYLES, style, (text) => text);
  if (colorText && styleText) return `${colorText} hair ${styleText}`;
  if (colorText) return `${colorText} hair`;
  if (styleText) return `hair ${styleText}`;
  return '';
}

/** The character sheet, as a sentence the image model can use. Names stay on device. */
export function characterClause(character: Character): string {
  const hair = hairPhrase(character.hairColor, character.hairStyle);
  const bits = [
    hair ? `with ${hair}` : '',
    traitPrompt(EYE_COLORS, character.eyeColor, (text) => `${text} eyes`),
    traitPrompt(OUTFITS, character.outfit, (text) => `wearing ${text}`),
    traitPrompt(EXPRESSIONS, character.expression, (text) => text),
    traitPrompt(POSES, character.pose, (text) => text),
    traitPrompt(SETTINGS, character.setting, (text) => `in ${text}`),
    traitPrompt(LIGHTING, character.lighting, (text) => `under ${text}`),
    character.notes?.trim() ?? '',
  ].filter(Boolean);
  const shape = [...bodyShapeTags(character.measurements), ...(character.bodyTags ?? [])].filter((tag) => !isChildTag(tag));
  if (!bits.length && !shape.length) return '';
  return `Character: an anime character ${[...bits, ...shape, ...adultTags()].join(', ')}`;
}

export function characterSummary(character: Character): string {
  const parts = [
    traitLabel(HAIR_COLORS, character.hairColor),
    traitLabel(HAIR_STYLES, character.hairStyle),
    traitLabel(EYE_COLORS, character.eyeColor),
    traitLabel(OUTFITS, character.outfit),
    traitLabel(EXPRESSIONS, character.expression),
    traitLabel(POSES, character.pose),
    traitLabel(SETTINGS, character.setting),
    traitLabel(LIGHTING, character.lighting),
  ].filter(Boolean);
  const sizes = measurementLine(character.measurements);
  if (sizes) parts.push(sizes);
  return parts.join(' · ');
}

export function buildEnhancedPrompt(input: {
  userPrompt: string;
  styleId: StyleId;
  aspectId: AspectId;
  character: Character | null;
}): string {
  const style = styleById(input.styleId);
  const aspect = aspectById(input.aspectId);
  const parts = [style.lead];
  const who = input.character ? characterClause(input.character) : '';
  if (who) parts.push(who);
  const scene = input.userPrompt.trim().replace(/\s+/g, ' ');
  if (scene) parts.push(`Scene: ${scene}`);
  parts.push(aspect.composition, style.finish, QUALITY);
  let text = parts.join('. ');
  if (text.length > 3800) text = `${text.slice(0, 3797)}...`;
  return text;
}
