import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { probe } from '@/src/lib/connection';
import { classifyGatewayInput, redactSecrets } from '@/src/lib/salad';
import { normalizeSaladKey } from '@/src/lib/saladCloud';
import { pushLog } from '@/src/lib/log';
import { readSaladKey } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

type Check = { name: string; status: 'pass' | 'fail' | 'warn'; detail: string };

export default function CloudCheckScreen() {
  const studio = useStudio();
  const params = useLocalSearchParams<{ auto?: string }>();
  const [checks, setChecks] = useState<Check[]>([]);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  async function run() {
    setBusy(true);
    const next: Check[] = [];
    const classified = classifyGatewayInput(studio.settings.saladEndpoint);
    if (classified.kind === 'key') {
      next.push({ name: 'URL', status: 'fail', detail: 'The saved address is a Salad API key, not a gateway URL. Open Connect and move it to Key.' });
      setChecks(next);
      setBusy(false);
      return;
    }
    const endpoint = classified.kind === 'url' ? classified.url : '';
    if (studio.settings.provider === 'demo' || !endpoint) {
      next.push({ name: 'URL', status: 'warn', detail: 'Demo mode has no server URL. Add one in Settings to check the cloud.' });
      setChecks(next);
      setBusy(false);
      return;
    }
    const host = new URL(endpoint);
    next.push({ name: 'URL', status: host.protocol === 'https:' ? 'pass' : 'warn', detail: host.protocol === 'https:' ? 'HTTPS address looks valid.' : 'The address is not HTTPS.' });
    const health = await probe(`${endpoint}/health`, {}, 8000);
    next.push(health.ok ? { name: 'Reachable', status: 'pass', detail: `Answered in ${health.ms} ms.` } : { name: 'Reachable', status: 'fail', detail: redactSecrets(health.error || 'No answer. Check DNS, the gateway, and that the group is running.') });
    next.push(health.ok ? { name: 'TLS', status: endpoint.startsWith('https') ? 'pass' : 'warn', detail: endpoint.startsWith('https') ? 'The connection used HTTPS.' : 'Plain HTTP has no TLS.' } : { name: 'TLS', status: 'fail', detail: 'Could not complete a secure request.' });
    const stored = await readSaladKey();
    const webKey = Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage.getItem('yume.webSaladKey') || '' : '';
    const key = normalizeSaladKey(stored || webKey);
    const auth = key ? await probe(`${endpoint}/models`, { headers: { Authorization: `Bearer ${key}`, 'Salad-Api-Key': key, 'X-Api-Key': key } }, 8000) : undefined;
    if (!key) next.push({ name: 'Auth', status: 'fail', detail: 'No API key is saved.' });
    else if (auth?.status === 401 || auth?.status === 403) next.push({ name: 'Auth', status: 'fail', detail: 'The key was rejected.' });
    else if (auth?.ok) next.push({ name: 'Auth', status: 'pass', detail: 'The key was accepted.' });
    else next.push({ name: 'Auth', status: 'warn', detail: auth?.error || 'Auth could not be checked.' });
    next.push(health.ok ? { name: 'Health', status: 'pass', detail: String(health.body?.gpu || 'Server is up.') } : { name: 'Health', status: 'fail', detail: 'No health payload.' });
    const ready = await probe(`${endpoint}/ready`, {}, 8000);
    next.push(ready.ok ? { name: 'Ready', status: 'pass', detail: 'Animagine XL 4.0 is ready.' } : { name: 'Ready', status: 'warn', detail: ready.body?.detail || 'Still starting or downloading the model.' });
    if (key && auth?.ok) {
      const diag = await probe(`${endpoint}/diagnostics`, { headers: { Authorization: `Bearer ${key}`, 'Salad-Api-Key': key } }, 12000);
      if (diag.ok && Array.isArray((diag.body as { checks?: Check[] })?.checks)) {
        for (const item of (diag.body as { checks: Check[] }).checks) next.push(item);
      } else {
        next.push({ name: 'Diagnostics', status: 'warn', detail: 'The server has no diagnostics payload yet.' });
      }
      const tiny = await probe(`${endpoint}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'Salad-Api-Key': key },
        body: JSON.stringify({ prompt: 'test', width: 512, height: 512, steps: 1, scheduler: 'Euler a' }),
      }, 20000);
      next.push(tiny.ok ? { name: 'Test picture', status: 'pass', detail: `A 512px frame returned in ${tiny.ms} ms.` } : { name: 'Test picture', status: 'fail', detail: tiny.body?.detail || tiny.error || 'The test picture failed. The gateway may have timed out near 100 seconds.' });
    }
    if (studio.settings.meshEndpoint.trim()) {
      const mesh = await probe(`${studio.settings.meshEndpoint.replace(/\/+$/, '')}/health`, {}, 8000);
      next.push(mesh.ok ? { name: '3D server', status: 'pass', detail: 'TRELLIS health answered.' } : { name: '3D server', status: 'fail', detail: 'The 3D server did not answer.' });
    }
    setChecks(next);
    pushLog('info', `Cloud check finished with ${next.filter((item) => item.status === 'fail').length} failures.`);
    setBusy(false);
  }

  useEffect(() => {
    if (params.auto === '1' && !started.current && studio.ready) {
      started.current = true;
      void run();
    }
  }, [params.auto, studio.ready]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Check cloud</Text>
        <Pressable testID="run-cloud-check" style={styles.go} onPress={() => void run()}>
          <Text style={styles.goText}>{busy ? 'Checking…' : 'Run the checklist'}</Text>
        </Pressable>
        {checks.map((check) => (
          <View key={check.name} style={styles.row}>
            <Text style={[styles.badge, check.status === 'pass' ? styles.pass : check.status === 'warn' ? styles.warn : styles.fail]}>{check.status}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{check.name}</Text>
              <Text style={styles.detail}>{check.detail}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 32 },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  link: { color: colors.cyan, fontFamily: font.black },
  go: { backgroundColor: colors.accent, borderRadius: 20, alignItems: 'center', paddingVertical: 12 },
  goText: { color: '#fff', fontFamily: font.black },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  badge: { fontFamily: font.black, fontSize: 12, textTransform: 'uppercase', width: 48 },
  pass: { color: colors.ok },
  warn: { color: colors.amber },
  fail: { color: colors.danger },
  name: { color: colors.text, fontFamily: font.black, fontSize: 15 },
  detail: { color: colors.muted, fontFamily: font.semibold, fontSize: 13, lineHeight: 18 },
});
