import type { StudioStyleId } from '@/src/lib/animeStudio';
import { baseFamily, type BaseFamily } from '@/src/lib/checkpoints';
import type { Character } from '@/src/lib/types';

/** Longer everyday phrases first. Tags are emitted in the order the phrase appears. */
const PHRASES: [RegExp, string[]][] = [
  [/\btaking a selfie\b|\btakes a selfie\b|\bselfie\b/i, ['selfie', 'holding phone']],
  [/\bin her room\b|\bin his room\b|\bin their room\b|\bin the room\b|\bbedroom\b/i, ['bedroom', 'indoors']],
  [/\bschool uniform\b|\bschoolgirl\b|\bschool girl\b/i, ['school uniform']],
  [/\bcat ?girl\b|\bcatgirl\b/i, ['cat ears', 'cat girl']],
  [/\bholding a phone\b|\bholding phone\b|\bwith a phone\b|\bphone\b/i, ['holding phone']],
  [/\bpink hair\b|\bhair (is |that's |that is )?pink\b/i, ['pink hair']],
  [/\bblue hair\b/i, ['blue hair']],
  [/\bred hair\b/i, ['red hair']],
  [/\bblack hair\b/i, ['black hair']],
  [/\bblonde hair\b|\bblond hair\b/i, ['blonde hair']],
  [/\bwhite hair\b|\bsilver hair\b/i, ['white hair']],
  [/\bbrown hair\b/i, ['brown hair']],
  [/\bgreen hair\b/i, ['green hair']],
  [/\bpurple hair\b/i, ['purple hair']],
  [/\blong hair\b/i, ['long hair']],
  [/\bshort hair\b/i, ['short hair']],
  [/\btwin tails\b|\btwintails\b/i, ['twintails']],
  [/\bponytail\b/i, ['ponytail']],
  [/\bblue eyes\b/i, ['blue eyes']],
  [/\bred eyes\b/i, ['red eyes']],
  [/\bgreen eyes\b/i, ['green eyes']],
  [/\bgolden eyes\b|\bgold eyes\b/i, ['yellow eyes']],
  [/\bpink eyes\b/i, ['pink eyes']],
  [/\bheterochromia\b|\bmismatched eyes\b/i, ['heterochromia']],
  [/\b(two|2)\s+girls\b|\bgirls\b/i, ['2girls']],
  [/\b(three|3)\s+girls\b/i, ['3girls']],
  [/\b(two|2)\s+boys\b|\bboys\b/i, ['2boys']],
  [/\b(a|the|one|1)\s+girl\b|\bgirl\b|\bwoman\b|\bmaiden\b|\blady\b/i, ['1girl', 'solo']],
  [/\b(a|the|one|1)\s+boy\b|\bboy\b|\bman\b/i, ['1boy', 'solo']],
  [/\blooking at (the )?(viewer|camera|you)\b/i, ['looking at viewer']],
  [/\bfrom behind\b/i, ['from behind']],
  [/\blooking back\b/i, ['looking back']],
  [/\bsitting\b/i, ['sitting']],
  [/\bstanding\b/i, ['standing']],
  [/\brunning\b/i, ['running']],
  [/\bjumping\b/i, ['jumping']],
  [/\blying\b|\blying down\b/i, ['lying']],
  [/\bsmile\b|\bsmiling\b/i, ['smile']],
  [/\bschool\b/i, ['school uniform']],
  [/\bskirt\b/i, ['skirt']],
  [/\bdress\b/i, ['dress']],
  [/\bkimono\b/i, ['kimono']],
  [/\bhoodie\b/i, ['hoodie']],
  [/\bjacket\b/i, ['jacket']],
  [/\barmor\b|\barmour\b/i, ['armor']],
  [/\bsword\b/i, ['sword', 'holding sword']],
  [/\bshrine\b/i, ['shrine', 'torii']],
  [/\bclassroom\b/i, ['classroom', 'indoors']],
  [/\bkitchen\b/i, ['kitchen', 'indoors']],
  [/\bcafe\b|\bcoffee shop\b/i, ['cafe', 'indoors']],
  [/\bbeach\b/i, ['beach', 'outdoors']],
  [/\bforest\b/i, ['forest', 'outdoors']],
  [/\bcity\b/i, ['city']],
  [/\brooftop\b/i, ['rooftop', 'outdoors']],
  [/\boutdoors\b|\boutside\b/i, ['outdoors']],
  [/\bindoors\b|\binside\b/i, ['indoors']],
  [/\brain\b|\brainy\b/i, ['rain']],
  [/\bnight\b/i, ['night']],
  [/\bsunset\b|\bgolden hour\b/i, ['sunset']],
  [/\bmoonlight\b|\bmoon\b/i, ['moonlight']],
  [/\bneon\b/i, ['neon lights']],
  [/\bcandle\b/i, ['candlelight']],
  [/\bflower\b|\bblossom\b/i, ['flower']],
];

const FAMILY_DETAIL: Record<BaseFamily, string[]> = {
  Illustrious: ['detailed eyes', 'detailed face', 'anime coloring'],
  SDXL: ['detailed eyes', 'detailed face', 'anime coloring'],
  Pony: ['source_anime', 'detailed eyes'],
  NoobAI: ['newest', 'detailed eyes', 'anime coloring'],
  'SD 1.5': ['detailed face', 'anime'],
  Flux: ['highly detailed', 'cinematic lighting'],
  Other: ['detailed face'],
};

const STYLE_COMPOSITION: Record<string, string[]> = {
  anime: ['looking at viewer', 'upper body'],
  chibi: ['simple background'],
  shonen: ['dynamic angle', 'action pose'],
  shojo: ['soft lighting', 'blush'],
  webtoon: ['straight-on'],
  off: ['looking at viewer'],
};

const HAIR_COLOR: Record<string, string> = {
  black: 'black hair',
  chestnut: 'brown hair',
  blonde: 'blonde hair',
  silver: 'white hair',
  pink: 'pink hair',
  blue: 'blue hair',
  crimson: 'red hair',
  white: 'white hair',
};
const HAIR_STYLE: Record<string, string> = {
  long: 'long hair',
  twintails: 'twintails',
  bob: 'bob cut',
  spikes: 'messy hair',
  ponytail: 'ponytail',
  braids: 'braid',
  wolf: 'wolf cut',
  hime: 'hime cut',
};
const EYE: Record<string, string> = {
  amber: 'amber eyes',
  blue: 'blue eyes',
  crimson: 'red eyes',
  emerald: 'green eyes',
  violet: 'purple eyes',
  gold: 'yellow eyes',
  mismatch: 'heterochromia',
};
const OUTFIT: Record<string, string> = {
  blazer: 'school uniform',
  street: 'jacket',
  coat: 'coat',
  armor: 'armor',
  kimono: 'kimono',
  idol: 'idol',
  hoodie: 'hoodie',
  cape: 'cape',
};
const EXPRESSION: Record<string, string> = { smile: 'smile', determined: 'determined', shy: 'shy', fierce: 'serious', sleepy: 'sleepy', surprised: 'surprised', serene: 'expressionless' };
const POSE: Record<string, string> = { standing: 'standing', leap: 'jumping', sitting: 'sitting', glance: 'looking back', portrait: 'portrait', running: 'running' };
const SETTING: Record<string, string> = { blossoms: 'cherry blossoms', rooftop: 'rooftop', shrine: 'shrine', classroom: 'classroom', forest: 'forest', platform: 'train station', stars: 'starry sky', bedroom: 'bedroom' };
const LIGHT: Record<string, string> = { golden: 'sunset', neon: 'neon lights', overcast: 'overcast', moon: 'moonlight', rim: 'rim lighting', candle: 'candlelight' };

function known(table: Record<string, string>, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return table[trimmed] ?? '';
}

function pushUnique(tags: string[], seen: Set<string>, next: string[]) {
  for (const tag of next) {
    const clean = tag.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    if ((key === '1girl' || key === 'solo') && (seen.has('2girls') || seen.has('3girls'))) continue;
    if (key === '1boy' && seen.has('2boys')) continue;
    seen.add(key);
    tags.push(clean);
  }
}

/** Everyday sentence to Danbooru tags. Same words always produce the same tags. */
export function describeToTags(text: string): string {
  const hits: { index: number; tags: string[] }[] = [];
  for (const [pattern, tags] of PHRASES) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const expression = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = expression.exec(text))) {
      hits.push({ index: match.index, tags });
      if (match[0].length === 0) break;
    }
  }
  hits.sort((left, right) => left.index - right.index || left.tags[0].localeCompare(right.tags[0]));
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) pushUnique(tags, seen, hit.tags);
  return tags.join(', ');
}

