import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { confirmAction } from '@/src/lib/confirm';
import { readCivitaiToken, writeCivitaiToken } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';
import type { ModelId, ProviderId } from '@/src/lib/types';

const PROVIDERS: { id: ProviderId; label: string; body: string }[] = [
  { id: 'demo', label: 'Demo studio', body: 'Paints a preview on this phone. No key, no charge.' },
  { id: 'openai', label: 'OpenAI', body: 'gpt-image-1 or dall-e-3. Your key stays in Secure Store.' },
  { id: 'salad', label: 'SaladCloud', body: 'Your own GPU container. Endpoint and key stay on this phone.' },
];

const MODELS: { id: ModelId; label: string; body: string }[] = [
  { id: 'gpt-image-1', label: 'gpt-image-1', body: 'Default. One image at a time, up to four.' },
  { id: 'dall-e-3', label: 'dall-e-3', body: 'Older model. Tall frames use 1024×1792.' },
];

export default function SettingsScreen() {
  const studio = useStudio();
  const [openaiDraft, setOpenaiDraft] = useState('');
  const [show, setShow] = useState(false);
  const [civitaiDraft, setCivitaiDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [messageBad, setMessageBad] = useState(false);

  function note(text: string, bad = false) {
    setMessage(text);
    setMessageBad(bad);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>On this phone</Text>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>App update</Text>
          <Text style={styles.body}>
            Paste the HTTPS address of releases/latest.json. Yume compares the version code, downloads the APK, checks the checksum, and opens the Android installer. You allow installs from Yume once. There is no Expo account. JavaScript-only OTA updates are not wired up: the Expo update protocol needs a signed update server, and skipping that is more reliable than a half-working one.
          </Text>
          <TextInput
            testID="update-url"
            value={studio.settings.updateManifestUrl}
            onChangeText={(updateManifestUrl) => void studio.updateSettings({ updateManifestUrl })}
            placeholder="https://example.com/latest.json"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            style={styles.input}
          />
          <Pressable testID="check-updates" onPress={() => void studio.updateSettings({ updateManifestUrl: studio.settings.updateManifestUrl.trim() })}>
            <Text style={styles.link}>Check for updates</Text>
          </Pressable>
          <Text style={styles.label}>Cloud hourly rate (USD)</Text>
          <TextInput
            testID="hourly-rate"
            value={String(studio.settings.hourlyRate)}
            onChangeText={(value) => void studio.updateSettings({ hourlyRate: Number(value) || 0 })}
            keyboardType="decimal-pad"
            style={styles.input}
          />
          <Pressable testID="open-cloud-check-settings" onPress={() => router.push('/cloud-check')}>
            <Text style={styles.link}>Check cloud</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/report')}>
            <Text style={styles.link}>Report a problem</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cloud setup</Text>
          <Text style={styles.body}>
            A short wizard creates the Salad server, or you can connect a gateway you already have. The server URL and key live on one Connect screen.
          </Text>
          <Pressable testID="open-cloud-setup" style={styles.save} onPress={() => router.push('/setup')}>
            <Text style={styles.saveText}>Cloud setup</Text>
          </Pressable>
          <Pressable testID="open-connect" onPress={() => router.push('/connect')}>
            <Text style={styles.link}>Connect</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Provider</Text>
          {PROVIDERS.map((provider) => {
            const on = studio.settings.provider === provider.id;
            return (
              <Pressable
                key={provider.id}
                testID={`provider-${provider.id}`}
                onPress={() => studio.setProvider(provider.id)}
                style={[styles.model, on && styles.modelOn]}>
                <Text style={styles.modelLabel}>{provider.label}</Text>
                <Text style={styles.body}>{provider.body}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Civitai token</Text>
          <Text style={styles.body}>
            Optional. Browsing works without it. A token is only sent when a download needs a logged-in Civitai account. It stays in Secure Store.
          </Text>
          <TextInput
            testID="civitai-token"
            value={civitaiDraft}
            onChangeText={setCivitaiDraft}
            placeholder="Civitai API token"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
          />
          <Pressable
            style={styles.save}
            onPress={() => {
              void writeCivitaiToken(civitaiDraft.trim() || null)
                .then(async () => {
                  setCivitaiDraft('');
                  note((await readCivitaiToken()) ? 'Civitai token saved.' : 'Civitai token cleared.');
                })
                .catch((caught: unknown) => note(caught instanceof Error ? caught.message : 'Could not save the token.', true));
            }}>
            <Text style={styles.saveText}>{civitaiDraft.trim() ? 'Save token' : 'Clear token'}</Text>
          </Pressable>
        </View>

        {studio.settings.provider === 'openai' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>OpenAI key</Text>
            {studio.secureStoreAvailable ? (
              <>
                <Text style={styles.body}>
                  {studio.hasKey
                    ? 'A key is in Secure Store. Yume reads it only when you press Draw.'
                    : 'Paste a key from platform.openai.com. It is stored with Secure Store.'}
                </Text>
                <TextInput
                  value={openaiDraft}
                  onChangeText={setOpenaiDraft}
                  placeholder={studio.hasKey ? 'Paste a replacement key' : 'sk-…'}
                  placeholderTextColor={colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!show}
                  style={styles.input}
                />
                <View style={styles.row}>
                  <Pressable onPress={() => setShow((value) => !value)}>
                    <Text style={styles.link}>{show ? 'Hide' : 'Show'}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.save, !openaiDraft.trim() && styles.saveOff]}
                    disabled={!openaiDraft.trim()}
                    onPress={() => {
                      void studio
                        .saveKey(openaiDraft)
                        .then(() => {
                          setOpenaiDraft('');
                          setShow(false);
                          note('OpenAI key saved in Secure Store.');
                        })
                        .catch((error: unknown) => note(error instanceof Error ? error.message : 'Could not save that key.', true));
                    }}>
                    <Text style={styles.saveText}>Save key</Text>
                  </Pressable>
                </View>
                {studio.hasKey ? (
                  <Pressable
                    onPress={() => {
                      void (async () => {
                        const ok = await confirmAction('Remove the OpenAI key?', 'Drawings stay on this phone.', 'Remove');
                        if (!ok) return;
                        await studio.clearKey();
                        note('OpenAI key removed.');
                      })();
                    }}>
                    <Text style={styles.danger}>Remove key</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <Text style={styles.body}>This browser preview has no phone keychain. Open Yume in Expo Go to save an OpenAI key.</Text>
            )}
            <Text style={styles.cardTitle}>Model</Text>
            {MODELS.map((model) => {
              const on = studio.settings.openaiModel === model.id;
              return (
                <Pressable
                  key={model.id}
                  onPress={() => void studio.updateSettings({ openaiModel: model.id })}
                  style={[styles.model, on && styles.modelOn]}>
                  <Text style={styles.modelLabel}>{model.label}</Text>
                  <Text style={styles.body}>{model.body}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {message ? <Text style={[styles.note, messageBad && styles.noteBad]}>{message}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>How a prompt is built</Text>
          <Text style={styles.body}>
            Enhance wraps your sentence with the style prefix, the character sheet, and the frame. Turn it off and the preview is sent as written. You can edit the preview before Draw. Names stay on the phone. Built-in style text does not add a studio name, including the watercolor preset.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  kicker: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  card: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 },
  cardTitle: { color: colors.text, fontFamily: font.black, fontSize: 16 },
  label: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
    color: colors.text,
    fontFamily: font.semibold,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: colors.sakura, fontFamily: font.black },
  save: { backgroundColor: colors.sakura, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start' },
  saveOff: { opacity: 0.4 },
  saveText: { color: colors.ink, fontFamily: font.black },
  danger: { color: colors.danger, fontFamily: font.black },
  note: { color: colors.ok, fontFamily: font.bold, fontSize: 13, lineHeight: 18 },
  noteBad: { color: colors.danger },
  model: { borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 10, gap: 4 },
  modelOn: { borderColor: colors.sakura, backgroundColor: 'rgba(255, 142, 199, 0.1)' },
  modelLabel: { color: colors.text, fontFamily: font.black, fontSize: 14 },
});
