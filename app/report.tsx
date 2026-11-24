import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLog, pushLog } from '@/src/lib/log';
import { buildReport } from '@/src/lib/report';
import { shareFile } from '@/src/lib/media';
import { APP_VERSION, APP_VERSION_CODE } from '@/src/lib/version';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function ReportScreen() {
  const studio = useStudio();
  const [note, setNote] = useState<string | null>(null);
  const report = useMemo(
    () =>
      buildReport({
        version: APP_VERSION,
        versionCode: APP_VERSION_CODE,
        device: 'phone',
        android: 'Android',
        settings: { ...studio.settings, provider: studio.settings.provider },
        errors: getLog().map((entry) => `${entry.level}: ${entry.message}`),
        cloud: 'See the last cloud check in the log above.',
      }),
    [studio.settings],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Report a problem</Text>
        <Text style={styles.body}>Keys, tokens, and web addresses are removed. Share this text or copy it into a chat.</Text>
        <Text testID="report-body" style={styles.report}>
          {report}
        </Text>
        <Pressable
          testID="copy-report"
          onPress={() => {
            void Clipboard.setStringAsync(report);
            setNote('Copied. Nothing secret is in that text.');
          }}>
          <Text style={styles.link}>Copy report</Text>
        </Pressable>
        <Pressable
          testID="send-report"
          style={styles.go}
          onPress={() => {
            pushLog('info', 'User sent a problem report.');
            void shareFile(`data:text/plain,${encodeURIComponent(report)}`, 'yume-report.txt', 'text/plain').then(setNote);
          }}>
          <Text style={styles.goText}>Send report</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            pushLog('error', 'Sample problem recorded from the report screen.');
            setNote('A sample error was added to the log.');
          }}>
          <Text style={styles.link}>Record a sample error</Text>
        </Pressable>
        {note ? <Text style={styles.ok}>{note}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  report: { color: colors.text, fontFamily: font.semibold, fontSize: 12, lineHeight: 18, backgroundColor: colors.card, borderRadius: 12, padding: 12 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 15 },
  go: { backgroundColor: colors.accent, borderRadius: 20, alignItems: 'center', paddingVertical: 12 },
  goText: { color: '#fff', fontFamily: font.black },
  ok: { color: colors.ok, fontFamily: font.semibold },
});
