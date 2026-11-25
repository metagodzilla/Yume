import { base64ToBytes, bytesToBase64 } from '@/src/lib/base64';
import { blankCharacter } from '@/src/lib/id';
import { isChildTag } from '@/src/lib/measurements';
import { normalizeEndpoint } from '@/src/lib/salad';
import { normalizeSaladKey } from '@/src/lib/saladCloud';
import type { Character } from '@/src/lib/types';

export type Appearance = {
  model: string;
  tags: string[];
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  outfit: string;
  accessories: string;
  body: string;
  adult: boolean;
};

const HAIR = new Set(['black', 'chestnut', 'blonde', 'silver', 'pink', 'blue', 'crimson', 'white']);
const EYES = new Set(['amber', 'blue', 'crimson', 'emerald', 'violet', 'gold', 'mismatch']);
const OUTFITS = new Set(['blazer', 'street', 'coat', 'armor', 'kimono', 'idol', 'hoodie', 'cape']);
const HAIR_STYLE = new Set(['long', 'twintails', 'bob', 'spikes', 'ponytail', 'braids', 'wolf', 'hime']);

export function characterFromAppearance(appearance: Appearance, id?: string): Character {
  const tags = appearance.tags.filter((tag) => !isChildTag(tag));
  const body = appearance.body && !isChildTag(appearance.body) ? appearance.body : '';
  const character = blankCharacter(id);
  character.name = 'From photo';
  character.saved = true;
  character.fromImage = true;
  character.hairColor = HAIR.has(appearance.hairColor) ? appearance.hairColor : '';
  character.hairStyle = HAIR_STYLE.has(appearance.hairStyle) ? appearance.hairStyle : 'long';
  character.eyeColor = EYES.has(appearance.eyeColor) ? appearance.eyeColor : '';
  character.outfit = OUTFITS.has(appearance.outfit) ? appearance.outfit : '';
  character.bodyTags = [...tags, body].filter(Boolean);
  character.notes = appearance.accessories?.trim() ?? '';
  return character;
}

export async function requestAppearance(input: { endpoint: string; apiKey: string; png: Uint8Array }): Promise<Appearance> {
  const endpoint = normalizeEndpoint(input.endpoint);
  const apiKey = normalizeSaladKey(input.apiKey);
  if (!endpoint) throw new Error('Add the Salad gateway on Connect before reading a photo in the cloud.');
  if (!apiKey) throw new Error('Add the Salad API key in Connect before reading a photo in the cloud.');
  const response = await fetch(`${endpoint}/tag`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Api-Key': apiKey,
      'Salad-Api-Key': apiKey,
    },
    body: JSON.stringify({ image: bytesToBase64(input.png) }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(raw.replace(/\s+/g, ' ').slice(0, 240) || 'The cloud could not read that photo.');
  }
  const parsed = JSON.parse(raw) as Appearance;
  if (!parsed || !Array.isArray(parsed.tags)) throw new Error('The tagger answered, but not with appearance tags.');
  return parsed;
}

export const REFERENCE_LIMIT = 6;

export type PickedImage = { bytes: Uint8Array; name: string; width: number; height: number };

export function referenceImages(character: { referenceUri?: string; referenceUris?: string[] }): string[] {
  const listed = (character.referenceUris ?? []).map((uri) => uri.trim()).filter(Boolean);
  const front = character.referenceUri?.trim() ?? '';
  const rest = listed.filter((uri) => uri !== front);
  return [...(front ? [front] : []), ...rest].slice(0, REFERENCE_LIMIT);
}

export function assignReferences<T extends { referenceUri?: string; referenceUris?: string[]; fromImage?: boolean }>(
  character: T,
  uris: string[],
  front?: string,
): T {
  const unique = [...new Set(uris.map((uri) => uri.trim()).filter(Boolean))].slice(0, REFERENCE_LIMIT);
  const chosen = front && unique.includes(front) ? front : unique[0];
  return {
    ...character,
    referenceUris: unique,
    referenceUri: chosen,
    fromImage: unique.length > 0 ? true : character.fromImage,
  };
}

