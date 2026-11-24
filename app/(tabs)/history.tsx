import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FrameGrid } from '@/components/FrameGrid';
import { ago } from '@/src/lib/id';
import { confirmAction } from '@/src/lib/confirm';
import { aspectById, styleById } from '@/src/lib/presets';
import { patchGenerator } from '@/src/lib/genstore';
import { useStudio } from '@/src/studio';
import { router } from 'expo-router';
import { colors, font } from '@/src/theme';

export default function HistoryScreen() {
  const { history, clearHistory, deleteGeneration, openViewer, remix } = useStudio();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>On this phone</Text>
            <Text style={styles.title}>History</Text>
          </View>
          {history.length ? (
            <Pressable
              onPress={() => {
                void (async () => {
                  const ok = await confirmAction(
                    'Clear history?',
                    'Every saved frame on this phone is deleted. This cannot be undone.',
                    'Clear',
                  );
                  if (ok) await clearHistory();
                })();
              }}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          ) : null}
        </View>

        {history.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyMark}>✿</Text>
            <Text style={styles.emptyTitle}>No frames yet.</Text>
            <Text style={styles.body}>Draw something on Create and it stays here until you clear it.</Text>
          </View>
        ) : (
          history.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.meta}>
                    {item.styleName || styleById(item.styleId).label} · {aspectById(item.aspectId).label} ·{' '}
                    {item.source === 'salad' ? 'Salad' : item.source === 'openai' ? 'OpenAI' : 'Demo'}
                    {item.seeds?.length ? ` · seed ${item.seeds.join(', ')}` : item.seed != null ? ` · seed ${item.seed}` : ''}
                  </Text>
                  <Text style={styles.prompt} numberOfLines={3}>
                    {item.finalPrompt || item.userPrompt || item.characterName || 'Character sheet'}
                  </Text>
                </View>
                <Pressable accessibilityLabel="Delete this drawing" hitSlop={8} onPress={() => void deleteGeneration(item.id)}>
                  <Ionicons name="close" size={18} color={colors.faint} />
                </Pressable>
              </View>
              <FrameGrid
                uris={item.imageUris}
                aspectId={item.aspectId}
                onPress={(index) =>
                  openViewer({
                    images: item.imageUris,
                    index,
                    prompt: item.finalPrompt || item.enhancedPrompt || item.userPrompt,
                    title: item.characterName || item.styleName || 'Yume',
                    filename: `yume-${item.id}-${index + 1}.png`,
                  })
                }
              />
              <View style={styles.cardHead}>
                <Text style={styles.when}>
                  {ago(item.createdAt)}
                  {item.characterName ? ` · ${item.characterName}` : ''}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    remix(item);
                    router.navigate('/');
                  }}>
                  <Text style={styles.remix}>Remix</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    const seed = item.seeds?.[0] ?? item.seed;
                    if (seed == null) return;
                    patchGenerator({ seed: String(seed), seedRandom: false });
                    router.navigate('/(tabs)/create');
                  }}>
                  <Text style={styles.remix}>Reuse seed</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { padding: 16, gap: 14, paddingBottom: 32 },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  kicker: {
    color: colors.sakura,
    fontFamily: font.black,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  clear: { color: colors.danger, fontFamily: font.black, fontSize: 14, paddingBottom: 6 },
  empty: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    padding: 20,
    gap: 6,
  },
  emptyMark: { fontSize: 28, color: colors.sakura },
  emptyTitle: { color: colors.text, fontFamily: font.black, fontSize: 18 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 15, lineHeight: 21 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    gap: 8,
  },
  cardHead: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  meta: { color: colors.sakura, fontFamily: font.bold, fontSize: 12 },
  prompt: { color: colors.text, fontFamily: font.semibold, fontSize: 15, lineHeight: 20 },
  when: { color: colors.faint, fontFamily: font.semibold, fontSize: 12, flex: 1 },
  remix: { color: colors.sakura, fontFamily: font.black, fontSize: 14 },
});
