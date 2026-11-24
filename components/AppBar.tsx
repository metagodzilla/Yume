import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { counts } from '@/src/lib/queue';
import { useQueue } from '@/src/lib/queuestore';
import { colors, font } from '@/src/theme';

export function AppBar({ dot }: { dot?: string }) {
  const queue = useQueue();
  const total = counts(queue);
  const badge = total.running + total.waiting + total.paused;
  return (
    <View style={styles.bar}>
      <Text style={styles.logo}>Yume</Text>
      <View style={styles.actions}>
        <View style={[styles.dot, { backgroundColor: dot ?? colors.faint }]} />
        <Pressable testID="bell" onPress={() => router.push('/(tabs)/queue')} hitSlop={8}>
          <Text style={styles.icon}>Queue{badge ? ` ${badge}` : ''}</Text>
        </Pressable>
        <Pressable testID="avatar" onPress={() => router.push('/(tabs)/settings')} hitSlop={8}>
          <Text style={styles.icon}>You</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  logo: { color: colors.text, fontFamily: font.logo, fontSize: 22 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  icon: { color: colors.text, fontFamily: font.black, fontSize: 13 },
});
