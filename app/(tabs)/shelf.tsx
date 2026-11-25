import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/AppBar';
import { Gallery } from '@/components/Gallery';
import { useGenerator } from '@/src/lib/genstore';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function LibraryScreen() {
  const studio = useStudio();
  const gen = useGenerator();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBar />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Library</Text>
        <Text style={styles.heading}>Gallery</Text>
        <Text style={styles.body}>{studio.history.length} saved generations, newest first.</Text>
        <Gallery />
        <Text style={styles.heading}>Characters</Text>
        {studio.characters.filter((item) => item.saved).map((character) => (
          <Pressable key={character.id} onPress={() => router.push({ pathname: '/turnaround', params: { id: character.id } })}>
            <Text style={styles.link}>{character.name || 'Unnamed'}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => router.push('/cast')}>
          <Text style={styles.link}>Cast and 3D</Text>
        </Pressable>
        <Text style={styles.heading}>Installed models</Text>
        {gen.installed.map((item) => (
          <Text key={item.versionId} style={styles.body}>
            {item.isDefault ? 'Default · ' : ''}
            {item.name} · {item.baseModel}
          </Text>
        ))}
        <Pressable onPress={() => router.push('/offline')}>
          <Text style={styles.link}>Offline phone model</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 32 },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  heading: { color: colors.text, fontFamily: font.black, fontSize: 13, textTransform: 'uppercase', marginTop: 8 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 15 },
});
