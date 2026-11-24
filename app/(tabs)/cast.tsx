import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { confirmAction } from '@/src/lib/confirm';
import { characterSummary } from '@/src/lib/prompt';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function CastScreen() {
  const { characters, deleteCharacter, selectCharacter, selectedCharacterId } = useStudio();
  const saved = characters.filter((character) => character.saved);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
        <Text style={styles.kicker}>Your cast</Text>
        <Text style={styles.title}>Same face, next scene.</Text>
        <Text style={styles.body}>
          Build a character once. Hair, eyes, the coat they always wear. Pick them on Create and Yume keeps the look.
        </Text>
        <Pressable style={styles.add} onPress={() => router.push('/character')}>
          <Ionicons name="add" size={18} color={colors.ink} />
          <Text style={styles.addText}>New character</Text>
        </Pressable>

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
              <Pressable
                key={character.id}
                onPress={() => {
                  selectCharacter(character.id);
                  router.navigate('/');
                }}
                style={[styles.card, on && styles.cardOn]}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.name}>{character.name}</Text>
                  <Text style={styles.meta}>{characterSummary(character) || 'No traits yet'}</Text>
                  {on ? <Text style={styles.using}>Using on the next drawing</Text> : null}
                  <View style={styles.links}>
                    <Pressable
                      testID={`open-turnaround-${character.id}`}
                      accessibilityLabel={`Turnaround for ${character.name}`}
                      onPress={() => router.push({ pathname: '/turnaround', params: { id: character.id } })}>
                      <Text style={styles.turn}>Turnaround</Text>
                    </Pressable>
                    <Pressable
                      testID={`open-mesh-${character.id}`}
                      accessibilityLabel={`Make 3D for ${character.name}`}
                      onPress={() => router.push({ pathname: '/mesh', params: { id: character.id } })}>
                      <Text style={styles.mesh}>Make 3D</Text>
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
              </Pressable>
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
