import type { StudioStyleId } from '@/src/lib/animeStudio';
import { baseFamily, type BaseFamily } from '@/src/lib/checkpoints';
import { isChildTag } from '@/src/lib/measurements';
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
  [/\blooking at (the )?(viewer|camera|you)\b/i, ['looking at viewer']],
  [/\bkiss(?:ing|es|ed)?\b/i, ['kiss']],
  [/\b(?:touching|grabbing|groping|fondling|squeezing|caressing)(?:\s+(?:her|his|their|the|a))?\s+breasts?\b/i, ['breast grab']],
  [/\bclose-?up\b/i, ['close-up']],
  [/\bfull body\b/i, ['full body']],
  [/\bupper body\b/i, ['upper body']],
  [/\bportrait\b/i, ['portrait']],
  [/\bfrom above\b/i, ['from above']],
  [/\bfrom below\b/i, ['from below']],
  [/\bfrom (the )?side\b|\bprofile\b/i, ['from side']],
  [/\bcinematic lighting\b/i, ['cinematic lighting']],
  [/\bsoft lighting\b/i, ['soft lighting']],
  [/\bdramatic lighting\b/i, ['dramatic lighting']],
  [/\bcherry blossoms?\b/i, ['cherry blossoms']],
  [/\bwalking\b/i, ['walking']],
  [/\bkneeling\b/i, ['kneeling']],
  [/\bleaning\b/i, ['leaning']],
  [/\bdancing\b/i, ['dancing']],
  [/\bgrinning\b|\bgrin\b/i, ['grin']],
  [/\bblush(?:ing)?\b/i, ['blush']],
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
  [/\b(?:completely |fully )?nude\b|\bnaked\b|\bno clothes\b|\bwithout clothes\b/i, ['nude']],
  [/\btopless\b/i, ['topless']],
  [/\bbottomless\b/i, ['bottomless']],
  [/\bswimsuit\b|\bbikini\b/i, ['swimsuit']],
  [/\bunderwear\b|\blingerie\b|\bpanties\b|\bbra\b/i, ['underwear']],
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

export type NamedPerson = {
  name: string;
  triggers?: string[];
  tags?: string[];
  /** Cast characters and character LoRAs are women unless this says boy. */
  gender?: 'girl' | 'boy';
};

const STOP = new Set(
  'a an the and with or of to in on at for from by her his their she he they them him it its this that into onto over under while then just very really who whom whose there here as if but so be being been have has had do does did can could would should will not no yes also too up down out off about around near beside during via per is are was were'.split(
    ' ',
  ),
);

const NOT_NAMES = new Set(
  [...STOP, 'girl', 'girls', 'boy', 'boys', 'man', 'men', 'woman', 'women', 'lady', 'maiden', 'another', 'one', 'two', 'three', 'four', 'five', 'six', 'taking', 'take', 'takes', 'looking', 'sitting', 'standing', 'holding', 'wearing', 'kissing', 'kiss', 'touching', 'walking', 'running', 'smiling', 'smile', 'pink', 'red', 'blue', 'green', 'black', 'white', 'blonde', 'blond', 'brown', 'purple', 'silver', 'grey', 'gray', 'orange', 'yellow', 'crimson', 'golden', 'gold'],
);

const COLORS = 'red|blue|green|pink|black|white|blonde|blond|brown|purple|silver|grey|gray|orange|yellow|crimson|golden|gold';
const COLOR_OBJECTS = 'hair|eyes|dress|dresses|skirt|shirt|jacket|hoodie|ribbon|scarf|hat|shoes|gloves|coat|cape|kimono|armor|armour|flower|sky|background|nails|lips|boots|pants|shorts|sweater|blouse|suit|tie|bow|wings|tail|horns|bikini|swimsuit|socks|uniform';

