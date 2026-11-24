import * as Application from 'expo-application';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeUpdateError, downloadLabel } from '@/src/lib/apkInstall';
import { installReleaseApk } from '@/src/lib/installApk';
import { checkGithubRelease, readInstalledVersionCode, type UpdateCheckResult } from '@/src/lib/updates';
import { APP_VERSION, APP_VERSION_CODE } from '@/src/lib/version';
import { colors, font } from '@/src/theme';

function installedName(): string {
  return Application.nativeApplicationVersion || APP_VERSION;
}

function installedCode(): number {
  return readInstalledVersionCode(Application.nativeBuildVersion, APP_VERSION_CODE);
}

function statusLines(result: UpdateCheckResult, error?: string | null): string {
  const checked = new Date(result.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const latest = result.latestVersion ? `${result.latestVersion}${result.latestCode != null ? ` (${result.latestCode})` : ''}` : 'unknown';
  return [`Installed ${installedName()} (${installedCode()})`, `Latest ${latest}`, `Checked ${checked}`, error || result.label].join('\n');
}

export function UpdateCheck() {
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState('Update');
  const [detail, setDetail] = useState('Checking...');
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const busyRef = useRef(false);

  async function refresh(force: boolean) {
    const mine = ++generation.current;
    const result = await checkGithubRelease(installedName(), installedCode(), fetch, { force });
    if (mine !== generation.current) return result;
    setAvailable(Boolean(result.apkUrl));
    setDetail(statusLines(result));
    return result;
  }

  useEffect(() => {
    void refresh(true);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !busyRef.current) void refresh(true);
    });
    return () => sub.remove();
  }, []);

  async function onPress() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setLabel('Checking...');
    setDetail('Checking...');
    try {
      const result = await refresh(true);
      if (result.bad) {
        setLabel('Update');
        setDetail(statusLines(result, result.label));
        return;
      }
      if (result.apkUrl) {
        setLabel('Downloading');
        setDetail('Downloading 0%');
        await installReleaseApk(result.apkUrl, (progress) => {
          const percent = progress.totalBytes > 0 ? Math.min(100, Math.round((progress.bytesWritten / progress.totalBytes) * 100)) : null;
          setLabel(percent == null ? 'Downloading' : `${percent}%`);
          setDetail(downloadLabel(progress));
        });
        setLabel('Update');
        setDetail(`${statusLines(result)}\nThe installer is open.`);
      } else {
        setLabel('Update');
        setDetail(statusLines(result));
      }
    } catch (caught) {
      setLabel('Update');
      setDetail(describeUpdateError(caught));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 6 }]}>
        <Pressable
          testID="check-updates"
          onPressIn={() => {
            if (busyRef.current) return;
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
      <Text pointerEvents="none" testID="update-status" style={[styles.detail, { top: insets.top + 48 }]}>
        {detail}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 10, zIndex: 40, alignItems: 'flex-end' },
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f4f4f4', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  text: { color: '#161616', fontFamily: font.black, fontSize: 13 },
  badge: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sakura },
  detail: { position: 'absolute', right: 10, zIndex: 40, maxWidth: 220, color: colors.text, fontFamily: font.semibold, fontSize: 12, lineHeight: 16, textAlign: 'right' },
});
