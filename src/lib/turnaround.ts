import { characterClause } from '@/src/lib/prompt';
import type { Character, ProviderId } from '@/src/lib/types';

export type TurnaroundAngle = 'front' | 'three-quarter' | 'side' | 'three-quarter-back' | 'back' | 'face';

export type ExpressionId = 'happy' | 'angry' | 'sad' | 'surprised' | 'sleepy' | 'determined';

export const TURNAROUND_ANGLES: { id: TurnaroundAngle; label: string; wording: string; optional?: boolean }[] = [
  { id: 'front', label: 'Front', wording: 'full-body front view, facing the viewer, weight even on both feet' },
  { id: 'three-quarter', label: '3/4 front', wording: 'full-body three-quarter view, turned slightly, both eyes still visible' },
  { id: 'side', label: 'Side', wording: 'full-body exact side profile, facing left, one eye visible' },
  { id: 'three-quarter-back', label: '3/4 back', wording: 'full-body three-quarter view from behind, looking over one shoulder' },
  { id: 'back', label: 'Back', wording: 'full-body view directly from behind, back of the hair and clothes, face hidden' },
  { id: 'face', label: 'Face', wording: 'close-up of the face from the front, from the shoulders up', optional: true },
];

export const EXPRESSION_POSES: { id: ExpressionId; label: string; wording: string }[] = [
  { id: 'happy', label: 'Happy', wording: 'a bright happy smile' },
  { id: 'angry', label: 'Angry', wording: 'an angry expression, lowered brows' },
  { id: 'sad', label: 'Sad', wording: 'a sad expression, a small frown' },
  { id: 'surprised', label: 'Surprised', wording: 'a surprised expression, wide eyes' },
  { id: 'sleepy', label: 'Sleepy', wording: 'a sleepy expression, half-closed eyes' },
  { id: 'determined', label: 'Determined', wording: 'a determined expression' },
];

const LOCK = 'same character design, consistent hair and clothes, no text, no letters';

export function anglesFor(includeFace: boolean): typeof TURNAROUND_ANGLES {
  return TURNAROUND_ANGLES.filter((angle) => includeFace || !angle.optional);
}

export function viewPrompt(character: Character, wording: string, extra = ''): string {
  const base = characterClause({ ...character, pose: '' });
  return [base, wording, extra.trim(), LOCK].filter(Boolean).join('. ');
}

export function expressionPrompt(character: Character, expressionId: ExpressionId): string {
  const pose = EXPRESSION_POSES.find((item) => item.id === expressionId);
  const next = { ...character, expression: pose?.wording ?? expressionId, pose: 'portrait' };
  return viewPrompt(next, 'front view, head and shoulders');
}

const COLORS: { word: string; id?: string }[] = [
  { word: 'pink', id: 'pink' },
  { word: 'red', id: 'crimson' },
  { word: 'blue', id: 'blue' },
  { word: 'black', id: 'black' },
  { word: 'white', id: 'white' },
  { word: 'silver', id: 'silver' },
  { word: 'blonde', id: 'blonde' },
  { word: 'brown', id: 'chestnut' },
  { word: 'green' },
  { word: 'gold', id: 'gold' },
  { word: 'purple' },
];

export function applyInstruction(character: Character, instruction: string): { character: Character; summary: string } {
  const text = instruction.trim().replace(/\s+/g, ' ');
  if (!text) return { character, summary: 'Write what to change.' };
  const lower = text.toLowerCase();
  const next: Character = { ...character, notes: text, updatedAt: Date.now() };
  const changes: string[] = [];

  if (/\b(longer hair|hair longer|make .{0,12}hair longer)\b/.test(lower)) {
    next.hairStyle = 'long';
    changes.push('Hair is now long');
  } else if (/\b(shorter hair|hair shorter|bob)\b/.test(lower)) {
    next.hairStyle = 'bob';
    changes.push('Hair is now a short bob');
  } else if (/\btwin tails|twintails|pigtails\b/.test(lower)) {
    next.hairStyle = 'twintails';
    changes.push('Hair is now twin tails');
  }

  const color = COLORS.find((item) => new RegExp(`\\b${item.word}\\b`).test(lower));
  if (color && /\bhair\b/.test(lower) && !/\b(longer|shorter)\b/.test(lower)) {
    next.hairColor = color.id ?? color.word;
    changes.push(`Hair color is now ${color.word}`);
  }
  if (color && /\b(jacket|coat|cape|hoodie|outfit|clothes|dress|kimono|armor)\b/.test(lower)) {
    const garment = lower.match(/\b(jacket|coat|cape|hoodie|outfit|clothes|dress|kimono|armor)\b/)?.[1] ?? 'outfit';
    next.outfit = `a ${color.word} ${garment}`;
    changes.push(`Outfit is now a ${color.word} ${garment}`);
  }
  if (color && /\beyes?\b/.test(lower)) {
    next.eyeColor = color.id ?? color.word;
    changes.push(`Eyes are now ${color.word}`);
  }

  const summary = changes.length
    ? `${changes.join('. ')}. The pictures will be drawn again with those words.`
    : 'Saved that note on the character. The pictures will be drawn again with those words.';
  return { character: next, summary };
}

export function consistencyNote(provider: ProviderId, model: string): string {
  if (provider === 'demo') {
    return 'Demo studio uses the same character description and the same seed for every angle. It does not copy pixels from the front view, so this is a drawing guide, not a 3D turn.';
  }
  if (provider === 'salad') {
    return 'Salad keeps one seed. After the front view, the other angles are img2img from that front picture, so the design stays closer. It is still not a 3D model. IP-Adapter is used only when the server was started with YUME_IP_ADAPTER.';
  }
  if (model === 'gpt-image-1') {
    return 'OpenAI draws the front view, then edits that image for the other angles. Edits follow the words and can still drift. OpenAI does not use the numeric seed.';
  }
  return 'dall-e-3 cannot edit an existing image. Each angle is a new picture from the same character description, so the design can drift.';
}

export type TurnaroundView = {
  angle: TurnaroundAngle;
  label: string;
  prompt: string;
  imageUri: string;
};

export type TurnaroundVersion = {
  id: string;
  createdAt: number;
  note: string;
  views: TurnaroundView[];
  sheetUri: string;
  character: Character;
};

export type ExpressionCell = {
  id: ExpressionId;
  label: string;
  prompt: string;
  imageUri: string;
};

export type TurnaroundBook = {
  characterId: string;
  seed: number;
  versions: TurnaroundVersion[];
  expressions?: ExpressionCell[];
  expressionSheetUri?: string;
};

export function undoVersion(book: TurnaroundBook): TurnaroundBook | null {
  if (book.versions.length < 2) return null;
  return { ...book, versions: book.versions.slice(1) };
}
