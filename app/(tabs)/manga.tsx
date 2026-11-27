import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/AppBar';
import { CharacterReference, type ReferencePick, emptyReference } from '@/components/CharacterReference';
import { ResultCompare } from '@/components/ResultCompare';
import { PictureSource } from '@/components/PictureSource';
import { cloudPost, imageBytes, imageField, pictureRecord } from '@/src/lib/cloudPicture';
import { planTarget, pngSize, redrawDenoise, type FramePreset } from '@/src/lib/framePlan';
import { uid } from '@/src/lib/id';
import { readSaladKey, persistPng } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

type Job = 'redraw' | 'edit';
type Stroke = { x: number; y: number; r: number; erase: boolean };

export default function MangaScreen() {
  const studio = useStudio();
  const [job, setJob] = useState<Job>('redraw');
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preset, setPreset] = useState<FramePreset>('2k');
  const [colorize, setColorize] = useState(false);
  const [hints, setHints] = useState('');
  const [prompt, setPrompt] = useState('');
  const [strength, setStrength] = useState(0.55);
  const [outfit, setOutfit] = useState<'clothes' | 'original'>('clothes');
  const [reference, setReference] = useState<ReferencePick>(emptyReference);
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [erase, setErase] = useState(false);
  const [mask, setMask] = useState<string | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const frame = useRef({ width: 1, height: 1 });
  const eraseRef = useRef(false);
  const jobRef = useRef<Job>('redraw');
  eraseRef.current = erase;
  jobRef.current = job;
  const size = bytes ? pngSize(bytes) : null;
  const target = size ? planTarget(size.width, size.height, preset) : null;

  async function segment(x: number, y: number, nextStrokes: Stroke[]) {
    if (!bytes) return;
    const key = (await readSaladKey()) || '';
    const result = await cloudPost(studio.settings.saladEndpoint, key, '/manga/segment', {
      image: imageField(bytes),
      x,
      y,
      strokes: nextStrokes,
    });
    if (result.mask) setMask(`data:image/png;base64,${result.mask}`);
  }

  const brush = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => jobRef.current === 'edit',
      onPanResponderMove: (event) => {
        if (jobRef.current !== 'edit') return;
        const x = event.nativeEvent.locationX / frame.current.width;
        const y = event.nativeEvent.locationY / frame.current.height;
        const erasing = eraseRef.current;
        setStrokes((current) => [...current, { x, y, r: erasing ? 0.06 : 0.04, erase: erasing }]);
      },
    }),
  ).current;

  async function run() {
    if (!bytes || busy) return;
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const key = (await readSaladKey()) || '';
      const result = await cloudPost(studio.settings.saladEndpoint, key, '/manga', {
        image: imageField(bytes),
        preset,
        job,
        colorize,
        hints,
        prompt,
        redraw: strength,
        strength,
        outfit,
        clothes: outfit === 'clothes' ? reference.clothes : '',
        references: reference.images,
        character_tags: reference.tags,
        loras: reference.lora ? [reference.lora] : [],
        body: reference.body,
        height_cm: reference.heightCm,
        bust_cm: reference.bustCm,
        hip_cm: reference.hipCm,
        x: tap?.x ?? 0.5,
        y: tap?.y ?? 0.4,
        strokes,
      });
      if (!result.image) throw new Error('The cloud did not return a picture.');
      if (result.image === imageField(bytes)) throw new Error('The cloud returned the original page. The picture was not changed.');
      setResults((current) => [...current, `data:image/png;base64,${result.image}`]);
      const bubbles = typeof result.bubbles === 'number' ? ` ${result.bubbles} text areas kept.` : '';
      setNote(job === 'edit' ? `Character swapped.${bubbles}` : `Page redrawn.${bubbles}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The redraw failed.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!bytes || !results.length) return;
    const id = uid('manga');
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
      prompt: prompt || (job === 'edit' ? 'manga edit' : 'manga redraw'),
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
        <Text style={styles.title}>Manga Redraw</Text>
        <View style={styles.row}>
          <Pressable testID="job-redraw" onPress={() => setJob('redraw')} style={[styles.chip, job === 'redraw' && styles.on]}><Text style={styles.chipText}>Redraw</Text></Pressable>
          <Pressable testID="job-edit" onPress={() => setJob('edit')} style={[styles.chip, job === 'edit' && styles.on]}><Text style={styles.chipText}>Edit</Text></Pressable>
        </View>
        <Text style={styles.body}>{job === 'edit' ? 'Tap the person to replace. Brush the mask, then pick your character. The pose is fitted to her body.' : 'Redraws the page in the same layout. Speech bubbles are put back on top.'}</Text>
        <PictureSource label="Choose a manga page" uri={null} onPick={(next, shown) => { setBytes(next); setPreview(shown); setResults([]); setMask(null); setError(null); }} />
        {preview ? (
          <View
            style={styles.stage}
            onLayout={(event) => {
              frame.current = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
            }}
            {...(job === 'edit' ? brush.panHandlers : {})}>
            <Pressable
              testID="page-tap"
              style={StyleSheet.absoluteFill}
              onPress={(event) => {
                if (job !== 'edit') return;
                const x = event.nativeEvent.locationX / frame.current.width;
                const y = event.nativeEvent.locationY / frame.current.height;
                setTap({ x, y });
                void segment(x, y, strokes).catch((caught) => setNote(caught instanceof Error ? caught.message : 'The person could not be selected.'));
              }}>
              <Image source={{ uri: preview }} style={styles.page} contentFit="contain" />
              {mask ? <Image source={{ uri: mask }} style={[styles.page, styles.mask]} contentFit="contain" /> : null}
            </Pressable>
          </View>
        ) : null}
        {job === 'edit' ? (
          <View style={styles.row}>
            <Pressable testID="brush-add" onPress={() => setErase(false)} style={[styles.chip, !erase && styles.on]}><Text style={styles.chipText}>Brush add</Text></Pressable>
            <Pressable testID="brush-erase" onPress={() => setErase(true)} style={[styles.chip, erase && styles.on]}><Text style={styles.chipText}>Brush erase</Text></Pressable>
          </View>
        ) : null}
        <View style={styles.row}>
          {(['2k', '4k'] as FramePreset[]).map((item) => (
            <Pressable key={item} testID={`manga-size-${item}`} onPress={() => setPreset(item)} style={[styles.chip, preset === item && styles.on]}>
              <Text style={styles.chipText}>{item.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
        {target ? <Text style={styles.hint}>{target.width} × {target.height}</Text> : null}
        <Pressable testID="colorize-toggle" onPress={() => setColorize((value) => !value)}>
          <Text style={styles.link}>{colorize ? 'Colorize' : 'Keep black & white'}</Text>
        </Pressable>
        {colorize ? <TextInput testID="color-hints" value={hints} onChangeText={setHints} placeholder="Momo: pink hair, blue eyes" placeholderTextColor={colors.faint} style={styles.input} /> : null}
        <TextInput value={prompt} onChangeText={setPrompt} placeholder="Optional prompt" placeholderTextColor={colors.faint} style={styles.input} />
        <Stepper testID="redraw-strength" label={`${job === 'edit' ? 'Strength' : 'Redraw strength'} ${redrawDenoise(strength).toFixed(2)}`} value={strength} onChange={setStrength} />
        <CharacterReference onChange={setReference} />
        {job === 'edit' ? (
          <Pressable testID="outfit-toggle" onPress={() => setOutfit((value) => (value === 'clothes' ? 'original' : 'clothes'))}>
            <Text style={styles.link}>{outfit === 'clothes' ? 'Outfit from Clothes prompt' : 'Keep the original outfit'}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.hint}>Lineart and tile keep the panels and poses. Text is protected. Weights download on first use and after the cloud moves.</Text>
        <Pressable testID="manga-go" style={styles.go} disabled={busy || !bytes} onPress={() => void run()}>
          <Text style={styles.goText}>{busy ? 'Working…' : job === 'edit' ? 'Swap character' : 'Redraw'}</Text>
        </Pressable>
        {preview && results.length ? <ResultCompare original={preview} results={results} /> : null}
        {results.length ? <Pressable testID="manga-save" onPress={() => void save()}><Text style={styles.link}>Save to history</Text></Pressable> : null}
        {error ? <Text testID="manga-error" style={styles.error}>{error}</Text> : null}
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
      <Text style={styles.hint}>{label}</Text>
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
  stage: { height: 320, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.card },
  page: { width: '100%', height: '100%' },
  mask: { position: 'absolute', opacity: 0.45 },
  go: { backgroundColor: colors.sakura, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  goText: { color: colors.text, fontFamily: font.black, fontSize: 16 },
});
