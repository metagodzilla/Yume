import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { previewUrl, searchCivitai, type CivitaiModel } from '@/src/lib/civitai';
import { BASE_MODELS, MODEL_TYPES, SORTS } from '@/src/lib/defaultModel';
import { useGenerator } from '@/src/lib/genstore';
import { patchGenerator } from '@/src/lib/genstore';
import { readCivitaiToken } from '@/src/lib/storage';
import { colors, font } from '@/src/theme';

export default function ModelsScreen() {
  const gen = useGenerator();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string>('Checkpoint');
  const [base, setBase] = useState('SDXL 1.0');
  const [sort, setSort] = useState<string>('Most Downloaded');
  const [items, setItems] = useState<CivitaiModel[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  async function load(nextCursor?: string | null, append = false) {
    const ticket = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const token = await readCivitaiToken();
      const page = await searchCivitai({
        query,
        type,
        baseModel: base,
        sort,
        nsfw: gen.nsfw,
        cursor: nextCursor,
        token,
      });
      if (ticket !== request.current) return;
      setItems((current) => (append ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (caught) {
      if (ticket !== request.current) return;
      setError(caught instanceof Error ? caught.message : 'Civitai could not be reached.');
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  }

  useEffect(() => {
    void load(null, false);
    // The filters are the search. A new key reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, base, sort, gen.nsfw]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>Civitai</Text>
        <Text style={styles.title}>Models</Text>
        <TextInput
          testID="model-search"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void load(null, false)}
          placeholder="Search checkpoints, LoRAs, embeddings"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          style={styles.input}
        />
        <Pressable testID="model-search-go" onPress={() => void load(null, false)}>
          <Text style={styles.link}>{busy ? 'Searching…' : 'Search'}</Text>
        </Pressable>
        <View style={styles.row}>
          {MODEL_TYPES.map((item) => (
            <Pressable key={item.id} onPress={() => setType(item.id)} style={[styles.chip, type === item.id && styles.chipOn]}>
              <Text style={styles.chipText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {BASE_MODELS.map((item) => (
            <Pressable key={item} onPress={() => setBase(item)} style={[styles.chip, base === item && styles.chipOn]}>
              <Text style={styles.chipText}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.row}>
          {SORTS.map((item) => (
            <Pressable key={item} onPress={() => setSort(item)} style={[styles.chip, sort === item && styles.chipOn]}>
              <Text style={styles.chipText}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.nsfw}>
          <Text style={styles.body}>Show NSFW models</Text>
          <Switch
            testID="nsfw-toggle"
            value={gen.nsfw}
            onValueChange={(nsfw) => patchGenerator({ nsfw })}
            trackColor={{ false: '#3a2a44', true: colors.sakuraDeep }}
            thumbColor={colors.text}
          />
        </View>
        <Text style={styles.body}>NSFW is off unless you turn it on. Downloads that need a login use the Civitai token in Settings.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {busy && items.length === 0 ? <Text style={styles.body}>Loading Civitai…</Text> : null}
        {items.map((model, index) => {
          const version = model.modelVersions?.[0];
          const image = previewUrl(model, gen.nsfw);
          return (
            <Pressable
              key={model.id}
              testID={index === 0 ? 'model-result' : undefined}
              style={styles.card}
              onPress={() => router.push({ pathname: '/model', params: { id: String(model.id) } })}>
              {image ? <Image source={{ uri: image }} style={styles.preview} contentFit="cover" /> : <View style={styles.preview} />}
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.name}>{model.name}</Text>
                <Text style={styles.meta}>
                  {model.type} · {version?.baseModel ?? 'unknown base'}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {cursor ? (
          <Pressable onPress={() => void load(cursor, true)} disabled={busy}>
            <Text style={styles.link}>{busy ? 'Loading…' : 'More'}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.label}>Installed on this phone's list</Text>
        {gen.installed.map((item) => (
          <Text key={item.versionId} style={styles.meta}>
            {item.isDefault ? 'Default · ' : ''}
            {item.name} {item.version} · {item.type}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 32 },
  kicker: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: font.semibold,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.card },
  chipOn: { borderColor: colors.sakura, backgroundColor: colors.cardAlt },
  chipText: { color: colors.text, fontFamily: font.bold, fontSize: 13 },
  nsfw: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  card: { flexDirection: 'row', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, padding: 8 },
  preview: { width: 72, height: 96, borderRadius: 10, backgroundColor: colors.ink },
  name: { color: colors.text, fontFamily: font.black, fontSize: 15 },
  meta: { color: colors.muted, fontFamily: font.semibold, fontSize: 13 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 15 },
  label: { color: colors.sakura, fontFamily: font.black, fontSize: 12, textTransform: 'uppercase' },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14 },
});
