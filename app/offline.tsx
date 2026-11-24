import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { OFFLINE_MODEL, offlineBlockedReason, profileFor } from '@/src/lib/offline';
import { addJob } from '@/src/lib/queuestore';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function OfflineScreen() {
  const studio = useStudio();
  const [downloaded, setDownloaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const profile = profileFor({ model: 'web', ramGb: 0, qnnPresent: false, gpuPresent: false });
  const blocked = offlineBlockedReason({ modelReady: downloaded, runtime: 'missing' });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Phone</Text>
        <Text style={styles.body}>
          Tuned first for a Galaxy S25 Ultra (SM-S938U, Snapdragon 8 Elite, Hexagon NPU, 12 GB). That phone defaults to 512×768 and 8 steps, and prefers the Hexagon NPU when Qualcomm’s runtime is on the device. Other phones fall back to 512×512. Animagine XL and TRELLIS stay on the cloud.
        </Text>
        <Text style={styles.body}>{OFFLINE_MODEL.note}</Text>
        <Text style={styles.body}>
          This device looks like {profile.name}. Backend {profile.backend}. {profile.warning}
        </Text>
        <Text style={styles.body}>
          Offline model: {OFFLINE_MODEL.name}, about {OFFLINE_MODEL.sizeMb} MB. It is not inside the APK.
        </Text>
        <Pressable
          testID="download-offline"
          style={styles.go}
          onPress={() => {
            addJob('offline-download', `${OFFLINE_MODEL.name} · ${OFFLINE_MODEL.sizeMb} MB`);
            setDownloaded(true);
          }}>
          <Text style={styles.goText}>{downloaded ? 'Download queued' : `Download offline model · ${OFFLINE_MODEL.sizeMb} MB`}</Text>
        </Pressable>
        <ViewRow label="Cloud" on={studio.settings.sourceMode === 'cloud'} onPress={() => studio.updateSettings({ sourceMode: 'cloud' })} />
        <ViewRow label="Phone" on={studio.settings.sourceMode === 'phone'} onPress={() => studio.updateSettings({ sourceMode: 'phone' })} />
        <ViewRow label="Auto" on={studio.settings.sourceMode === 'auto'} onPress={() => studio.updateSettings({ sourceMode: 'auto' })} />
        <Pressable
          testID="offline-generate"
          style={styles.go}
          onPress={() => {
            const reason = offlineBlockedReason({ modelReady: downloaded, runtime: 'missing' });
            setMessage(reason);
            if (!reason) addJob('offline-generate', 'Offline picture');
          }}>
          <Text style={styles.goText}>Generate on this phone</Text>
        </Pressable>
        {message || blocked ? <Text testID="offline-block" style={styles.warn}>{message || blocked}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ViewRow({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={() => void onPress()}>
      <Text style={styles.link}>{on ? '●' : '○'} {label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 16 },
  go: { backgroundColor: colors.accent, borderRadius: 20, alignItems: 'center', paddingVertical: 12 },
  goText: { color: '#fff', fontFamily: font.black },
  warn: { color: colors.amber, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
});