const CLOTHES = /\b(dress|dresses|shirt|shirts|skirt|skirts|swimsuit|swimwear|bikini|uniform|nude|naked|topless|bottomless|underwear|panties|bra|lingerie|shoes?|boots?|socks?|stockings|thighhighs|hats?|caps?|jewelry|jewellery|necklace|earrings?|glasses|sunglasses|hoodie|jacket|kimono|armou?r|coat|cape|gloves?|pants|trousers|shorts|sweater|blouse|suit|tie|scarf|scarves|leotard|bodysuit|apron|collar|choker|crown|tiara|veil|belt|clothes|clothing|outfit|costume)\b/i;
const COUNT_TAG = /^(?:[1-5]girls?|[1-5]boys?|6\+girls|6\+boys|solo|hetero)$/i;

type Span = {
  start: number;
  end: number;
  rank: number;
  tags: string[];
  girls?: number;
  boys?: number;
  nameKey?: string;
  breast?: boolean;
};

export function characterPromptTags(character: Character): string[] {
  return [
    known(HAIR_COLOR, character.hairColor),
    known(HAIR_STYLE, character.hairStyle),
    known(EYE, character.eyeColor),
    known(EXPRESSION, character.expression),
    known(POSE, character.pose),
    known(SETTING, character.setting),
    known(LIGHT, character.lighting),
    ...(character.bodyTags ?? []),
  ].filter((tag) => tag && !isChildTag(tag) && !isClothesTag(tag));
}

export function namedPeople(input: {
  characters?: Character[];
  loras?: { name?: string; triggers?: string[]; type?: string }[];
}): NamedPerson[] {
  const people: NamedPerson[] = [];
  for (const character of input.characters ?? []) {
    const name = character.name.trim();
    if (!name) continue;
    people.push({ name, tags: characterPromptTags(character), gender: 'girl' });
  }
  for (const lora of input.loras ?? []) {
    if (lora.type && !/lora/i.test(lora.type)) continue;
    const name = (lora.name || '').replace(/\.safetensors$/i, '').trim();
    if (!name) continue;
    people.push({ name, triggers: lora.triggers, gender: /\b(boy|man|male)\b/i.test(name) ? 'boy' : 'girl' });
  }
  return people;
}

export function splitTagList(text: string): string[] {
  return (text || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** Keep tags the user added by hand. Tags from the previous auto-fill are replaced by the new description. */
export function keepManualTags(generated: string, current: string, previousAuto = '', mode: 'auto' | 'edited' = 'auto'): string {
  const next = splitTagList(generated);
  const seen = new Set(next.map((tag) => tag.toLowerCase()));
  const basisText = previousAuto.trim() ? previousAuto : mode === 'auto' ? current : '';
  const basis = new Set(splitTagList(basisText).map((tag) => tag.toLowerCase()));
  for (const tag of splitTagList(current)) {
    const key = tag.toLowerCase();
    if (seen.has(key) || basis.has(key) || isChildTag(tag)) continue;
    seen.add(key);
    next.push(tag);
  }
  return next.join(', ');
}

function nameMatches(word: string, name: string): boolean {
  const left = word.toLowerCase();
  const right = name.toLowerCase().replace(/\.safetensors$/i, '');
  if (left === right) return true;
  const head = right.split(/[-_\s]/)[0] ?? '';
  return head.length >= 3 && head === left;
}

function countLabel(count: number, one: string, many: string): string | null {
  if (count <= 0) return null;
  if (count === 1) return one;
  if (count >= 6) return `6+${many}`;
  return `${count}${many}`;
}

function cleanChunk(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9+\-\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (words.length && STOP.has(words[0]!)) words.shift();
  while (words.length && STOP.has(words[words.length - 1]!)) words.pop();
  const phrase = words.join(' ').replace(/\s+/g, ' ').trim();
  if (!phrase || STOP.has(phrase) || isChildTag(phrase)) return '';
  return phrase;
}

function addPattern(found: Span[], text: string, pattern: RegExp, build: (match: RegExpExecArray) => Omit<Span, 'start' | 'end'>) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const expression = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = expression.exec(text))) {
    if (!match[0]) break;
    found.push({ start: match.index, end: match.index + match[0].length, ...build(match) });
  }
}

