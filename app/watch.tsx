import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { loraPage } from '@/src/lib/civitai';
import { openLink } from '@/src/lib/openLink';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function WatchScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const studio = useStudio();
  const item = studio.history.find((entry) => entry.id === params.id) ?? studio.history[0];
  if (!item) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.body}>That picture is gone.</Text>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Image source={{ uri: item.imageUris[0] }} style={styles.hero} contentFit="cover" />
        <Text style={styles.title}>{item.finalPrompt}</Text>
        <Text style={styles.body}>
          {item.styleName} · {item.steps} steps · {item.sampler} · seed {item.seed ?? '—'}
        </Text>
        <View style={styles.row}>
          <Pressable onPress={() => studio.remix(item)}>
            <Text style={styles.link}>Remix</Text>
          </Pressable>
          <Pressable onPress={() => studio.openViewer({ images: item.imageUris, index: 0, prompt: item.finalPrompt, title: item.styleName, filename: `${item.id}.png` })}>
            <Text style={styles.link}>Save / share</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/cast')}>
            <Text style={styles.link}>Send to 3D</Text>
          </Pressable>
        </View>
        <View style={styles.row}>
          {item.loras.map((lora) => {
            const page = loraPage(lora);
            return (
              <Pressable key={lora.id} onPress={() => openLink(page.url)}>
                <Text style={styles.link}>{page.label === 'Search on Civitai' ? `Search ${lora.name}` : lora.name}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.heading}>Related</Text>
        {studio.history
          .filter((entry) => entry.id !== item.id)
          .slice(0, 4)
          .map((entry) => (
            <Pressable key={entry.id} onPress={() => router.replace({ pathname: '/watch', params: { id: entry.id } })}>
              <Text style={styles.body}>{entry.finalPrompt.slice(0, 80)}</Text>
            </Pressable>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 32 },
  hero: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: colors.card },
  title: { color: colors.text, fontFamily: font.black, fontSize: 18, lineHeight: 24 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  heading: { color: colors.text, fontFamily: font.black, fontSize: 13, textTransform: 'uppercase' },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 15 },
  row: { flexDirection: 'row', gap: 16 },
});