/** Detail, lighting, composition, and character tags that are not already in the converted prompt. */
export function supportTags(input: {
  text: string;
  baseModel?: string;
  style?: StudioStyleId | string;
  character?: Character | null;
}): string {
  const described = describeToTags(input.text);
  const seen = new Set(described.split(', ').map((tag) => tag.toLowerCase()).filter(Boolean));
  const tags: string[] = [];
  const person = /\b(1girl|1boy|2girls|2boys|3girls)\b/.test(described);
  const character = input.character;
  if (character) {
    pushUnique(tags, seen, [
      known(HAIR_COLOR, character.hairColor),
      known(HAIR_STYLE, character.hairStyle),
      known(EYE, character.eyeColor),
      known(OUTFIT, character.outfit),
      known(EXPRESSION, character.expression),
      known(POSE, character.pose),
      known(SETTING, character.setting),
      known(LIGHT, character.lighting),
    ]);
  }
  if (person || character) pushUnique(tags, seen, STYLE_COMPOSITION[input.style || 'off'] ?? STYLE_COMPOSITION.off);
  if (input.text.trim() || character) pushUnique(tags, seen, FAMILY_DETAIL[baseFamily(input.baseModel || '')]);
  return tags.join(', ');
}

/** 1.5.4 Positive stays Positive. Extra starts empty. An older Extra with no Positive becomes Positive. */
export function settleSavedPrompts(parsed: { positive?: string; extraPrompt?: string; positiveAuto?: boolean; promptAuto?: boolean }): {
  positive: string;
  extraPrompt: string;
  positiveAuto: boolean;
  promptAuto: boolean;
} {
  const storedPositive = typeof parsed.positive === 'string' ? parsed.positive : '';
  const legacyExtra = typeof parsed.extraPrompt === 'string' ? parsed.extraPrompt : '';
  const positive = storedPositive.trim() ? storedPositive : legacyExtra;
  const positiveAuto = typeof parsed.positiveAuto === 'boolean' ? parsed.positiveAuto : !positive.trim();
  const promptAuto = typeof parsed.promptAuto === 'boolean' ? parsed.promptAuto : true;
  return { positive, extraPrompt: '', positiveAuto, promptAuto };
}
