import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { saveImageToLibrary } from '@/src/lib/media';
import { pixelsForAspect, snapSize } from '@/src/lib/library';
import { hashSeed } from '@/src/lib/render';
import { produceImages } from '@/src/lib/produce';
import { composeSheet } from '@/src/lib/sheet';
import { loadTurnarounds, persistPng, readApiKey, readPng, readSaladKey, saveTurnarounds } from '@/src/lib/storage';
import {
  EXPRESSION_POSES,
  TURNAROUND_ANGLES,
  anglesFor,
  applyInstruction,
  consistencyNote,
  expressionPrompt,
  undoVersion,
  viewPrompt,
  type TurnaroundAngle,
  type TurnaroundBook,
  type TurnaroundView,
} from '@/src/lib/turnaround';
import { samplerId } from '@/src/lib/draw';
import { getGenerator } from '@/src/lib/genstore';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';
import type { Character } from '@/src/lib/types';

export default function TurnaroundScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const studio = useStudio();
  const character = studio.characters.find((item) => item.id === id) ?? null;
  const [books, setBooks] = useState<TurnaroundBook[]>([]);
  const [ready, setReady] = useState(false);
  const [includeFace, setIncludeFace] = useState(true);
  const [index, setIndex] = useState(0);
  const [scope, setScope] = useState<'one' | 'all'>('all');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [frameWidth, setFrameWidth] = useState(320);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const booksRef = useRef(books);
  booksRef.current = books;

  useEffect(() => {
    let live = true;
    loadTurnarounds()
      .then((list) => {
        if (live) setBooks(list);
      })
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const book = books.find((item) => item.characterId === id) ?? null;
  const version = book?.versions[0] ?? null;

  useEffect(() => {
    scroller.current?.scrollTo({ x: 0, animated: false });
  }, [version?.id]);
  const previous = book?.versions[1] ?? null;
  const views = version?.views ?? [];
  const safeIndex = views.length ? Math.min(index, views.length - 1) : 0;
  const current = views[safeIndex];
  const before = previous?.views.find((view) => view.angle === current?.angle) ?? null;
  const note = useMemo(
    () => consistencyNote(studio.settings.provider, studio.settings.openaiModel),
    [studio.settings.provider, studio.settings.openaiModel],
  );

  function onFrame(event: LayoutChangeEvent) {
    setFrameWidth(event.nativeEvent.layout.width);
  }

  function showAngle(next: number) {
    if (!views.length) return;
    const wrapped = (next + views.length) % views.length;
    setIndex(wrapped);
    scroller.current?.scrollTo({ x: wrapped * frameWidth, animated: true });
  }

  function onSwipe(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!frameWidth) return;
    const next = Math.round(event.nativeEvent.contentOffset.x / frameWidth);
    if (next >= 0 && next < views.length) setIndex(next);
  }

  async function remember(next: TurnaroundBook) {
    const list = [next, ...booksRef.current.filter((item) => item.characterId !== next.characterId)];
    booksRef.current = list;
    setBooks(list);
    await saveTurnarounds(list);
  }

  async function drawAngles(who: Character, angles: ReturnType<typeof anglesFor>, existing: TurnaroundView[]) {
    const seed = book?.seed ?? (hashSeed(who.id) % 2_147_483_646) + 1;
    const size = studio.settings.customSize
      ? { width: studio.settings.width, height: studio.settings.height }
      : pixelsForAspect(studio.aspectId);
    const [openaiKey, saladKey] = await Promise.all([readApiKey(), readSaladKey()]);
    const gen = getGenerator();
    const checkpoint = gen.installed.find((item) => item.versionId === gen.checkpointId);
    if (studio.settings.provider === 'salad' && !studio.settings.saladEndpoint.trim()) {
      throw new Error('Add the Salad gateway on Connect before drawing a turnaround in the cloud.');
    }
    if (studio.settings.provider === 'salad' && !saladKey) {
      throw new Error('Add the Salad API key in Connect before drawing a turnaround in the cloud.');
    }
    const kept = new Map(existing.map((view) => [view.angle, view]));
    const keptFront = kept.get('front') ?? null;
    let frontBytes: Uint8Array | null =
      keptFront && !angles.some((angle) => angle.id === 'front') ? await readPng(keptFront.imageUri) : null;
    const warnings: string[] = [];
    const fresh = new Map<TurnaroundAngle, TurnaroundView>();

    for (const angle of angles) {
      setBusy(`Drawing ${angle.label}…`);
      const prompt = viewPrompt(who, angle.wording);
      const result = await produceImages({
        provider: studio.settings.provider,
        prompt,
        negative: studio.settings.provider === 'salad' ? gen.negative : studio.settings.negative,
        styleId: studio.styleId,
        aspectId: studio.aspectId,
        character: who,
        count: 1,
        width: studio.settings.provider === 'salad' ? snapSize(gen.width) : size.width,
        height: studio.settings.provider === 'salad' ? snapSize(gen.height) : size.height,
        steps: studio.settings.provider === 'salad' ? gen.steps : studio.settings.steps,
        cfg: studio.settings.provider === 'salad' ? gen.cfg : studio.settings.cfg,
        sampler: studio.settings.provider === 'salad' ? samplerId(gen.sampler) : studio.settings.sampler,
        seedMode: 'fixed',
        seed,
        saladModel: checkpoint ? String(checkpoint.versionId) : studio.settings.saladModel,
        loras: studio.settings.loras,
        openaiModel: studio.settings.openaiModel,
        openaiKey,
        saladEndpoint: studio.settings.saladEndpoint,
        saladKey,
        platform: Platform.OS,
        variant: TURNAROUND_ANGLES.findIndex((item) => item.id === angle.id),
        angle: angle.id,
        referencePng: angle.id === 'front' ? null : frontBytes,
      });
      const uri = await persistPng(`${who.id}-${angle.id}-${Date.now()}.png`, result.pngs[0]);
      const view: TurnaroundView = { angle: angle.id, label: angle.label, prompt, imageUri: uri };
      fresh.set(angle.id, view);
      if (angle.id === 'front') frontBytes = result.pngs[0];
      if (result.warning) warnings.push(result.warning);
      if (result.consistency === 'img2img' || result.consistency === 'ip-adapter' || result.consistency === 'openai-edit') {
        warnings.push(`${angle.label} used the front view as a reference (${result.consistency}).`);
      }
    }

    const ordered = TURNAROUND_ANGLES.flatMap((angle) => {
      const view = fresh.get(angle.id) ?? kept.get(angle.id);
      if (!view) return [];
      if (!includeFace && view.angle === 'face' && !fresh.has('face')) return [];
      return [view];
    });
    const frames = [];
    for (const view of ordered) frames.push({ label: view.label, png: await readPng(view.imageUri) });
    setBusy('Building the sheet…');
    const sheetUri = await persistPng(`${who.id}-sheet-${Date.now()}.png`, composeSheet(frames));
    const nextBook: TurnaroundBook = {
      characterId: who.id,
      seed,
      expressions: undefined,
      expressionSheetUri: undefined,
      versions: [
        {
          id: `turn_${Date.now().toString(36)}`,
          createdAt: Date.now(),
          note: who.notes?.trim() || 'First turnaround',
          views: ordered,
          sheetUri,
          character: who,
        },
        ...(book?.versions ?? []),
      ].slice(0, 8),
    };
    await remember(nextBook);
    setIndex(0);
    setCompare(false);
    return warnings.filter((item, position, all) => all.indexOf(item) === position);
  }

  async function drawAll() {
    if (!character || busy) return;
    setError(null);
    setNotice(null);
    try {
      const warnings = await drawAngles(character, anglesFor(includeFace), []);
      setNotice(warnings[0] ?? 'Turnaround is ready. Swipe the picture, or use the angle names.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The turnaround could not be drawn.');
    } finally {
      setBusy(null);
    }
  }

  async function applyFix() {
    if (!character || !version || busy) return;
    setError(null);
    setNotice(null);
    const { character: next, summary } = applyInstruction(character, instruction);
    if (next === character) {
      setError(summary);
      return;
    }
    await studio.commitCharacter(next);
    const angles =
      scope === 'all' || !current
        ? anglesFor(includeFace)
        : anglesFor(includeFace).filter((angle) => angle.id === current.angle);
    try {
      const warnings = await drawAngles(next, angles, scope === 'all' ? [] : version.views);
      setInstruction('');
      setNotice([summary, warnings[0]].filter(Boolean).join(' '));
    } catch (caught) {
      setError(
        `${caught instanceof Error ? caught.message : 'Could not redraw.'} The character note was saved. Draw the turnaround again when you are ready.`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function undo() {
    if (!book || busy) return;
    const next = undoVersion(book);
    if (!next) {
      setError('There is no earlier version to go back to.');
      return;
    }
    const restored = next.versions[0]?.character;
    if (restored) await studio.commitCharacter(restored);
    await remember(next);
    setCompare(false);
    setNotice('Restored the previous turnaround.');
  }

  async function drawExpressions() {
    if (!character || busy) return;
    const seed = book?.seed ?? (hashSeed(character.id) % 2_147_483_646) + 1;
    const size = studio.settings.customSize
      ? { width: studio.settings.width, height: studio.settings.height }
      : pixelsForAspect(studio.aspectId);
    setError(null);
    setNotice(null);
    try {
      const [openaiKey, saladKey] = await Promise.all([readApiKey(), readSaladKey()]);
      const gen = getGenerator();
      const checkpoint = gen.installed.find((item) => item.versionId === gen.checkpointId);
      if (studio.settings.provider === 'salad' && !studio.settings.saladEndpoint.trim()) {
        throw new Error('Add the Salad gateway on Connect before drawing a turnaround in the cloud.');
      }
      if (studio.settings.provider === 'salad' && !saladKey) {
        throw new Error('Add the Salad API key in Connect before drawing a turnaround in the cloud.');
      }
      const frontBytes = version?.views.find((view) => view.angle === 'front')
        ? await readPng(version.views.find((view) => view.angle === 'front')!.imageUri)
        : null;
      const cells = [];
      for (const pose of EXPRESSION_POSES) {
        setBusy(`Drawing ${pose.label}…`);
        const prompt = expressionPrompt(character, pose.id);
        const result = await produceImages({
          provider: studio.settings.provider,
          prompt,
          negative: studio.settings.provider === 'salad' ? gen.negative : studio.settings.negative,
          styleId: studio.styleId,
          aspectId: 'avatar',
          character: { ...character, expression: pose.id, pose: 'portrait' },
          count: 1,
          width: studio.settings.provider === 'salad' ? snapSize(gen.width) : size.width,
          height: studio.settings.provider === 'salad' ? snapSize(gen.height) : size.height,
          steps: studio.settings.provider === 'salad' ? gen.steps : studio.settings.steps,
          cfg: studio.settings.provider === 'salad' ? gen.cfg : studio.settings.cfg,
          sampler: studio.settings.provider === 'salad' ? samplerId(gen.sampler) : studio.settings.sampler,
          seedMode: 'fixed',
          seed,
          saladModel: checkpoint ? String(checkpoint.versionId) : studio.settings.saladModel,
          loras: studio.settings.loras,
          openaiModel: studio.settings.openaiModel,
          openaiKey,
          saladEndpoint: studio.settings.saladEndpoint,
          saladKey,
          platform: Platform.OS,
          variant: 20 + EXPRESSION_POSES.findIndex((item) => item.id === pose.id),
          referencePng: frontBytes,
        });
        const uri = await persistPng(`${character.id}-${pose.id}-${Date.now()}.png`, result.pngs[0]);
        cells.push({ id: pose.id, label: pose.label, prompt, imageUri: uri });
      }
      setBusy('Building the expression sheet…');
      const frames = [];
      for (const cell of cells) frames.push({ label: cell.label, png: await readPng(cell.imageUri) });
      const expressionSheetUri = await persistPng(`${character.id}-expressions-${Date.now()}.png`, composeSheet(frames, 160, 160));
      const base: TurnaroundBook = book ?? {
        characterId: character.id,
        seed,
        versions: [],
      };
      await remember({ ...base, expressions: cells, expressionSheetUri });
      setNotice('Expression sheet is ready. Same character, same seed.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The expression sheet could not be drawn.');
    } finally {
      setBusy(null);
    }
  }

  async function saveSheet(uri: string | undefined, filename: string) {
    if (!uri) return;
    setError(null);
    try {
      setNotice(await saveImageToLibrary(uri, filename));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the sheet.');
    }
  }

  if (!studio.ready || !ready) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.kicker}>Different views</Text>
      </SafeAreaView>
    );
  }

  if (!character) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Pressable accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
          <Text style={styles.kicker}>Different views</Text>
        </Pressable>
        <Text style={styles.body}>That character is not on this phone anymore.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Different views</Text>
          <Text style={styles.title}>{character.name}</Text>
        </View>
        <Text style={styles.meshLink}>Flat sheet</Text>
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text testID="consistency-note" style={styles.note}>
          {note}
        </Text>
        <Pressable style={styles.check} onPress={() => setIncludeFace((value) => !value)}>
          <Ionicons name={includeFace ? 'checkbox' : 'square-outline'} size={20} color={colors.sakura} />
          <Text style={styles.checkText}>Include a close-up of the face</Text>
        </Pressable>
        <Pressable testID="turnaround-draw" style={styles.primary} disabled={Boolean(busy)} onPress={() => void drawAll()}>
          <Text style={styles.primaryText}>{busy && !version ? busy : 'Draw every angle'}</Text>
        </Pressable>

        {!version ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No views yet.</Text>
            <Text style={styles.body}>
              Front, three-quarter, side, three-quarter back, and back. One seed for the whole set. You can save them as a single sheet.
            </Text>
          </View>
        ) : (
          <>
            <View testID="turnaround-viewer" style={styles.stage} onLayout={onFrame}>
              <ScrollView
                ref={scroller}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={onSwipe}
                scrollEventThrottle={16}>
                {views.map((view) => (
                  <Image key={view.angle} source={{ uri: view.imageUri }} style={{ width: frameWidth, height: frameWidth * 1.15 }} contentFit="contain" />
                ))}
              </ScrollView>
              <View style={styles.stageBar}>
                <Text style={styles.stageLabel}>{current?.label}</Text>
                <Text style={styles.stageCount}>
                  {safeIndex + 1} / {views.length}
                </Text>
              </View>
            </View>
            <View style={styles.angles}>
              {views.map((view, position) => (
                <Pressable
                  key={view.angle}
                  testID={`angle-${view.angle}`}
                  onPress={() => showAngle(position)}
                  style={[styles.angle, position === safeIndex && styles.angleOn]}>
                  <Text style={[styles.angleText, position === safeIndex && styles.angleTextOn]}>{view.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable testID="rotate-view" style={styles.ghost} onPress={() => showAngle(safeIndex + 1)}>
              <Ionicons name="sync" size={16} color={colors.cyan} />
              <Text style={styles.ghostText}>Rotate to the next angle</Text>
            </Pressable>
            {compare && before ? (
              <View testID="compare-panel" style={styles.compare}>
                <View style={styles.compareCol}>
                  <Text style={styles.compareLabel}>Before</Text>
                  <Image source={{ uri: before.imageUri }} style={styles.compareImage} contentFit="contain" />
                </View>
                <View style={styles.compareCol}>
                  <Text style={styles.compareLabel}>After</Text>
                  <Image source={{ uri: current?.imageUri }} style={styles.compareImage} contentFit="contain" />
                </View>
              </View>
            ) : null}
            <Pressable testID="save-sheet" style={styles.ghost} onPress={() => void saveSheet(version.sheetUri, `${character.name}-turnaround.png`)}>
              <Ionicons name="download-outline" size={16} color={colors.sakura} />
              <Text style={styles.ghostText}>Save the turnaround sheet</Text>
            </Pressable>
            <Image testID="turnaround-sheet" source={{ uri: version.sheetUri }} style={styles.sheet} contentFit="contain" />

            <Text style={styles.section}>Fix in plain words</Text>
            <Text style={styles.body}>
              Say what is wrong. Yume writes it onto the character, then redraws this angle or every angle. Earlier versions stay so you can undo or compare.
            </Text>
            <TextInput
              testID="fix-input"
              value={instruction}
              onChangeText={setInstruction}
              placeholder="Make her hair longer"
              placeholderTextColor={colors.faint}
              style={styles.input}
            />
            <View style={styles.angles}>
              <Pressable testID="fix-scope-one" onPress={() => setScope('one')} style={[styles.angle, scope === 'one' && styles.angleOn]}>
                <Text style={[styles.angleText, scope === 'one' && styles.angleTextOn]}>This view</Text>
              </Pressable>
              <Pressable testID="fix-scope-all" onPress={() => setScope('all')} style={[styles.angle, scope === 'all' && styles.angleOn]}>
                <Text style={[styles.angleText, scope === 'all' && styles.angleTextOn]}>All views</Text>
              </Pressable>
            </View>
            <Pressable testID="fix-apply" style={styles.primary} disabled={Boolean(busy)} onPress={() => void applyFix()}>
              <Text style={styles.primaryText}>{busy && version ? busy : 'Apply and redraw'}</Text>
            </Pressable>
            <View style={styles.angles}>
              <Pressable testID="undo-version" style={styles.ghost} disabled={!previous || Boolean(busy)} onPress={() => void undo()}>
                <Text style={[styles.ghostText, !previous && styles.disabled]}>Undo</Text>
              </Pressable>
              <Pressable
                testID="compare-toggle"
                style={styles.ghost}
                disabled={!before}
                onPress={() => setCompare((value) => !value)}>
                <Text style={[styles.ghostText, !before && styles.disabled]}>{compare ? 'Hide comparison' : 'Compare before / after'}</Text>
              </Pressable>
            </View>
            {book && book.versions.length > 0 ? (
              <View style={styles.history}>
                {book.versions.map((item, position) => (
                  <Text key={item.id} style={styles.historyLine}>
                    {position === 0 ? 'Now' : `Earlier ${position}`}: {item.note}
                  </Text>
                ))}
              </View>
            ) : null}

            <Text style={styles.section}>Expression sheet</Text>
            <Text style={styles.body}>Happy, angry, sad, surprised, sleepy, and determined. Same character and the same seed.</Text>
            <Pressable testID="expression-sheet" style={styles.ghost} disabled={Boolean(busy)} onPress={() => void drawExpressions()}>
              <Text style={styles.ghostText}>{busy ? busy : 'Draw the expression sheet'}</Text>
            </Pressable>
            {book?.expressions?.length ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.exprRow}>
                  {book.expressions.map((cell) => (
                    <View key={cell.id} style={styles.expr}>
                      <Image source={{ uri: cell.imageUri }} style={styles.exprImage} contentFit="cover" />
                      <Text style={styles.exprLabel}>{cell.label}</Text>
                    </View>
                  ))}
                </ScrollView>
                <Pressable style={styles.ghost} onPress={() => void saveSheet(book.expressionSheetUri, `${character.name}-expressions.png`)}>
                  <Text style={styles.ghostText}>Save the expression sheet</Text>
                </Pressable>
              </>
            ) : null}
          </>
        )}
        {notice ? <Text style={styles.ok}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 4 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12 },
  kicker: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 26 },
  meshLink: { color: colors.gold, fontFamily: font.black, fontSize: 14 },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  note: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText: { color: colors.text, fontFamily: font.bold, fontSize: 14 },
  primary: { backgroundColor: colors.sakura, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: colors.ink, fontFamily: font.black, fontSize: 15 },
  empty: { borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, padding: 16, gap: 6 },
  emptyTitle: { color: colors.text, fontFamily: font.black, fontSize: 18 },
  stage: { borderRadius: 18, overflow: 'hidden', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  stageBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  stageLabel: { color: colors.text, fontFamily: font.black, fontSize: 15 },
  stageCount: { color: colors.faint, fontFamily: font.bold, fontSize: 13 },
  angles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  angle: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.card },
  angleOn: { borderColor: colors.sakura, backgroundColor: colors.cardAlt },
  angleText: { color: colors.muted, fontFamily: font.bold, fontSize: 13 },
  angleTextOn: { color: colors.text },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  ghostText: { color: colors.cyan, fontFamily: font.black, fontSize: 14 },
  disabled: { color: colors.faint },
  sheet: { width: '100%', height: 180, borderRadius: 12, backgroundColor: colors.ink },
  section: { color: colors.text, fontFamily: font.logo, fontSize: 22, marginTop: 8 },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: font.semibold,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  history: { gap: 4 },
  historyLine: { color: colors.faint, fontFamily: font.semibold, fontSize: 13 },
  compare: { flexDirection: 'row', gap: 8 },
  compareCol: { flex: 1, gap: 4 },
  compareLabel: { color: colors.sakura, fontFamily: font.black, fontSize: 12, textTransform: 'uppercase' },
  compareImage: { width: '100%', height: 220, borderRadius: 12, backgroundColor: colors.ink },
  exprRow: { gap: 8 },
  expr: { width: 96, gap: 4 },
  exprImage: { width: 96, height: 96, borderRadius: 12, backgroundColor: colors.ink },
  exprLabel: { color: colors.muted, fontFamily: font.bold, fontSize: 12, textAlign: 'center' },
  ok: { color: colors.ok, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
});
