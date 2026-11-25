import { Platform } from 'react-native';

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

export async function pickLocalImage(): Promise<{ bytes: Uint8Array; name: string } | null> {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        void file.arrayBuffer().then((buffer) => resolve({ bytes: new Uint8Array(buffer), name: file.name }));
      };
      input.click();
    });
  }
  const ImagePicker = await import('expo-image-picker');
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Allow photo access to choose a picture.');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if (!asset.base64) throw new Error('That photo had no pixel data.');
  return { bytes: base64ToBytes(asset.base64), name: asset.fileName || 'photo.jpg' };
}
