import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { AppBar } from '@/components/AppBar';
import { StatusPanel } from '@/components/StatusPanel';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

const CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'characters', label: 'Characters' },
  { id: 'recent', label: 'Recent' },
  { id: 'models', label: 'Models' },
  { id: '3d', label: '3D' },
  { id: 'offline', label: 'Offline' },
];

export default function HomeScreen() {
  const studio = useStudio();
  const params = useLocalSearchParams<{ panel?: string }>();
  const frames = studio.history;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBar dot={colors.faint} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <StatusPanel preview={typeof params.panel === 'string' ? params.panel : ''} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {CHIPS.map((chip) => (
            <Pressable
              key={chip.id}
              testID={`chip-${chip.id}`}
              style={styles.chip}
              onPress={() => {
                if (chip.id === 'characters') router.push('/(tabs)/shelf');
                if (chip.id === 'models') router.push('/(tabs)/explore');
                if (chip.id === '3d') router.push('/(tabs)/cast');
                if (chip.id === 'offline') router.push('/offline');
                if (chip.id === 'recent') router.push('/shorts');
              }}>
              <Text style={styles.chipText}>{chip.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {frames.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing in the feed yet.</Text>
            <Text style={styles.body}>Create a picture and it shows up here like a channel, with the prompt as the title.</Text>
            <Pressable style={styles.go} onPress={() => router.push('/(tabs)/create')}>
              <Text style={styles.goText}>Create</Text>
            </Pressable>
          </View>
        ) : (
          frames.map((item) => (
            <Pressable key={item.id} style={styles.card} onPress={() => router.push({ pathname: '/watch', params: { id: item.id } })}>
              <Image source={{ uri: item.imageUris[0] }} style={styles.thumb} contentFit="cover" />
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.finalPrompt || item.userPrompt}
              </Text>
              <Text style={styles.meta}>
                {item.styleName} · {item.width}×{item.height}
              </Text>
              <View style={styles.menu}>
                <Text style={styles.menuText} onPress={() => studio.remix(item)}>
                  Remix
                </Text>
                <Text style={styles.menuText} onPress={() => router.push({ pathname: '/watch', params: { id: item.id } })}>
                  Open
                </Text>
              </View>
            </Pressable>
          ))
        )}
        <Pressable onPress={() => router.push('/shorts')}>
          <Text style={styles.shorts}>Shorts-style browse</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 12, gap: 12, paddingBottom: 32 },
  chips: { gap: 8 },
  chip: { backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: colors.text, fontFamily: font.bold, fontSize: 13 },
  empty: { backgroundColor: colors.card, borderRadius: 12, padding: 16, gap: 8 },
  emptyTitle: { color: colors.text, fontFamily: font.black, fontSize: 18 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  go: { alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  goText: { color: '#fff', fontFamily: font.black },
  card: { gap: 6 },
  thumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: colors.card },
  cardTitle: { color: colors.text, fontFamily: font.black, fontSize: 16 },
  meta: { color: colors.faint, fontFamily: font.semibold, fontSize: 12 },
  menu: { flexDirection: 'row', gap: 16 },
  menuText: { color: colors.cyan, fontFamily: font.black, fontSize: 13 },
  shorts: { color: colors.accent, fontFamily: font.black, fontSize: 15 },
});
