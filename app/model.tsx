import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { civitaiModelUrl, getCivitaiModel, loraFileName, thumbnailUrl, versionFile, type CivitaiModel, type CivitaiVersion } from '@/src/lib/civitai';
import { openLink } from '@/src/lib/openLink';
import { getGenerator, installLocal, patchGenerator, setDefaultCheckpoint, toggleLora, useGenerator } from '@/src/lib/genstore';
import { readCivitaiToken, readSaladKey } from '@/src/lib/storage';
import { normalizeEndpoint, saladErrorMessage } from '@/src/lib/salad';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function ModelScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const studio = useStudio();
  const gen = useGenerator();
  const [model, setModel] = useState<CivitaiModel | null>(null);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    void getCivitaiModel(id)
      .then((next) => {
        setModel(next);
        setVersionId(next.modelVersions?.[0]?.id ?? null);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load that model.'));
  }, [id]);

  const version = model?.modelVersions?.find((item) => item.id === versionId) ?? model?.modelVersions?.[0];
  const file = version ? versionFile(version) : undefined;
  const sample = (version?.images?.[0]?.meta ?? {}) as Record<string, unknown>;
  const installed = version ? gen.installed.some((item) => item.versionId === version.id) : false;

  async function install(item: CivitaiVersion) {
    if (!model || busy) return;
    setBusy(true);
    setError(null);
    try {
      const primary = versionFile(item);
      const record = {
        versionId: item.id,
        modelId: model.id,
        name: model.name,
        version: item.name,
        type: model.type,
        baseModel: item.baseModel,
        filename: primary?.name ?? `civitai-${item.id}.safetensors`,
        hash: (primary?.hashes?.AutoV2 ?? '').toLowerCase(),
        sha256: primary?.hashes?.SHA256 ?? '',
        triggers: item.trainedWords ?? [],
        isDefault: false,
      };
      if (studio.settings.provider === 'salad') {
        const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
        const [key, token] = await Promise.all([readSaladKey(), readCivitaiToken()]);
        if (!endpoint || !key) throw new Error('Salad needs an endpoint and API key before it can download a file.');
        setStatus('Asking the Salad container to download this version…');
        const response = await fetch(`${endpoint}/models/install`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
            'Salad-Api-Key': key,
            ...(token ? { 'X-Civitai-Token': token } : {}),
          },
          body: JSON.stringify({ versionId: item.id }),
        });
        if (!response.ok) {
          const raw = await response.text();
          let detail = '';
          try {
            const parsed = JSON.parse(raw) as { detail?: unknown };
            if (typeof parsed.detail === 'string') detail = parsed.detail;
          } catch {
            detail = '';
          }
          if (/civitai/i.test(detail)) throw new Error(detail);
          throw new Error(saladErrorMessage({ aborted: false, status: response.status, body: raw }));
        }
      } else {
        setStatus('Saved on this phone as installed. Demo mode does not download the weights.');
      }
      installLocal(record);
      if (model.type === 'Checkpoint') {
        const meta = item.images?.[0]?.meta as { sampler?: string; steps?: number; cfgScale?: number } | null;
        if (meta?.sampler || meta?.steps || meta?.cfgScale) {
          patchGenerator({
            ...(meta.sampler ? { sampler: String(meta.sampler) } : {}),
            ...(Number(meta.steps) ? { steps: Number(meta.steps) } : {}),
            ...(Number(meta.cfgScale) ? { cfg: Number(meta.cfgScale) } : {}),
          });
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Install failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        {!model ? <Text style={styles.body}>{error ?? 'Loading the model…'}</Text> : null}
        {model && version ? (
          <>
            <Text style={styles.kicker}>{model.type}</Text>
            <Text style={styles.title}>{model.name}</Text>
            <Text style={styles.body}>
              {version.baseModel} · version {version.name} · id {version.id}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {(version.images ?? []).slice(0, 6).map((image) => (
                <Image key={image.url} source={{ uri: image.url }} style={styles.preview} contentFit="cover" />
              ))}
            </ScrollView>
            <View style={styles.row}>
              {model.modelVersions.map((item) => (
                <Pressable key={item.id} onPress={() => setVersionId(item.id)} style={[styles.chip, item.id === version.id && styles.chipOn]}>
                  <Text style={styles.chipText}>{item.name}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Trigger words</Text>
            <Text style={styles.body}>{version.trainedWords?.length ? version.trainedWords.join(', ') : 'This version does not publish trigger words.'}</Text>
            <Text style={styles.label}>Sample settings</Text>
            <Text style={styles.body}>
              {sample.sampler ? `Sampler ${String(sample.sampler)}, ` : 'No sampler on the first sample. '}
              {sample.steps ? `${String(sample.steps)} steps, ` : ''}
              {sample.cfgScale ? `CFG ${String(sample.cfgScale)}. ` : ''}
              {sample.negativePrompt ? `Negative: ${String(sample.negativePrompt)}` : ''}
            </Text>
            <Text style={styles.body}>
              File {file?.name ?? 'unknown'}
              {file?.hashes?.AutoV2 ? ` · hash ${file.hashes.AutoV2}` : ''}
            </Text>
            <Pressable onPress={() => openLink(civitaiModelUrl(model.id, version.id))}>
              <Text style={styles.link}>Open on Civitai</Text>
            </Pressable>
            {model.type === 'LORA' || model.type === 'LoCon' ? (
              <Pressable
                onPress={() =>
                  toggleLora({
                    name: loraFileName(version, model.name),
                    weight: 0.8,
                    modelId: model.id,
                    versionId: version.id,
                  })
                }>
                <Text style={styles.link}>Use this LoRA</Text>
              </Pressable>
            ) : null}
            <Pressable testID="model-install" style={styles.go} disabled={busy || installed} onPress={() => void install(version)}>
              <Text style={styles.goText}>{installed ? 'Installed' : busy ? 'Installing…' : 'Install'}</Text>
            </Pressable>
            {model.type === 'Checkpoint' && installed ? (
              <Pressable
                onPress={() => {
                  setDefaultCheckpoint(version.id);
                  setStatus('This checkpoint is now the default.');
                }}>
                <Text style={styles.link}>Use as default</Text>
              </Pressable>
            ) : null}
            {version.trainedWords?.length ? (
              <Pressable
                onPress={() => {
                  const current = getGenerator().prompt;
                  patchGenerator({ prompt: [version.trainedWords.join(', '), current].filter(Boolean).join(', ') });
                  router.navigate('/');
                }}>
                <Text style={styles.link}>Insert trigger words</Text>
              </Pressable>
            ) : null}
            {status ? <Text style={styles.ok}>{status}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 32 },
  kicker: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 26 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  label: { color: colors.sakura, fontFamily: font.black, fontSize: 12, textTransform: 'uppercase' },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 15 },
  row: { flexDirection: 'row', gap: 8 },
  preview: { width: 140, height: 180, borderRadius: 12, backgroundColor: colors.ink },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 6 },
  chipOn: { borderColor: colors.sakura },
  chipText: { color: colors.text, fontFamily: font.bold, fontSize: 13 },
  go: { backgroundColor: colors.sakura, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  goText: { color: colors.ink, fontFamily: font.black, fontSize: 16 },
  ok: { color: colors.ok, fontFamily: font.semibold, fontSize: 14 },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14 },
});
