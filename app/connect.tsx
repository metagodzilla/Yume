import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QrScanner } from '@/components/QrScanner';
import { interpretConnection, probe, type ConnectionState } from '@/src/lib/connection';
import { classifyGatewayInput, LIVE_GATEWAY_URL } from '@/src/lib/salad';
import { maskKey, serverUrlFromLink } from '@/src/lib/saladCloud';
import { readSaladKey } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

const headers = (key: string) => ({
  Authorization: `Bearer ${key}`,
  'X-Api-Key': key,
  'Salad-Api-Key': key,
});

export default function ConnectScreen() {
  const studio = useStudio();
  const params = useLocalSearchParams<{ url?: string }>();
  const linked = typeof params.url === 'string' ? serverUrlFromLink(params.url) : null;
  const [url, setUrl] = useState(linked || LIVE_GATEWAY_URL);
  const [key, setKey] = useState<string | null>(null);
  const [replacement, setReplacement] = useState('');
  const [pendingKey, setPendingKey] = useState('');
  const [mesh, setMesh] = useState(studio.settings.meshEndpoint);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<ConnectionState>({
    kind: 'demo',
    title: 'Not checked',
    detail: 'Save the URL, then tap Test.',
  });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (linked) {
      setUrl(linked);
      return;
    }
    const classified = classifyGatewayInput(studio.settings.saladEndpoint);
    if (classified.kind === 'url') {
      setUrl(classified.url);
      setPendingKey('');
      return;
    }
    setUrl(LIVE_GATEWAY_URL);
    if (classified.kind === 'key') {
      setPendingKey(classified.key);
      setMessage('This looks like your API key — move it to Key?');
    }
  }, [linked, studio.settings.saladEndpoint]);

  useEffect(() => {
    void readSaladKey().then(setKey);
  }, [studio.hasSaladKey]);

  async function test(endpoint = url, saladKey = key) {
    const cleaned = endpoint.trim().replace(/\/+$/, '');
    const health = cleaned ? await probe(`${cleaned}/health`, {}, 8000) : undefined;
    const ready = cleaned ? await probe(`${cleaned}/ready`, {}, 8000) : undefined;
    const auth = cleaned && saladKey ? await probe(`${cleaned}/models`, { headers: headers(saladKey) }, 8000) : undefined;
    setStatus(
      interpretConnection({
        provider: cleaned ? 'salad' : 'demo',
        endpoint: cleaned,
        hasKey: Boolean(saladKey),
        health,
        ready,
        auth,
      }),
    );
  }

  async function saveUrl(next: string) {
    const classified = classifyGatewayInput(next);
    if (classified.kind === 'key') {
      setPendingKey(classified.key);
      setUrl(LIVE_GATEWAY_URL);
      setMessage('This looks like your API key — move it to Key?');
      return;
    }
    if (classified.kind !== 'url') {
      setMessage('The server URL has to start with http:// or https:// and include a host.');
      return;
    }
    setPendingKey('');
    setUrl(classified.url);
    await studio.saveSaladEndpoint(classified.url);
    await studio.updateSettings({ provider: 'salad', setupComplete: true, saladEndpoint: classified.url });
    setMessage('URL saved on this phone.');
    await test(classified.url, key);
  }

  async function moveKey() {
    const next = pendingKey.trim();
    if (!next) return;
    await studio.saveSaladKey(next);
    if (classifyGatewayInput(studio.settings.saladEndpoint).kind === 'key') await studio.saveSaladEndpoint('');
    setKey(next);
    setPendingKey('');
    setUrl(LIVE_GATEWAY_URL);
    setMessage('Key saved in Secure Store. The live gateway is filled in. Tap Test to save that URL.');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Connect</Text>
        <Text testID="connect-status" style={styles.status}>
          Status · {status.title}
        </Text>
        <Text style={styles.body}>{status.detail}</Text>
        {studio.cloudNotice ? (
          <View style={styles.notice}>
            <Text testID="cloud-notice" style={styles.body}>{studio.cloudNotice}</Text>
            <Pressable onPress={studio.dismissCloudNotice}>
              <Text style={styles.link}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}
        <Text style={styles.label}>URL</Text>
        <TextInput
          testID="connect-url"
          value={url}
          onChangeText={(value) => {
            setUrl(value);
            const classified = classifyGatewayInput(value);
            if (classified.kind === 'key') {
              setPendingKey(classified.key);
              setMessage('This looks like your API key — move it to Key?');
            } else setPendingKey('');
          }}
          placeholder="https://your-group.salad.cloud"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Pressable testID="use-live-server" style={styles.secondary} onPress={() => void saveUrl(LIVE_GATEWAY_URL)}>
          <Text style={styles.secondaryText}>Use live server</Text>
        </Pressable>
        {pendingKey ? (
          <Pressable testID="move-key" style={styles.secondary} onPress={() => void moveKey()}>
            <Text style={styles.secondaryText}>This looks like your API key — move it to Key?</Text>
          </Pressable>
        ) : null}
        <Text style={styles.label}>Key</Text>
        <Text testID="connect-key" style={styles.key}>
          {maskKey(replacement.trim() || key)}
        </Text>
        <TextInput
          value={replacement}
          onChangeText={setReplacement}
          placeholder={key ? 'Paste a replacement key' : 'Salad API key'}
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
        />
        <Pressable
          style={styles.secondary}
          onPress={() => {
            const trimmed = replacement.trim();
            if (!trimmed) return;
            void studio
              .saveSaladKey(trimmed)
              .then(async () => {
                setKey(trimmed);
                setReplacement('');
                setMessage('Key saved in Secure Store.');
                await test(url, trimmed);
              })
              .catch((caught: unknown) => setMessage(caught instanceof Error ? caught.message : 'Could not save that key.'));
          }}>
          <Text style={styles.secondaryText}>Save key</Text>
        </Pressable>
        <Pressable testID="connect-test" style={styles.big} onPress={() => void saveUrl(url)}>
          <Text style={styles.bigText}>Test</Text>
        </Pressable>
        <Pressable testID="connect-scan" style={styles.secondary} onPress={() => setScanning(true)}>
          <Text style={styles.secondaryText}>Scan QR code</Text>
        </Pressable>
        {scanning ? (
          <QrScanner
            onClose={() => setScanning(false)}
            onScan={(value) => {
              const parsed = serverUrlFromLink(value);
              setScanning(false);
              if (!parsed) {
                setMessage('That code has no server URL. The API key is never read from a code.');
                return;
              }
              void saveUrl(parsed);
            }}
          />
        ) : null}
        <Text style={styles.label}>3D URL</Text>
        <TextInput
          testID="mesh-endpoint"
          value={mesh}
          onChangeText={setMesh}
          placeholder="Optional mesh gateway"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Pressable
          style={styles.secondary}
          onPress={() => {
            void studio.updateSettings({ meshEndpoint: mesh.trim() }).then(() => setMessage('3D URL saved.'));
          }}>
          <Text style={styles.secondaryText}>Save 3D URL</Text>
        </Pressable>
        {message ? <Text style={styles.body}>{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, gap: 12, paddingBottom: 40 },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 32 },
  status: { color: colors.text, fontFamily: font.black, fontSize: 18 },
  notice: { gap: 6 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 15, lineHeight: 22 },
  label: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  key: { color: colors.text, fontFamily: font.black, fontSize: 20, letterSpacing: 1 },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: font.semibold,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  big: { backgroundColor: colors.sakura, borderRadius: 18, paddingVertical: 18, alignItems: 'center' },
  bigText: { color: '#fff', fontFamily: font.black, fontSize: 18 },
  secondary: { borderRadius: 18, borderWidth: 1, borderColor: colors.line, paddingVertical: 16, alignItems: 'center' },
  secondaryText: { color: colors.text, fontFamily: font.black, fontSize: 16 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 16 },
});
