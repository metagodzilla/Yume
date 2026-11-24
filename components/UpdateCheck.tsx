import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeUpdateError, downloadLabel } from '@/src/lib/apkInstall';
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
  const generation = useRef(0);

  async function refresh() {
    const mine = ++generation.current;
    const result = await checkGithubRelease(APP_VERSION, APP_VERSION_CODE);
    if (mine !== generation.current) return result;
    setAvailable(Boolean(result.apkUrl));
    return result;
  }

  useEffect(() => {
    const mine = ++generation.current;
    void checkGithubRelease(APP_VERSION, APP_VERSION_CODE)
      .then((result) => {
        if (mine !== generation.current) return;
        setAvailable(Boolean(result.apkUrl));
        setDetail(result.label);
      })
      .catch(() => {
        if (mine === generation.current) setDetail('Could not check for updates.');
      });
  }, []);

  async function onPress() {
    if (busy) return;
    setBusy(true);
    setLabel('Checking...');
    setDetail('Checking...');
    try {
      const result = await refresh();
      if (result.apkUrl) {
        setLabel('Downloading');
        setDetail('Downloading 0%');
        await installReleaseApk(result.apkUrl, (progress) => {
          const percent = progress.totalBytes > 0 ? Math.min(100, Math.round((progress.bytesWritten / progress.totalBytes) * 100)) : null;
          setLabel(percent == null ? 'Downloading' : `${percent}%`);
          setDetail(downloadLabel(progress));
        });
        setLabel('Update');
        setDetail('The installer is open.');
      } else {
        setLabel('Update');
        setDetail(result.label);
      }
    } catch (caught) {
      setLabel('Update');
      setDetail(describeUpdateError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 6 }]}>
        <Pressable
          testID="check-updates"
          onPressIn={() => {
            if (busy) return;
            setLabel('Checking...');
            setDetail('Checking...');
          }}
          onPress={() => void onPress()}
          style={styles.button}
          hitSlop={8}
        >
          <Text style={styles.text}>{label}</Text>
          {available ? <View testID="update-badge" style={styles.badge} /> : null}
        </Pressable>
      </View>
      {detail ? (
        <Text pointerEvents="none" testID="update-status" style={[styles.detail, { top: insets.top + 48 }]}>
          {detail}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 10, zIndex: 40, alignItems: 'flex-end' },
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f4f4f4', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  text: { color: '#161616', fontFamily: font.black, fontSize: 13 },
  badge: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sakura },
  detail: { position: 'absolute', right: 10, zIndex: 40, maxWidth: 180, color: colors.text, fontFamily: font.semibold, fontSize: 12, lineHeight: 16, textAlign: 'right' },
});
