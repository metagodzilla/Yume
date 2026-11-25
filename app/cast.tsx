import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useState } from 'react';

import { confirmAction } from '@/src/lib/confirm';
import { characterFromAppearance, pickLocalImage, requestAppearance } from '@/src/lib/fromImage';
import { characterSummary } from '@/src/lib/prompt';
import { persistPng, readSaladKey } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function CastScreen() {
  const studio = useStudio();
  const { characters, deleteCharacter, selectCharacter, selectedCharacterId, commitCharacter } = studio;
  const saved = characters.filter((character) => character.saved);
  const [tagStatus, setTagStatus] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);

  async function fromImage() {
    setTagError(null);
    setTagStatus(null);
    try {
      const picked = await pickLocalImage();
      if (!picked) return;
      setTagStatus('Reading her appearance…');
      const key = await readSaladKey();
      const appearance = await requestAppearance({
        endpoint: studio.settings.saladEndpoint,
        apiKey: key ?? '',
        png: picked.bytes,
      });
      const character = characterFromAppearance(appearance);
      character.referenceUri = await persistPng(`${character.id}-ref.png`, picked.bytes);
      await commitCharacter(character);
      setTagStatus('Saved to the cast. Add three sizes on her profile if you want.');
      router.push({ pathname: '/character', params: { id: character.id } });
    } catch (caught) {
      setTagStatus(null);
      setTagError(caught instanceof Error ? caught.message : 'That photo could not be read.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
        <Text style={styles.kicker}>Your cast</Text>
        <Text style={styles.title}>Same face, next scene.</Text>
        <Text style={styles.body}>
          Build a character once. Hair, eyes, the coat they always wear. Pick them on Create and Yume keeps the look.
        </Text>
        <View style={styles.actions}>
          <Pressable style={styles.add} onPress={() => router.push('/character')}>
            <Ionicons name="add" size={18} color={colors.ink} />
            <Text style={styles.addText}>New character</Text>
          </Pressable>
          <Pressable testID="from-image" style={styles.addAlt} onPress={() => void fromImage()}>
            <Ionicons name="image-outline" size={18} color={colors.sakura} />
            <Text style={styles.addAltText}>From image</Text>
          </Pressable>
        </View>
        <Text style={styles.body}>From image sends the photo to the cloud tagger and saves her as an adult character.</Text>
        {tagStatus ? <Text style={styles.using}>{tagStatus}</Text> : null}
        {tagError ? <Text style={styles.error}>{tagError}</Text> : null}

        {saved.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyMark}>✿</Text>
            <Text style={styles.emptyTitle}>The cast list is empty.</Text>
            <Text style={styles.body}>A name and a few traits are enough to start.</Text>
          </View>
        ) : (
          saved.map((character) => {
            const on = character.id === selectedCharacterId;
            return (
              <View key={character.id} style={[styles.card, on && styles.cardOn]}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Pressable onPress={() => selectCharacter(character.id)}>
                    <Text style={styles.name}>{character.name}</Text>
                    <Text style={styles.meta}>{characterSummary(character) || 'No traits yet'}</Text>
                    {on ? <Text style={styles.using}>Using on the next drawing</Text> : null}
                  </Pressable>
                <View style={styles.featureRow}>
                  <Pressable
                    testID={`open-turnaround-${character.id}`}
                    accessibilityLabel={`Different views for ${character.name}`}
                    style={styles.feature}
                    onPress={() => router.push({ pathname: '/turnaround', params: { id: character.id } })}>
                    <Text style={styles.turn}>Different views</Text>
                    <Text style={styles.featureHint}>Flat sheet: front, 3/4, side, back</Text>
                  </Pressable>
                  <Pressable
                    testID={`open-mesh-${character.id}`}
                    accessibilityLabel={`3D turnaround for ${character.name}`}
                    style={styles.feature}
                    onPress={() => router.push({ pathname: '/mesh', params: { id: character.id } })}>
                    <Text style={styles.mesh}>3D turnaround</Text>
                    <Text style={styles.featureHint}>Rotating model, separate from the sheet</Text>
                  </Pressable>
                </View>
                </View>
                <Pressable
                  accessibilityLabel={`Edit ${character.name}`}
                  hitSlop={8}
                  onPress={() => router.push({ pathname: '/character', params: { id: character.id } })}>
                  <Ionicons name="create-outline" size={20} color={colors.sakura} />
                </Pressable>
                <Pressable
                  accessibilityLabel={`Remove ${character.name}`}
                  hitSlop={8}
                  onPress={() => {
                    void (async () => {
                      const ok = await confirmAction(
                        `Remove ${character.name}?`,
                        'The sheet is deleted from this phone. Drawings you already made stay in History.',
                        'Remove',
                      );
                      if (ok) await deleteCharacter(character.id);
                    })();
                  }}>
                  <Ionicons name="trash-outline" size={20} color={colors.faint} />
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  kicker: {
    color: colors.sakura,
    fontFamily: font.black,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 15, lineHeight: 21 },
  add: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.sakura,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addText: { color: colors.ink, fontFamily: font.black, fontSize: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addAlt: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.sakura,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addAltText: { color: colors.sakura, fontFamily: font.black, fontSize: 14 },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  featureRow: { gap: 8, marginTop: 8 },
  feature: { gap: 2 },
  featureHint: { color: colors.faint, fontFamily: font.semibold, fontSize: 12 },
  empty: {
    marginTop: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    padding: 20,
    gap: 6,
  },
  emptyMark: { fontSize: 28, color: colors.sakura },
  emptyTitle: { color: colors.text, fontFamily: font.black, fontSize: 18 },
  card: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
  },
  cardOn: { borderColor: colors.sakura },
  name: { color: colors.text, fontFamily: font.black, fontSize: 17 },
  meta: { color: colors.muted, fontFamily: font.semibold, fontSize: 13, lineHeight: 18 },
  using: { color: colors.sakura, fontFamily: font.bold, fontSize: 12 },
  links: { flexDirection: 'row', gap: 14, marginTop: 4 },
  turn: { color: colors.cyan, fontFamily: font.black, fontSize: 13 },
  mesh: { color: colors.gold, fontFamily: font.black, fontSize: 13 },
});
