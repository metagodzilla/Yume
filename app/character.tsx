import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChipField } from '@/components/ChipField';
import { confirmAction } from '@/src/lib/confirm';
import { blankCharacter } from '@/src/lib/id';
import { TRAIT_GROUPS } from '@/src/lib/presets';
import { characterClause, characterSummary } from '@/src/lib/prompt';
import { useStudio } from '@/src/studio';
import type { Character, TraitKey } from '@/src/lib/types';
import { colors, font } from '@/src/theme';

export default function CharacterScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const studio = useStudio();
  const [draft, setDraft] = useState<Character | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studio.ready || draft) return;
    const existing = studio.characters.find((character) => character.id === id);
    setDraft(existing ? { ...existing } : blankCharacter());
  }, [studio.ready, studio.characters, id, draft]);

  if (!draft) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.kicker}>Casting</Text>
      </SafeAreaView>
    );
  }

  const editingSaved = studio.characters.some((character) => character.id === draft.id && character.saved);
  const summary = characterSummary(draft);

  function setTrait(key: TraitKey, value: string) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function useCharacter() {
    if (!characterClause(draft!)) {
      setError('Pick at least one trait so the character can be drawn.');
      return;
    }
    await studio.commitCharacter(draft!);
    router.back();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.kicker}>{editingSaved ? 'Edit character' : 'New character'}</Text>
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.preview}>
          <Text style={styles.previewKicker}>Casting sheet</Text>
          <TextInput
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name })}
            placeholder="Name, just for you"
            placeholderTextColor={colors.faint}
            style={styles.name}
          />
          <Text style={styles.summary}>{summary || 'Pick a few traits and the sheet fills itself in.'}</Text>
          <Text style={styles.private}>The name stays on this phone. Traits are what get drawn.</Text>
        </View>

        {TRAIT_GROUPS.map((group) => (
          <ChipField
            key={group.key}
            label={group.label}
            options={group.options}
            value={draft[group.key]}
            onChange={(value) => setTrait(group.key, value)}
            customPlaceholder={group.custom}
          />
        ))}

        <View style={styles.saveRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.saveTitle}>Keep in my cast</Text>
            <Text style={styles.private}>
              {draft.saved ? 'They show up on Cast and can be reused.' : 'Use once. They will not be listed.'}
            </Text>
          </View>
          <Switch
            value={draft.saved}
            onValueChange={(saved) => setDraft({ ...draft, saved })}
            trackColor={{ false: '#3a2a44', true: colors.sakuraDeep }}
            thumbColor={colors.text}
          />
        </View>

        {editingSaved ? (
          <Pressable
            onPress={() => {
              void (async () => {
                const ok = await confirmAction(
                  `Remove ${draft.name || 'this character'}?`,
                  'Drawings you already made stay in History.',
                  'Remove',
                );
                if (!ok) return;
                await studio.deleteCharacter(draft.id);
                router.back();
              })();
            }}>
            <Text style={styles.danger}>Remove from cast</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.use} onPress={() => void useCharacter()}>
          <Text style={styles.useText}>{draft.saved ? 'Save and use' : 'Use once'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  kicker: {
    color: colors.sakura,
    fontFamily: font.black,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  flex: { flex: 1 },
  scroll: { padding: 16, gap: 16, paddingBottom: 28 },
  preview: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 6,
  },
  previewKicker: {
    color: colors.faint,
    fontFamily: font.black,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  name: {
    color: colors.text,
    fontFamily: font.logo,
    fontSize: 26,
    paddingVertical: 4,
  },
  summary: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  private: { color: colors.faint, fontFamily: font.semibold, fontSize: 12, lineHeight: 17 },
  saveRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  saveTitle: { color: colors.text, fontFamily: font.black, fontSize: 16 },
  danger: { color: colors.danger, fontFamily: font.black, fontSize: 14 },
  footer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  error: { color: colors.danger, fontFamily: font.bold, fontSize: 13 },
  use: {
    backgroundColor: colors.sakura,
    borderRadius: 999,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  useText: { color: colors.ink, fontFamily: font.black, fontSize: 16 },
});
