import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { civitaiImageId, parseParameters } from '@/src/lib/a1111';
import { getCivitaiImage } from '@/src/lib/civitai';
import { patchGenerator, useGenerator } from '@/src/lib/genstore';
import { readParameters } from '@/src/lib/pngmeta';
import { readCivitaiToken } from '@/src/lib/storage';
import { colors, font } from '@/src/theme';

export default function ImportScreen() {
  const gen = useGenerator();
  const [text, setText] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function applyParsed(raw: string) {
    const parsed = parseParameters(raw);
    patchGenerator({
      prompt: parsed.prompt ?? '',
      negative: parsed.negative || gen.negative,
      steps: parsed.steps || gen.steps,
      sampler: parsed.sampler || gen.sampler,
      cfg: parsed.cfg || gen.cfg,
      seed: String(parsed.seed ?? 0),
      seedRandom: false,
      width: parsed.width || gen.width,
      height: parsed.height || gen.height,
      clipSkip: parsed.clipSkip || gen.clipSkip,
      loras: parsed.loras ?? [],
      hires: Boolean(parsed.hires),
      hiresScale: parsed.hires?.scale ?? gen.hiresScale,
      hiresDenoise: parsed.hires?.denoise ?? gen.hiresDenoise,
      hiresUpscaler: parsed.hires?.upscaler ?? gen.hiresUpscaler,
      hiresSteps: parsed.hires?.steps ?? gen.hiresSteps,
    });
    const hash = (parsed.modelHash || '').toLowerCase();
    const known = gen.installed.some((item) => item.hash && hash && (hash.startsWith(item.hash) || item.hash.startsWith(hash)));
    const absent = [
      !known && (parsed.model || hash) ? `${parsed.model || 'Checkpoint'} (${hash || 'no hash'})` : '',
      ...(parsed.loras ?? [])
        .filter((lora) => !gen.installed.some((item) => item.name === lora.name || item.filename.startsWith(lora.name)))
        .map((lora) => `LoRA ${lora.name}`),
    ].filter(Boolean);
    setMissing(absent);
    setSummary(`Loaded ${parsed.sampler}, ${parsed.steps} steps, CFG ${parsed.cfg}, seed ${parsed.seed}, ${parsed.width}×${parsed.height}.`);
    setError(null);
  }

  async function apply() {
    const id = civitaiImageId(text);
    if (id && !text.includes('Steps:')) {
      try {
        const token = await readCivitaiToken();
        const image = await getCivitaiImage(id, token);
        const meta = image.meta ?? {};
        const prompt = String(meta.prompt ?? '');
        const negative = String(meta.negativePrompt ?? meta.negative ?? '');
        const built = [
          prompt,
          `Negative prompt: ${negative}`,
          `Steps: ${meta.steps ?? 25}, Sampler: ${meta.sampler ?? 'Euler a'}, CFG scale: ${meta.cfgScale ?? meta.cfg ?? 6}, Seed: ${meta.seed ?? 0}, Size: ${meta.Size ?? meta.size ?? '832x1216'}, Clip skip: ${meta.clipSkip ?? 2}`,
        ].join('\n');
        applyParsed(built);
        return;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not read that Civitai image.');
        return;
      }
    }
    applyParsed(text);
  }

  function openPng() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setError('On a phone, paste the generation data. Opening a PNG file is available in the browser preview.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png';
    input.setAttribute('data-testid', 'import-file');
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then((buffer) => {
        const found = readParameters(new Uint8Array(buffer));
        if (!found) {
          setError('That PNG has no parameters chunk.');
          return;
        }
        setText(found);
        applyParsed(found);
      });
    };
    input.click();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.kicker}>Import</Text>
        <Text style={styles.title}>Load a generation</Text>
        <Text style={styles.body}>
          Paste Automatic1111 parameters, a Civitai image URL or id, or open a PNG that already has the parameters chunk.
        </Text>
        <TextInput
          testID="import-text"
          value={text}
          onChangeText={setText}
          multiline
          placeholder={'masterpiece, 1girl\nNegative prompt: lowres\nSteps: 25, Sampler: Euler a, CFG scale: 6, Seed: 42, Size: 832x1216, Model hash: 1d5b43ff75, Clip skip: 2'}
          placeholderTextColor={colors.faint}
          style={styles.input}
        />
        <Pressable testID="import-apply" style={styles.go} onPress={() => void apply()}>
          <Text style={styles.goText}>Load settings</Text>
        </Pressable>
        <Pressable testID="import-png" onPress={openPng}>
          <Text style={styles.link}>Open a PNG</Text>
        </Pressable>
        {summary ? <Text style={styles.ok}>{summary}</Text> : null}
        {missing.length ? (
          <View testID="import-missing" style={styles.card}>
            <Text style={styles.label}>Not installed</Text>
            {missing.map((item) => (
              <Text key={item} style={styles.body}>
                {item}. Install it from the model browser if you have the Civitai version.
              </Text>
            ))}
            <Pressable onPress={() => router.push('/models')}>
              <Text style={styles.link}>Open the browser</Text>
            </Pressable>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 32 },
  kicker: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 15 },
  input: {
    minHeight: 160,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: font.semibold,
    padding: 12,
    textAlignVertical: 'top',
  },
  go: { backgroundColor: colors.sakura, borderRadius: 999, alignItems: 'center', paddingVertical: 12 },
  goText: { color: colors.ink, fontFamily: font.black, fontSize: 16 },
  ok: { color: colors.ok, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14 },
  card: { gap: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12 },
  label: { color: colors.sakura, fontFamily: font.black, fontSize: 12, textTransform: 'uppercase' },
});
