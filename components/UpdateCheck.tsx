import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';

import { checkGithubRelease } from '@/src/lib/updates';
import { APP_VERSION, APP_VERSION_CODE } from '@/src/lib/version';
import { colors, font } from '@/src/theme';

export function UpdateCheck({ compact = false, testID = 'check-updates' }: { compact?: boolean; testID?: string }) {
  const [label, setLabel] = useState('Check for updates');
  const [apkUrl, setApkUrl] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onPress() {
    if (apkUrl) {
      await Linking.openURL(apkUrl);
      return;
    }
    setBusy(true);
    const result = await checkGithubRelease(APP_VERSION, APP_VERSION_CODE);
    setLabel(result.label);
    setApkUrl(result.apkUrl);
    setBad(result.bad);
    setBusy(false);
  }

  return (
    <Pressable testID={testID} onPress={() => void onPress()} style={compact ? styles.compact : styles.button} hitSlop={8}>
      <Text style={[compact ? styles.compactText : styles.buttonText, bad && styles.bad]}>{busy ? 'Checking…' : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: { paddingVertical: 4 },
  compactText: { color: colors.cyan, fontFamily: font.black, fontSize: 13 },
  button: { alignSelf: 'flex-start', backgroundColor: colors.cardAlt, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  buttonText: { color: colors.text, fontFamily: font.black, fontSize: 15 },
  bad: { color: colors.danger },
});