/** Portrait shots and names that say "front" beat wide sheets and side or back names. */
export function pickFrontIndex(images: { width: number; height: number; name: string }[]): number {
  let best = 0;
  let bestScore = -Infinity;
  images.forEach((image, index) => {
    const ratio = image.width > 0 && image.height > 0 ? image.height / image.width : 1;
    const name = image.name.toLowerCase();
    let score = index === 0 ? 0.5 : 0;
    if (ratio >= 1) score += 2;
    if (ratio >= 1.2 && ratio <= 2.2) score += 2;
    if (ratio < 0.8) score -= 2;
    if (name.includes('front')) score += 5;
    if (name.includes('back') || name.includes('side') || name.includes('profile')) score -= 4;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return images.length ? best : 0;
}

export function mergeAppearances(list: Appearance[]): Appearance {
  const tags: string[] = [];
  for (const item of list) {
    for (const tag of item.tags) {
      if (!isChildTag(tag) && tag.trim() && !tags.includes(tag)) tags.push(tag);
    }
  }
  function vote(values: string[], allowed?: Set<string>): string {
    const counts = new Map<string, number>();
    for (const value of values) {
      const text = value.trim();
      if (!text || (allowed && !allowed.has(text))) continue;
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    let best = '';
    let count = 0;
    for (const [value, votes] of counts) {
      if (votes > count) {
        best = value;
        count = votes;
      }
    }
    return best;
  }
  const accessories = [...new Set(list.map((item) => item.accessories.trim()).filter(Boolean))];
  return {
    model: list[0]?.model || 'yume-appearance',
    tags,
    hairColor: vote(list.map((item) => item.hairColor), HAIR),
    hairStyle: vote(list.map((item) => item.hairStyle), HAIR_STYLE) || 'long',
    eyeColor: vote(list.map((item) => item.eyeColor), EYES),
    outfit: vote(list.map((item) => item.outfit), OUTFITS),
    accessories: accessories.join(', '),
    body: vote(list.map((item) => item.body)),
    adult: true,
  };
}

export function applyAppearance(character: Character, appearance: Appearance): Character {
  const tagged = characterFromAppearance(appearance, character.id);
  return {
    ...character,
    name: character.name.trim() ? character.name : tagged.name,
    fromImage: true,
    hairColor: tagged.hairColor || character.hairColor,
    hairStyle: tagged.hairStyle || character.hairStyle,
    eyeColor: tagged.eyeColor || character.eyeColor,
    outfit: tagged.outfit || character.outfit,
    bodyTags: tagged.bodyTags,
    notes: character.notes?.trim() ? character.notes : tagged.notes,
  };
}

async function bytesFromUri(uri: string): Promise<Uint8Array> {
  try {
    const { File } = await import('expo-file-system');
    const file = new File(uri);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length) return bytes;
  } catch {
    // Some Android gallery URIs are not a direct file. Fall through to fetch.
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error('That photo could not be read from the gallery.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error('That photo had no pixel data.');
  return bytes;
}

async function imagesFromAssets(assets: { uri: string; base64?: string | null; fileName?: string | null; width?: number; height?: number }[]): Promise<PickedImage[]> {
  const picked = assets.slice(0, REFERENCE_LIMIT);
  if (!picked.length) throw new Error('The gallery closed without a photo.');
  return Promise.all(
    picked.map(async (asset) => {
      const bytes = asset.base64 ? base64ToBytes(asset.base64) : await bytesFromUri(asset.uri);
      if (!bytes.length) throw new Error('That photo had no pixel data.');
      return { bytes, name: asset.fileName || 'photo.jpg', width: asset.width || 0, height: asset.height || 0 };
    }),
  );
}

export async function pickLocalImages(): Promise<PickedImage[] | null> {
  const { Platform } = await import('react-native');
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/*';
      input.multiple = true;
      input.onchange = () => {
        const files = [...(input.files ?? [])].slice(0, REFERENCE_LIMIT);
        if (!files.length) {
          resolve(null);
          return;
        }
        void Promise.all(
          files.map(async (file) => ({
            bytes: new Uint8Array(await file.arrayBuffer()),
            name: file.name,
            width: 0,
            height: 0,
          })),
        ).then(resolve, reject);
      };
      input.click();
    });
  }
  const ImagePicker = await import('expo-image-picker');
  const options = {
    mediaTypes: ['images'] as ('images')[],
    allowsMultipleSelection: true,
    selectionLimit: REFERENCE_LIMIT,
    quality: 0.5,
    base64: false,
    legacy: false,
    exif: false,
    defaultTab: 'photos' as const,
  };
  // Android 13+ opens the system photo picker with no storage permission.
  // Asking for READ_MEDIA_IMAGES first was the failure on Android 14/15: a denial never opened the gallery.
  if (Platform.OS === 'ios') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted && permission.accessPrivileges !== 'limited') {
      throw new Error('Allow photo access to choose pictures of this character.');
    }
  }
  const started = Date.now();
  let result: Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>;
  try {
    result = await ImagePicker.launchImageLibraryAsync(options);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '';
    if (Platform.OS === 'android' && /permission/i.test(message)) {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted && permission.accessPrivileges !== 'limited') {
        throw new Error('Allow photo access so the gallery can open, then try From image again.');
      }
      result = await ImagePicker.launchImageLibraryAsync(options);
    } else {
      throw new Error(message || 'The photo gallery did not open.');
    }
  }
  if (result.canceled) {
    if (Date.now() - started < 350) {
      throw new Error('The gallery did not open. Try From image again. This phone can pick photos without extra storage access.');
    }
    return null;
  }
  if (!result.assets?.length) throw new Error('The gallery closed without a photo. Try Add reference images again.');
  return imagesFromAssets(result.assets);
}

/** Recover a pick if Android destroyed the screen while the gallery was open. */
export async function takePendingImages(): Promise<PickedImage[] | null> {
  const { Platform } = await import('react-native');
  if (Platform.OS === 'web') return null;
  const ImagePicker = await import('expo-image-picker');
  const pending = await ImagePicker.getPendingResultAsync();
  if (!pending) return null;
  if ('code' in pending) throw new Error(pending.message || 'The gallery closed before the photos came back.');
  if (pending.canceled || !pending.assets?.length) return null;
  return imagesFromAssets(pending.assets);
}

export async function pickLocalImage(): Promise<{ bytes: Uint8Array; name: string } | null> {
  const picked = await pickLocalImages();
  return picked?.[0] ?? null;
}
