import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ModelThumb } from '@/components/ModelThumb';
import { civitaiModelUrl, loraFileName, loraPage, searchCivitai, type CivitaiModel, type ContentFilter } from '@/src/lib/civitai';
import { BASE_MODELS, MODEL_TYPES, SORTS } from '@/src/lib/defaultModel';
import { patchGenerator, toggleLora, useGenerator } from '@/src/lib/genstore';
import { openLink } from '@/src/lib/openLink';
import { readCivitaiToken } from '@/src/lib/storage';
import { colors, font } from '@/src/theme';

const FILTERS: { id: ContentFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sfw', label: 'SFW only' },
  { id: 'nsfw', label: 'NSFW only' },
];

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
        contentFilter: gen.contentFilter,
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
  }, [type, base, sort, gen.contentFilter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>Civitai</Text>
        <Text style={styles.title}>Models</Text>
        <View style={styles.searchRow}>
          <TextInput
            testID="model-search"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void load(null, false)}
            placeholder="Search checkpoints, LoRAs, embeddings"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            style={[styles.input, { flex: 1 }]}
          />
          {FILTERS.map((item) => (
            <Pressable
              key={item.id}
              testID={`content-filter-${item.id}`}
              onPress={() => patchGenerator({ contentFilter: item.id })}
              style={[styles.chip, gen.contentFilter === item.id && styles.chipOn]}>
              <Text style={styles.chipText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
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
        <Text style={styles.body}>
          All, SFW only, or NSFW only applies to the list and to every thumbnail. SFW hides mature items. NSFW only hides safe items. A saved Civitai token is used only when a download needs it.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {busy && items.length === 0 ? <Text style={styles.body}>Loading Civitai…</Text> : null}
        {items.map((model, index) => {
          const version = model.modelVersions?.[0];
          const lora = model.type === 'LORA' || model.type === 'LoCon';
          const selected = version ? gen.loras.some((item) => item.versionId === version.id) : false;
          return (
            <View key={model.id} testID={index === 0 ? 'model-result' : undefined} style={styles.card}>
              <Pressable
                style={styles.cardMain}
                onPress={() => openLink(civitaiModelUrl(model.id, version?.id))}
                onLongPress={() => version && lora && toggleLora({ name: loraFileName(version, model.name), weight: 0.8, modelId: model.id, versionId: version.id })}>
                <ModelThumb model={model} filter={gen.contentFilter} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.name}>{model.name}</Text>
                  <Text style={styles.meta}>
                    {model.type} · {version?.baseModel ?? 'unknown base'}
                  </Text>
                </View>
              </Pressable>
              {lora && version ? (
                <Pressable
                  testID={index === 0 ? 'lora-use' : undefined}
                  onPress={() => toggleLora({ name: loraFileName(version, model.name), weight: 0.8, modelId: model.id, versionId: version.id })}>
                  <Text style={styles.link}>{selected ? 'Remove' : 'Use'}</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => router.push({ pathname: '/model', params: { id: String(model.id) } })}>
                  <Text style={styles.link}>Details</Text>
                </Pressable>
              )}
            </View>
          );
        })}
        {cursor ? (
          <Pressable onPress={() => void load(cursor, true)} disabled={busy}>
            <Text style={styles.link}>{busy ? 'Loading…' : 'More'}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.label}>Installed on this phone's list</Text>
        {gen.installed.map((item) => {
          const page = loraPage({ name: item.name, modelId: item.modelId, versionId: item.versionId });
          const lora = item.type === 'LORA' || item.type === 'LoCon';
          return (
            <View key={item.versionId} style={styles.row}>
              <Pressable onPress={() => openLink(page.url)}>
                <Text style={styles.meta}>
                  {item.isDefault ? 'Default · ' : ''}
                  {item.name} {item.version} · {item.type} · {page.label}
                </Text>
              </Pressable>
              {lora ? (
                <Pressable onPress={() => toggleLora({ name: item.filename.replace(/\.(safetensors|pt|ckpt|bin)$/i, ''), weight: 0.8, modelId: item.modelId, versionId: item.versionId })}>
                  <Text style={styles.link}>Use</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 32 },
  kicker: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
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
  card: { flexDirection: 'row', gap: 10, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, padding: 8 },
  cardMain: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center' },
  name: { color: colors.text, fontFamily: font.black, fontSize: 15 },
  meta: { color: colors.muted, fontFamily: font.semibold, fontSize: 13 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 15 },
  label: { color: colors.sakura, fontFamily: font.black, fontSize: 12, textTransform: 'uppercase' },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14 },
});
