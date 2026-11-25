import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/AppBar';
import { StatusPanel } from '@/components/StatusPanel';
import { CAST_ROUTE } from '@/src/lib/routes';
import { colors, font } from '@/src/theme';

const CHIPS = [
  { id: 'characters', label: 'Characters' },
  { id: 'recent', label: 'Recent' },
  { id: 'models', label: 'Models' },
  { id: '3d', label: '3D' },
  { id: 'offline', label: 'Offline' },
];

export default function HomeScreen() {
  const params = useLocalSearchParams<{ panel?: string }>();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBar dot={colors.faint} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <StatusPanel preview={typeof params.panel === 'string' ? params.panel : ''} />
        <Pressable testID="home-create" style={styles.go} onPress={() => router.push('/(tabs)/create')}>
          <Text style={styles.goText}>Create</Text>
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {CHIPS.map((chip) => (
            <Pressable
              key={chip.id}
              testID={`chip-${chip.id}`}
              style={styles.chip}
              onPress={() => {
                if (chip.id === 'characters') router.push('/(tabs)/shelf');
                if (chip.id === 'models') router.push('/(tabs)/explore');
                if (chip.id === '3d') router.push(CAST_ROUTE);
                if (chip.id === 'offline') router.push('/offline');
                if (chip.id === 'recent') router.push('/shorts');
              }}>
              <Text style={styles.chipText}>{chip.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Pictures are made on Create.</Text>
          <Text style={styles.body}>Home is for cloud status and getting around. Open Create to write a prompt and draw.</Text>
        </View>
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
  shorts: { color: colors.accent, fontFamily: font.black, fontSize: 15 },
});
