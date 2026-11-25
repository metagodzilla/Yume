import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { exportBundle } from '@/src/lib/library';
import { learnTaste, suggestedSettings } from '@/src/lib/taste';
import { removeTasteItem, resetTaste, useTasteProfile } from '@/src/lib/tasteStore';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function TasteScreen() {
  const studio = useStudio();
  const taste = useTasteProfile();
  const items = learnTaste(taste);
  const likes = items.filter((item) => item.score > 0);
  const dislikes = items.filter((item) => item.score < 0);
  const suggested = suggestedSettings(taste);
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
        <Text style={styles.title}>My taste</Text>
        <Text style={styles.body}>Likes and dislikes stay on this phone. They never replace the prompt, the character, or the clothes you typed.</Text>
        <Text style={styles.heading}>Likes</Text>
        {likes.length ? likes.map((item) => <Row key={item.key} label={`${item.label} · ${item.score}`} onRemove={() => removeTasteItem(item.key)} />) : <Text style={styles.body}>No likes yet.</Text>}
        <Text style={styles.heading}>Dislikes</Text>
        {dislikes.length ? dislikes.map((item) => <Row key={item.key} label={`${item.label} · ${item.score}`} onRemove={() => removeTasteItem(item.key)} />) : <Text style={styles.body}>No dislikes yet.</Text>}
        <Text style={styles.body}>
          {[suggested.sampler, suggested.steps ? `${suggested.steps} steps` : '', suggested.cfg ? `CFG ${suggested.cfg}` : ''].filter(Boolean).join(' · ') || 'No setting has been liked enough to suggest yet.'}
        </Text>
        <Pressable testID="taste-reset" onPress={() => resetTaste()}><Text style={styles.danger}>Reset all</Text></Pressable>
        <Pressable
          testID="taste-export"
          onPress={() => {
            void Clipboard.setStringAsync(exportBundle(studio.library, taste));
          }}>
          <Text style={styles.link}>Copy backup</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.body}>{label}</Text>
      <Pressable onPress={onRemove}><Text style={styles.link}>Remove</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 40 },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  heading: { color: colors.sakura, fontFamily: font.black, fontSize: 12, textTransform: 'uppercase' },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 14 },
  danger: { color: colors.danger, fontFamily: font.black, fontSize: 14 },
});