import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { installReleaseApk } from '@/src/lib/installApk';
import { checkGithubRelease } from '@/src/lib/updates';
import { APP_VERSION, APP_VERSION_CODE } from '@/src/lib/version';
import { colors, font } from '@/src/theme';

export function UpdateCheck() {
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState('Update');
  const [detail, setDetail] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const result = await checkGithubRelease(APP_VERSION, APP_VERSION_CODE);
    setAvailable(Boolean(result.apkUrl));
    setDetail(result.bad ? result.label : result.apkUrl ? result.label : result.label === 'Up to date' ? null : result.label);
    return result;
  }

  useEffect(() => {
    void refresh().catch(() => setDetail('Could not check for updates.'));
  }, []);

  async function onPress() {
    if (busy) return;
    setBusy(true);
    setLabel('Checking…');
    try {
      const result = await refresh();
      if (result.apkUrl) {
        setLabel('Installing…');
        await installReleaseApk(result.apkUrl);
        setLabel('Update');
        setDetail('The installer is open. Allow installs from Yume if Android asks.');
      } else {
        setLabel('Update');
        setDetail(result.label);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The update could not be installed.';
      setLabel('Update');
      setDetail(message);
      setAvailable(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 6 }]}>
      <Pressable testID="check-updates" onPress={() => void onPress()} style={styles.button} hitSlop={8}>
        <Text style={styles.text}>{label}</Text>
        {available ? <View testID="update-badge" style={styles.badge} /> : null}
      </Pressable>
      {detail ? (
        <Text testID="update-status" style={styles.detail}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 10, zIndex: 40, alignItems: 'flex-end', maxWidth: 220 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f4f4f4', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  text: { color: '#161616', fontFamily: font.black, fontSize: 13 },
  badge: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sakura },
  detail: { marginTop: 6, color: colors.text, fontFamily: font.semibold, fontSize: 12, lineHeight: 16, textAlign: 'right' },
});
