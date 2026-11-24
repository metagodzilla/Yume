import type { AspectId, ModelId, StyleId, TraitKey } from '@/src/lib/types';

export type TraitOption = {
  id: string;
  label: string;
  /** Wording that may be sent to the image API. Keep it generic. */
  prompt: string;
};

export type StylePreset = {
  id: StyleId;
  label: string;
  /** Short UI subtitle. Never copied into the API prompt. */
  note: string;
  blurb: string;
  lead: string;
  finish: string;
  swatch: [string, string, string];
};

export type AspectPreset = {
  id: AspectId;
  label: string;
  hint: string;
  composition: string;
  ratio: number;
  columns: 1 | 2;
  mock: { width: number; height: number };
  sizes: Record<ModelId, string>;
};

/**
 * Display names can mention a familiar reference. The strings in `lead` and
 * `finish` are what the model sees, and those stay generic.
 */
export const STYLES: StylePreset[] = [
  {
    id: 'cel90s',
    label: '90s cel',
    note: 'Saturday morning',
    blurb: 'Bold ink, flat color, hard little shadows.',
    lead: '1990s Japanese cel-animation still, uniform black ink outlines, flat saturated color fills, hard-edged two-tone shadows, slight film grain',
    finish: 'hand-painted background plate, limited shading, classic television anime finish',
    swatch: ['#3a1d6e', '#ff7ab6', '#ffe14a'],
  },
  {
    id: 'modern',
    label: 'Modern TV',
    note: 'Clean and cinematic',
    blurb: 'Tapered lineart, soft gradients, reflective eyes.',
    lead: 'contemporary Japanese television anime still, crisp tapered lineart, soft gradient shading, large reflective eyes, subtle rim light',
    finish: 'polished keyframe, cohesive modern anime palette, gentle depth of field',
    swatch: ['#1a1440', '#ff5ca8', '#7ee7ff'],
  },
  {
    id: 'shonen',
    label: 'Shonen action',
    note: 'Impact frame',
    blurb: 'Low angle, speed, and a hit you can feel.',
    lead: 'dynamic action anime illustration, low heroic camera angle, motion streaks, impact flashes, tense energy, sharp costume folds',
    finish: 'high-contrast action key visual, dramatic foreshortening, wind and debris',
    swatch: ['#1c0a14', '#ff3355', '#ffd166'],
  },
  {
    id: 'shojo',
    label: 'Shojo pastel',
    note: 'Soft sparkle',
    blurb: 'Thin lines, blush, and flower-petal light.',
    lead: 'soft pastel anime illustration, delicate thin linework, airy highlights, tiny sparkles, gentle blush, a quiet romantic mood',
    finish: 'dreamy pastel palette, soft glow, flower-petal light',
    swatch: ['#ffd0ea', '#c9a6ff', '#fff4fb'],
  },
  {
    id: 'chibi',
    label: 'Chibi',
    note: 'Big head, tiny body',
    blurb: 'Simple shapes and maximum cute.',
    lead: 'chibi anime character, oversized head, tiny body, simplified cute features, bold readable shapes, playful proportions',
    finish: 'sticker-like clarity, clean outlines, bright cheerful color',
    swatch: ['#ff9ec8', '#7aa2ff', '#ffe27a'],
  },
  {
    id: 'watercolor',
    label: 'Watercolor',
    note: 'Ghibli-inspired',
    blurb: 'Painterly skies and a world that feels lived in.',
    lead: 'anime illustration with a hand-painted watercolor background, lush plants, soft wind, accumulating clouds, delicate character linework over a painterly environment, quiet everyday wonder',
    finish: 'storybook color, visible paper texture in the distance, airy natural light',
    swatch: ['#8ec8e0', '#f3d2b5', '#7ea36b'],
  },
  {
    id: 'dark',
    label: 'Dark fantasy',
    note: 'Moonlit gothic',
    blurb: 'Stone, candlelight, and a dangerous kind of pretty.',
    lead: 'dark fantasy anime illustration, moody shadows, gothic costume detail, candlelit stone, uneasy beauty',
    finish: 'deep violets and blacks, controlled highlights, intricate fabric',
    swatch: ['#140816', '#6a2a55', '#c9a2ff'],
  },
  {
    id: 'mecha',
    label: 'Mecha',
    note: 'Pilot and machine',
    blurb: 'Panel lines, glass, and a sense of scale.',
    lead: 'anime mecha illustration, readable mechanical design, panel lines, metal and glass, a human pilot integrated with the machine',
    finish: 'crisp industrial detail, cool metallic highlights, sense of scale',
    swatch: ['#071018', '#3a6d86', '#67e8f9'],
  },
  {
    id: 'manga',
    label: 'Manga ink',
    note: 'Black and white',
    blurb: 'Screentone, thick blacks, empty balloon space.',
    lead: 'black and white manga illustration, confident ink lineart, screentone shading, high contrast, no color',
    finish: 'print-ready manga rendering, clean whites, rich blacks',
    swatch: ['#f4f4f6', '#9a9aa3', '#16161a'],
  },
  {
    id: 'novel',
    label: 'Light-novel cover',
    note: 'Room for a title',
    blurb: 'A cover pose with space above the figure.',
    lead: 'light novel cover illustration, polished anime character art, striking pose, dramatic but clean background, empty space near the top where a title could go',
    finish: 'commercial cover finish, crisp face, controlled sparkles, no rendered title text, no letters',
    swatch: ['#241038', '#ff4d8d', '#ffe08a'],
  },
];

