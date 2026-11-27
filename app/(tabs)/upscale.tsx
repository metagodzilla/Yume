import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/AppBar';
import { CharacterReference, type ReferencePick, emptyReference } from '@/components/CharacterReference';
import { ResultCompare } from '@/components/ResultCompare';
import { PictureSource } from '@/components/PictureSource';
import { cloudPost, imageBytes, imageField, pictureRecord } from '@/src/lib/cloudPicture';
import { detailDenoise, planTarget, repairDenoise, pngSize, type FramePreset } from '@/src/lib/framePlan';
import { uid } from '@/src/lib/id';
import { readSaladKey, persistPng } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function UpscaleScreen() {
  const studio = useStudio();
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preset, setPreset] = useState<FramePreset>('2k');
  const [enhance, setEnhance] = useState(true);
  const [detail, setDetail] = useState(0.35);
  const [repair, setRepair] = useState(0.45);
  const [prompt, setPrompt] = useState('');
  const [reference, setReference] = useState<ReferencePick>(emptyReference);
  const [results, setResults] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const size = bytes ? pngSize(bytes) : null;
  const target = size ? planTarget(size.width, size.height, preset) : null;
  const identity = reference.images.length > 0 || Boolean(reference.tags || reference.lora);

  async function run() {
    if (!bytes || busy) return;
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const key = (await readSaladKey()) || '';
      const result = await cloudPost(studio.settings.saladEndpoint, key, '/upscale', {
        image: imageField(bytes),
        preset,
        enhance: enhance || identity,
        detail,
        repair,
        prompt,
        references: reference.images,
        character_tags: reference.tags,
        loras: reference.lora ? [reference.lora] : [],
      });
      if (!result.image) throw new Error('The cloud did not return a picture.');
      if (result.image === imageField(bytes)) throw new Error('The cloud returned the original picture. It was not changed.');
      setResults((current) => [...current, `data:image/png;base64,${result.image}`]);
      setNote(identity ? 'Repaired with the character reference.' : enhance ? 'Sharpened with a detail pass.' : 'Upscaled without the detail pass.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The upscale failed.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!bytes || !results.length) return;
    const id = uid('upscale');
    const originalUri = await persistPng(`${id}-original.png`, bytes);
    const uris: string[] = [];
    for (let index = 0; index < results.length; index += 1) {
      uris.push(await persistPng(`${id}-${index}.png`, imageBytes(results[index]?.split(',')[1] || '')));
    }
    await studio.rememberGeneration(pictureRecord({
      id,
      uri: uris[0] || '',
      uris,
      originalUri,
      prompt: prompt || 'upscale',
      negative: '',
      model: 'WAI-Illustrious',
      width: target?.width || 0,
      height: target?.height || 0,
      provider: studio.settings.provider,
    }));
    setNote('Saved to history.');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBar />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Upscale</Text>
        <Text style={styles.body}>2K is a 2048 long edge. 4K is 3840. Every upscale restores blur with the anime upscaler, then a light detail pass so lines, eyes, and hair stay crisp. It does not run on the phone.</Text>
        <PictureSource label="Choose a picture" uri={preview} onPick={(next, shown) => { setBytes(next); setPreview(shown); setResults([]); setError(null); }} />
        <View style={styles.row}>
          {(['2k', '4k'] as FramePreset[]).map((item) => (
            <Pressable key={item} testID={`size-${item}`} onPress={() => setPreset(item)} style={[styles.chip, preset === item && styles.on]}>
              <Text style={styles.chipText}>{item.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
        {target ? <Text style={styles.hint}>{target.width} × {target.height} · {target.passes} upscaler pass{target.passes === 1 ? '' : 'es'}</Text> : null}
        <Pressable testID="enhance-toggle" onPress={() => setEnhance((value) => !value)}>
          <Text style={styles.link}>{enhance ? 'Detail pass on' : 'Detail pass off'}</Text>
        </Pressable>
        {enhance ? <Stepper testID="detail" label={`Detail ${detailDenoise(detail).toFixed(2)}`} value={detail} onChange={setDetail} /> : null}
        <TextInput value={prompt} onChangeText={setPrompt} placeholder="Optional prompt" placeholderTextColor={colors.faint} style={styles.input} />
        <CharacterReference onChange={setReference} />
        {identity ? <Stepper testID="repair" label={`Repair strength ${repairDenoise(repair).toFixed(2)}`} value={repair} onChange={setRepair} /> : null}
        <Text style={styles.hint}>A character reference uses her face, her tags, and her LoRA, then a face pass. Weights download the first time and again after the cloud moves.</Text>
        <Pressable testID="upscale-go" style={styles.go} disabled={busy || !bytes} onPress={() => void run()}>
          <Text style={styles.goText}>{busy ? 'Working…' : 'Upscale'}</Text>
        </Pressable>
        {preview && results.length ? <ResultCompare original={preview} results={results} /> : null}
        {results.length ? <Pressable testID="upscale-save" onPress={() => void save()}><Text style={styles.link}>Save to history</Text></Pressable> : null}
        {error ? <Text testID="upscale-error" style={styles.error}>{error}</Text> : null}
        {note ? <Text style={styles.hint}>{note}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stepper({ value, onChange, label, testID }: { value: number; onChange: (next: number) => void; label: string; testID: string }) {
  const shown = Math.round(value * 100) / 100;
  return (
    <View style={styles.row}>
      <Pressable testID={`${testID}-down`} onPress={() => onChange(Math.max(0, Math.round((shown - 0.05) * 100) / 100))}><Text style={styles.link}>−</Text></Pressable>
      <Text testID={testID} style={styles.hint}>{label}</Text>
      <Pressable testID={`${testID}-up`} onPress={() => onChange(Math.min(1, Math.round((shown + 0.05) * 100) / 100))}><Text style={styles.link}>+</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 40 },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  hint: { color: colors.faint, fontFamily: font.semibold, fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 8 },
  on: { borderColor: colors.sakura, backgroundColor: colors.cardAlt },
  chipText: { color: colors.text, fontFamily: font.bold, fontSize: 14 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 14 },
  input: { borderRadius: 12, borderWidth: 1, borderColor: colors.line, color: colors.text, fontFamily: font.semibold, padding: 10 },
  go: { backgroundColor: colors.sakura, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  goText: { color: colors.text, fontFamily: font.black, fontSize: 16 },
});