function acceptSpans(found: Span[]): Span[] {
  found.sort((left, right) => right.end - right.start - (left.end - left.start) || left.rank - right.rank || left.start - right.start);
  const taken: Span[] = [];
  for (const span of found) {
    if (taken.some((other) => span.start < other.end && other.start < span.end)) continue;
    taken.push(span);
  }
  return taken.sort((left, right) => left.start - right.start || left.rank - right.rank);
}

/** Everyday sentence to Danbooru tags. Known phrases are mapped. Everything else is kept. */
export function describeToTags(text: string, people: NamedPerson[] = []): string {
  const source = text.replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const found: Span[] = [];
  const sortedPeople = [...people].sort((left, right) => right.name.length - left.name.length);
  for (const person of sortedPeople) {
    const token = person.name.trim();
    if (token.length < 2) continue;
    const head = token.split(/[-_\s(]+/)[0] ?? '';
    if (head.length < 2) continue;
    addPattern(found, source, new RegExp(`\\b${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), (match) => ({
      rank: 0,
      tags: [],
      girls: person.gender === 'boy' ? 0 : 1,
      boys: person.gender === 'boy' ? 1 : 0,
      nameKey: match[0].toLowerCase(),
    }));
  }
  const personRules: { pattern: RegExp; girls?: number; boys?: number; tags?: string[] }[] = [
    { pattern: /\b(?:six|6)\s+(?:girls|women)\b/i, girls: 6 },
    { pattern: /\b(?:five|5)\s+(?:girls|women)\b/i, girls: 5 },
    { pattern: /\b(?:four|4)\s+(?:girls|women)\b/i, girls: 4 },
    { pattern: /\b(?:three|3)\s+(?:girls|women)\b/i, girls: 3 },
    { pattern: /\b(?:two|2)\s+(?:girls|women)\b/i, girls: 2 },
    { pattern: /\bschoolgirls\b/i, girls: 2, tags: ['school uniform'] },
    { pattern: /\b(?:girls|women)\b/i, girls: 2 },
    { pattern: /\b(?:a|the|one|1|another)\s+(?:(?:young|little|small|teen)\s+)?(?:girl|woman|lady|maiden)\b/i, girls: 1 },
    { pattern: /\bschool\s*girl\b/i, girls: 1, tags: ['school uniform'] },
    { pattern: /\b(?:girl|woman|lady|maiden)\b/i, girls: 1 },
    { pattern: /\b(?:six|6)\s+(?:boys|men)\b/i, boys: 6 },
    { pattern: /\b(?:five|5)\s+(?:boys|men)\b/i, boys: 5 },
    { pattern: /\b(?:four|4)\s+(?:boys|men)\b/i, boys: 4 },
    { pattern: /\b(?:three|3)\s+(?:boys|men)\b/i, boys: 3 },
    { pattern: /\b(?:two|2)\s+(?:boys|men)\b/i, boys: 2 },
    { pattern: /\b(?:boys|men)\b/i, boys: 2 },
    { pattern: /\b(?:a|the|one|1|another)\s+(?:boy|man)\b/i, boys: 1 },
    { pattern: /\b(?:boy|man)\b/i, boys: 1 },
  ];
  for (const rule of personRules) {
    addPattern(found, source, rule.pattern, () => ({ rank: 1, tags: rule.tags ?? [], girls: rule.girls, boys: rule.boys }));
  }
  for (const [pattern, tags] of PHRASES) {
    addPattern(found, source, pattern, (match) => ({ rank: 2, tags, breast: /\bbreasts?\b/i.test(match[0]) }));
  }
  addPattern(found, source, /\briding (?:a |an |the )?[a-z0-9-]+\b/i, (match) => ({ rank: 2, tags: [cleanChunk(match[0]) || match[0].toLowerCase()] }));
  addPattern(found, source, /\b(?:pleated|mini|plaid|checkered|striped|frilled)\s+(?:skirt|dress|shirt|shorts|socks|pants)\b/i, (match) => ({
    rank: 2,
    tags: [match[0].toLowerCase()],
  }));
  addPattern(found, source, new RegExp(`\\b(${COLORS})\\s+(${COLOR_OBJECTS})\\b`, 'i'), (match) => {
    const rawColor = match[1]!.toLowerCase();
    const color = rawColor === 'blond' ? 'blonde' : rawColor === 'grey' ? 'gray' : rawColor;
    const object = match[2]!.toLowerCase().replace(/dresses$/, 'dress').replace('armour', 'armor');
    const eyes = object === 'eyes' && (color === 'gold' || color === 'golden') ? 'yellow' : color === 'crimson' && object === 'eyes' ? 'red' : color;
    return { rank: 2, tags: [`${eyes} ${object}`] };
  });
  addPattern(found, source, /\b(?:she|her)\b/i, () => ({ rank: 3, tags: [], nameKey: 'pronoun-girl' }));
  addPattern(found, source, /\b(?:he|him|his)\b/i, () => ({ rank: 3, tags: [], nameKey: 'pronoun-boy' }));

  const spans = acceptSpans(found);
  const covered = spans.map((span) => ({ start: span.start, end: span.end }));
  const namePattern = /\b[A-Z][a-zA-Z'-]{1,}\b/g;
  let nameMatch: RegExpExecArray | null;
  while ((nameMatch = namePattern.exec(source))) {
    const word = nameMatch[0];
    if (NOT_NAMES.has(word.toLowerCase())) continue;
    if (covered.some((span) => nameMatch!.index < span.end && span.start < nameMatch!.index + word.length)) continue;
    spans.push({ start: nameMatch.index, end: nameMatch.index + word.length, rank: 0, tags: [word.toLowerCase()], girls: 1, nameKey: word.toLowerCase() });
    covered.push({ start: nameMatch.index, end: nameMatch.index + word.length });
  }
  spans.sort((left, right) => left.start - right.start || left.rank - right.rank);

  let girls = 0;
  let boys = 0;
  let firstPerson = Number.POSITIVE_INFINITY;
  let breastAt = -1;
  const seenNames = new Set<string>();
  const hits: { index: number; rank: number; tags: string[] }[] = [];
  for (const span of spans) {
    if (span.nameKey === 'pronoun-girl') {
      if (girls === 0) {
        girls += 1;
        firstPerson = Math.min(firstPerson, span.start);
      }
      continue;
    }
    if (span.nameKey === 'pronoun-boy') {
      if (boys === 0) {
        boys += 1;
        firstPerson = Math.min(firstPerson, span.start);
      }
      continue;
    }
    if (span.nameKey && seenNames.has(span.nameKey)) {
      hits.push({ index: span.start, rank: 2, tags: span.tags });
      continue;
    }
    if (span.nameKey) seenNames.add(span.nameKey);
    if (span.girls || span.boys) {
      const matched = span.nameKey ? sortedPeople.filter((person) => nameMatches(span.nameKey!, person.name)) : [];
      const triggerTags = matched.flatMap((person) => splitTagList((person.triggers ?? []).join(','))).filter((tag) => !COUNT_TAG.test(tag));
      const extra = matched.flatMap((person) => person.tags ?? []);
      const label = span.tags.length ? span.tags : triggerTags.length ? [] : span.nameKey ? [span.nameKey] : [];
      const emitted = [...triggerTags, ...label, ...extra].filter((tag) => !COUNT_TAG.test(tag) && !isChildTag(tag));
      if (emitted.length) hits.push({ index: span.start, rank: 0, tags: emitted });
      girls += span.girls ?? (matched.some((person) => person.gender !== 'boy') ? 1 : 0);
      boys += span.boys ?? (matched.length && matched.every((person) => person.gender === 'boy') ? 1 : 0);
      if ((span.girls ?? 0) > 0 || (span.boys ?? 0) > 0 || matched.length) firstPerson = Math.min(firstPerson, span.start);
    } else if (span.tags.length) {
      hits.push({ index: span.start, rank: 2, tags: span.tags.filter((tag) => !isChildTag(tag)) });
    }
    if (span.breast) breastAt = span.start;
  }

  const masked = source.split('');
  for (const span of spans) {
    for (let index = span.start; index < span.end && index < masked.length; index += 1) masked[index] = '\n';
  }
  const maskedText = masked.join('');
  const splitter = /,|\.(?=\s|$)|\band\b|\bwith\b|\bwhile\b|\bwearing\b|\bin\b|\bon\b|\bat\b|\bunder\b|\bover\b|\bbeside\b|\bnear\b|\bby\b/gi;
  let cursor = 0;
  let split: RegExpExecArray | null;
  const chunks: { start: number; text: string }[] = [];
  while ((split = splitter.exec(maskedText))) {
    chunks.push({ start: cursor, text: maskedText.slice(cursor, split.index) });
    cursor = split.index + split[0].length;
  }
  chunks.push({ start: cursor, text: maskedText.slice(cursor) });
  for (const chunk of chunks) {
    const phrase = cleanChunk(chunk.text);
    if (phrase) hits.push({ index: chunk.start, rank: 4, tags: [phrase] });
  }

  const countTags = [countLabel(girls, '1girl', 'girls'), countLabel(boys, '1boy', 'boys')].filter((tag): tag is string => Boolean(tag));
  if (girls + boys === 1) countTags.push('solo');
  if (girls > 0 && boys > 0) countTags.push('hetero');
  if (countTags.length && Number.isFinite(firstPerson)) hits.push({ index: firstPerson, rank: 1, tags: countTags });
  if (breastAt >= 0 && girls > 0 && boys > 0) hits.push({ index: breastAt, rank: 3, tags: ["grabbing another's breast"] });

  hits.sort((left, right) => left.index - right.index || left.rank - right.rank);
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) pushUnique(tags, seen, hit.tags);
  if (girls + boys > 1) {
    const withoutSolo = tags.filter((tag) => tag.toLowerCase() !== 'solo');
    return withoutSolo.join(', ');
  }
  return tags.join(', ');
}

export function isClothesTag(tag: string): boolean {
  return CLOTHES.test(tag.trim());
}

export function splitPromptAndClothes(tags: string): { prompt: string; clothes: string } {
  const prompt: string[] = [];
  const clothes: string[] = [];
  for (const tag of splitTagList(tags)) {
    if (isClothesTag(tag)) clothes.push(tag);
    else prompt.push(tag);
  }
  return { prompt: prompt.join(', '), clothes: clothes.join(', ') };
}

/** Prompt tags and clothing tags from one description. Clothing never stays in the prompt half. */
export function describeParts(text: string, people: NamedPerson[] = []): { prompt: string; clothes: string } {
  return splitPromptAndClothes(describeToTags(text, people));
}

export function characterOutfitTags(character: Character | null | undefined): string[] {
  if (!character) return [];
  const tags: string[] = [];
  const mapped = known(OUTFIT, character.outfit);
  if (mapped) tags.push(mapped);
  else if (character.outfit.trim() && isClothesTag(character.outfit)) tags.push(character.outfit.trim());
  for (const tag of character.bodyTags ?? []) {
    if (isClothesTag(tag)) tags.push(tag);
  }
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Detail, lighting, composition, and character tags that are not already in the converted prompt. */
export function supportTags(input: {
  text: string;
  baseModel?: string;
  style?: StudioStyleId | string;
  character?: Character | null;
  people?: NamedPerson[];
}): string {
  const described = describeToTags(input.text, input.people);
  const seen = new Set(described.split(', ').map((tag) => tag.toLowerCase()).filter(Boolean));
  const tags: string[] = [];
  const person = /\b(?:[1-5]girls?|[1-5]boys?|6\+girls|6\+boys)\b/.test(described);
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