export const ASPECTS: AspectPreset[] = [
  {
    id: 'wallpaper',
    label: 'Wallpaper',
    hint: 'Tall lock screen',
    composition:
      'Vertical phone wallpaper composition, edge to edge, no frame, the subject large enough to read on a lock screen',
    ratio: 9 / 16,
    columns: 2,
    mock: { width: 540, height: 960 },
    sizes: { 'gpt-image-1': '1024x1536', 'dall-e-3': '1024x1792' },
  },
  {
    id: 'avatar',
    label: 'Avatar',
    hint: 'Square icon',
    composition:
      'Square character icon, face and shoulders centered, simple background that stays readable at a small size',
    ratio: 1,
    columns: 2,
    mock: { width: 720, height: 720 },
    sizes: { 'gpt-image-1': '1024x1024', 'dall-e-3': '1024x1024' },
  },
  {
    id: 'landscape',
    label: 'Landscape',
    hint: 'Wide scene',
    composition:
      'Wide cinematic anime scene, the environment has room to breathe, subject placed off center',
    ratio: 16 / 9,
    columns: 1,
    mock: { width: 960, height: 540 },
    sizes: { 'gpt-image-1': '1536x1024', 'dall-e-3': '1792x1024' },
  },
  {
    id: 'manga',
    label: 'Manga panel',
    hint: 'One tall panel',
    composition:
      'A single tall manga panel, thin black panel border, a little empty space reserved for a speech balloon, no actual text',
    ratio: 2 / 3,
    columns: 2,
    mock: { width: 600, height: 900 },
    sizes: { 'gpt-image-1': '1024x1536', 'dall-e-3': '1024x1792' },
  },
];

export const HAIR_COLORS: TraitOption[] = [
  { id: 'black', label: 'Black', prompt: 'jet-black' },
  { id: 'chestnut', label: 'Chestnut', prompt: 'warm chestnut' },
  { id: 'blonde', label: 'Honey blonde', prompt: 'honey-blonde' },
  { id: 'silver', label: 'Silver', prompt: 'silver-white' },
  { id: 'pink', label: 'Sakura pink', prompt: 'sakura-pink' },
  { id: 'blue', label: 'Midnight blue', prompt: 'midnight-blue' },
  { id: 'crimson', label: 'Crimson', prompt: 'crimson' },
  { id: 'white', label: 'Snow', prompt: 'snow-white' },
];

export const HAIR_STYLES: TraitOption[] = [
  { id: 'long', label: 'Long straight', prompt: 'worn long and straight' },
  { id: 'twintails', label: 'Twin tails', prompt: 'in long twin tails' },
  { id: 'bob', label: 'Short bob', prompt: 'in a short bob' },
  { id: 'spikes', label: 'Messy spikes', prompt: 'in messy spikes' },
  { id: 'ponytail', label: 'High ponytail', prompt: 'in a high ponytail' },
  { id: 'braids', label: 'Loose braids', prompt: 'in loose braids' },
  { id: 'wolf', label: 'Wolf cut', prompt: 'in a wolf cut' },
  { id: 'hime', label: 'Hime cut', prompt: 'in a hime cut with blunt bangs and long sidelocks' },
];

export const EYE_COLORS: TraitOption[] = [
  { id: 'amber', label: 'Amber', prompt: 'amber eyes' },
  { id: 'blue', label: 'Sea blue', prompt: 'sea-blue eyes' },
  { id: 'crimson', label: 'Crimson', prompt: 'crimson eyes' },
  { id: 'emerald', label: 'Emerald', prompt: 'emerald eyes' },
  { id: 'violet', label: 'Violet', prompt: 'violet eyes' },
  { id: 'gold', label: 'Gold', prompt: 'gold eyes' },
  { id: 'mismatch', label: 'Mismatched', prompt: 'mismatched eyes of two different colors' },
];

