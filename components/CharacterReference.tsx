import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { bytesToBase64 } from '@/src/lib/base64';
import { pickLocalImages } from '@/src/lib/fromImage';
import { characterSheetTags, loraForCharacter } from '@/src/lib/framePlan';
import { bodySizeFromHeight, type BodySize } from '@/src/lib/referencePicture';
import { readPng } from '@/src/lib/storage';
import { useGenerator } from '@/src/lib/genstore';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export type ReferencePick = {
  images: string[];
  tags: string;
  clothes: string;
  body: BodySize;
  heightCm: number | null;
  bustCm: number | null;
  hipCm: number | null;
  lora: { name: string; weight: number; versionId?: number } | null;
};

const EMPTY: ReferencePick = { images: [], tags: '', clothes: '', body: 'average', heightCm: null, bustCm: null, hipCm: null, lora: null };

export function CharacterReference({ onChange }: { onChange: (pick: ReferencePick) => void }) {
  const studio = useStudio();
  const gen = useGenerator();
  const [photos, setPhotos] = useState<string[]>([]);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const people = studio.characters.filter((item) => item.saved);

  useEffect(() => {
    const character = people.find((item) => item.id === characterId) ?? null;
    const lora = character ? loraForCharacter(character.name, gen.installed) : null;
    onChange({
      images: photos,
      tags: characterSheetTags(character),
      clothes: character?.clothesPrompt || '',
      body: bodySizeFromHeight(character?.measurements?.heightCm),
      heightCm: character?.measurements?.heightCm ?? null,
      bustCm: character?.measurements?.bustCm ?? null,
      hipCm: character?.measurements?.hipCm ?? null,
      lora: lora ? { name: lora.filename || lora.name, weight: 0.8, versionId: lora.versionId } : null,
    });
    // Only when the pick itself changes. `onChange` is a parent setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, characterId]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Character reference</Text>
      <Pressable
        testID="reference-photos"
        style={styles.chip}
        onPress={() => {
          void (async () => {
            const picked = await pickLocalImages(4, 0.8);
            if (!picked?.length) return;
            setPhotos(picked.map((photo) => bytesToBase64(photo.bytes)));
          })();
        }}>
        <Text style={styles.chipText}>{photos.length ? `${photos.length} reference photos` : 'Add reference photos'}</Text>
      </Pressable>
      <View style={styles.row}>
        {people.map((person) => (
          <Pressable key={person.id} testID={`cast-${person.id}`} onPress={() => void choose(person.id)} style={[styles.chip, characterId === person.id && styles.on]}>
            <Text style={styles.chipText}>{person.name || 'Unnamed'}</Text>
          </Pressable>
        ))}
      </View>
      {characterId ? <Text style={styles.hint}>Her LoRA is used when one installed model matches her name.</Text> : null}
    </View>
  );

  async function choose(id: string) {
    const next = characterId === id ? null : id;
    setCharacterId(next);
    const character = people.find((item) => item.id === next);
    const uris = character?.referenceUris?.length ? character.referenceUris : character?.referenceUri ? [character.referenceUri] : [];
    if (!uris.length) return;
    const encoded: string[] = [];
    for (const uri of uris.slice(0, 4)) {
      encoded.push(bytesToBase64(await readPng(uri)));
    }
    setPhotos(encoded);
  }
}

export { EMPTY as emptyReference };

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 8 },
  on: { borderColor: colors.sakura, backgroundColor: colors.cardAlt },
  chipText: { color: colors.text, fontFamily: font.bold, fontSize: 14 },
  hint: { color: colors.faint, fontFamily: font.semibold, fontSize: 12 },
});
