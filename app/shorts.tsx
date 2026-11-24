import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function ShortsScreen() {
  const studio = useStudio();
  const [index, setIndex] = useState(0);
  const item = studio.history[index];
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Pressable onPress={() => router.back()}>
        <Text style={styles.link}>Back</Text>
      </Pressable>
      {item ? (
        <Pressable style={styles.stage} onPress={() => setIndex((value) => (value + 1) % studio.history.length)}>
          <Image source={{ uri: item.imageUris[0] }} style={styles.image} contentFit="cover" />
          <Text style={styles.caption}>{item.finalPrompt}</Text>
          <Text style={styles.hint}>Tap for the next picture</Text>
        </Pressable>
      ) : (
        <View style={styles.stage}>
          <Text style={styles.caption}>No pictures to swipe through yet.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  link: { color: colors.cyan, fontFamily: font.black, marginBottom: 8 },
  stage: { flex: 1, justifyContent: 'flex-end' },
  image: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16 },
  caption: { color: colors.text, fontFamily: font.black, fontSize: 18, marginBottom: 8 },
  hint: { color: colors.muted, fontFamily: font.semibold },
});