export const OUTFITS: TraitOption[] = [
  { id: 'blazer', label: 'School blazer', prompt: 'a tidy school blazer with a ribbon tie' },
  { id: 'street', label: 'Streetwear', prompt: 'layered streetwear with a short jacket and sneakers' },
  { id: 'coat', label: 'Traveler coat', prompt: 'a weathered fantasy traveler coat' },
  { id: 'armor', label: 'Battle armor', prompt: 'ornate battle armor with a cloth sash' },
  { id: 'kimono', label: 'Kimono', prompt: 'a patterned kimono with a wide obi' },
  { id: 'idol', label: 'Stage outfit', prompt: 'a sparkly stage outfit with a short jacket and boots' },
  { id: 'hoodie', label: 'Oversized hoodie', prompt: 'an oversized hoodie and loose trousers' },
  { id: 'cape', label: 'Witch cape', prompt: 'a dark witch cape over a simple dress' },
];

export const EXPRESSIONS: TraitOption[] = [
  { id: 'smile', label: 'Gentle smile', prompt: 'a gentle smile' },
  { id: 'determined', label: 'Determined', prompt: 'a determined look' },
  { id: 'shy', label: 'Shy', prompt: 'a shy expression' },
  { id: 'fierce', label: 'Fierce', prompt: 'a fierce expression' },
  { id: 'sleepy', label: 'Sleepy', prompt: 'a sleepy expression' },
  { id: 'surprised', label: 'Surprised', prompt: 'a surprised expression' },
  { id: 'serene', label: 'Serene', prompt: 'a serene expression' },
];

export const POSES: TraitOption[] = [
  { id: 'standing', label: 'Standing', prompt: 'standing' },
  { id: 'leap', label: 'Mid leap', prompt: 'caught mid leap' },
  { id: 'sitting', label: 'Sitting', prompt: 'sitting' },
  { id: 'glance', label: 'Glance back', prompt: 'glancing back over one shoulder' },
  { id: 'portrait', label: 'Close portrait', prompt: 'in a close portrait from the shoulders up' },
  { id: 'running', label: 'Running', prompt: 'running toward the side of the frame' },
];

export const SETTINGS: TraitOption[] = [
  { id: 'blossoms', label: 'Blossom street', prompt: 'a cherry-blossom street' },
  { id: 'rooftop', label: 'Night rooftop', prompt: 'a night city rooftop' },
  { id: 'shrine', label: 'Shrine courtyard', prompt: 'a shrine courtyard' },
  { id: 'classroom', label: 'Classroom window', prompt: 'beside a classroom window' },
  { id: 'forest', label: 'Mossy forest', prompt: 'a mossy forest' },
  { id: 'platform', label: 'Dusk platform', prompt: 'a train platform at dusk' },
  { id: 'stars', label: 'Starry hill', prompt: 'a starry hillside' },
  { id: 'bedroom', label: 'Quiet bedroom', prompt: 'a quiet bedroom' },
];

export const LIGHTING: TraitOption[] = [
  { id: 'golden', label: 'Golden hour', prompt: 'golden hour light' },
  { id: 'neon', label: 'Neon night', prompt: 'neon night light' },
  { id: 'overcast', label: 'Soft overcast', prompt: 'soft overcast light' },
  { id: 'moon', label: 'Moonlight', prompt: 'moonlight' },
  { id: 'rim', label: 'Rim light', prompt: 'strong rim light' },
  { id: 'candle', label: 'Candlelight', prompt: 'warm candlelight' },
];

export const TRAIT_GROUPS: { key: TraitKey; label: string; options: TraitOption[]; custom: string }[] = [
  { key: 'hairColor', label: 'Hair color', options: HAIR_COLORS, custom: 'Lilac, teal, streaked…' },
  { key: 'hairStyle', label: 'Hair style', options: HAIR_STYLES, custom: 'Undercut, curls, a side braid…' },
  { key: 'eyeColor', label: 'Eyes', options: EYE_COLORS, custom: 'Grey, teal, slit pupils…' },
  { key: 'outfit', label: 'Outfit', options: OUTFITS, custom: 'Rain cloak, pilot suit, apron…' },
  { key: 'expression', label: 'Expression', options: EXPRESSIONS, custom: 'Smirk, tears, a quiet laugh…' },
  { key: 'pose', label: 'Pose', options: POSES, custom: 'Leaning on a rail, hand raised…' },
  { key: 'setting', label: 'Setting', options: SETTINGS, custom: 'Rainy alley, festival stall, shore…' },
  { key: 'lighting', label: 'Lighting', options: LIGHTING, custom: 'Storm light, stage spots, dawn…' },
];

export function styleById(id: string): StylePreset {
  return STYLES.find((style) => style.id === id) ?? STYLES[0];
}

export function aspectById(id: string): AspectPreset {
  return ASPECTS.find((aspect) => aspect.id === id) ?? ASPECTS[0];
}

export function traitLabel(options: TraitOption[], value: string): string {
  if (!value) return '';
  return options.find((option) => option.id === value)?.label ?? value;
}

export function traitPrompt(
  options: TraitOption[],
  value: string,
  custom: (text: string) => string,
): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const known = options.find((option) => option.id === trimmed);
  if (known) return known.prompt;
  return custom(trimmed);
}
