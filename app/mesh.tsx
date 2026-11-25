import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeshStage, type MeshStageHandle } from '@/components/MeshStage';
import { parseGlb } from '@/src/lib/glb';
import { saveImageToLibrary, shareFile } from '@/src/lib/media';
import { DEMO_MESH_NOTE, MESH_LIMIT, MESH_STEPS, PICTURE_SERVER_MESH_MESSAGE, TRELLIS_MESH_NOTE, demoMesh, meshPlan, requestSaladMesh, type SavedMesh } from '@/src/lib/mesh';
import { composeSheet } from '@/src/lib/sheet';
import { loadMeshes, loadTurnarounds, persistPng, readApiKey, readPng, readSaladKey, saveMeshes } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function MeshScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const studio = useStudio();
  const character = studio.characters.find((item) => item.id === id) ?? null;
  const [saved, setSaved] = useState<SavedMesh | null>(null);
  const [glb, setGlb] = useState<Uint8Array | null>(null);
  const [step, setStep] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(DEMO_MESH_NOTE);
  const [sheetUri, setSheetUri] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spin, setSpin] = useState(true);
  const [ready, setReady] = useState(false);
  const stage = useRef<MeshStageHandle>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    loadMeshes().then(async (list) => {
      const found = list.find((item) => item.characterId === id) ?? null;
      if (!live || !found) return;
      setSaved(found);
      setNote(found.note);
      setSheetUri(found.sheetUri ?? null);
      try {
        setGlb(await readPng(found.glbUri));
      } catch {
        setError('The saved mesh could not be opened. Make it again.');
      }
    });
    return () => {
      live = false;
    };
  }, [id]);

  async function remember(next: SavedMesh, bytes: Uint8Array) {
    const list = [next, ...(await loadMeshes()).filter((item) => item.characterId !== next.characterId)];
    await saveMeshes(list);
    setSaved(next);
    setGlb(bytes);
    setNote(next.note);
    setSheetUri(next.sheetUri ?? null);
  }

  async function make() {
    if (!character || busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    setReady(false);
    try {
      setStep(0);
      const books = await loadTurnarounds();
      const front = books.find((book) => book.characterId === character.id)?.versions[0]?.views.find((view) => view.angle === 'front');
      const provider = studio.settings.provider;
      if (provider !== 'salad') {
        setStep(1);
        await pause(220);
        setStep(2);
        await pause(220);
        setStep(3);
        const result = demoMesh(character);
        parseGlb(result.glb);
        setStep(MESH_STEPS.length);
        const glbUri = await persistPng(`${character.id}-mesh-${Date.now()}.glb`, result.glb);
        await remember(
          {
            characterId: character.id,
            createdAt: Date.now(),
            glbUri,
            note: result.note,
            model: result.model,
            mode: result.mode,
          },
          result.glb,
        );
        setStatus(front ? 'The front drawing stayed on the phone. Demo studio did not turn those pixels into a mesh.' : 'No front drawing yet. This figure uses the traits only.');
        return;
      }
      if (!front) {
        throw new Error('Draw the turnaround first. The front view is what a 3D mesh is built from.');
      }
      if (meshPlan(studio.settings.meshEndpoint) === 'stand-in') {
        setStep(1);
        const result = demoMesh(character);
        parseGlb(result.glb);
        setStep(MESH_STEPS.length);
        const glbUri = await persistPng(`${character.id}-mesh-${Date.now()}.glb`, result.glb);
        await remember(
          {
            characterId: character.id,
            createdAt: Date.now(),
            glbUri,
            note: result.note,
            model: result.model,
            mode: result.mode,
          },
          result.glb,
        );
        throw new Error(PICTURE_SERVER_MESH_MESSAGE);
      }
      setStep(1);
      const [saladKey] = await Promise.all([readSaladKey(), readApiKey()]);
      const endpoint = studio.settings.meshEndpoint.trim();
      const frontPng = await readPng(front.imageUri);
      const book = books.find((item) => item.characterId === character.id);
      const views = [];
      for (const view of book?.versions[0]?.views.filter((item) => item.angle !== 'front') ?? []) {
        views.push({ angle: view.angle, png: await readPng(view.imageUri) });
      }
      setStatus('Waiting on the mesh container. The first boot downloads TRELLIS and can take several minutes. The gateway gives up after about 100 seconds, so wait until the group is Ready.');
      const result = await requestSaladMesh({ endpoint, apiKey: saladKey ?? '', frontPng, views });
      parseGlb(result.glb);
      setStep(3);
      const glbUri = await persistPng(`${character.id}-mesh-${Date.now()}.glb`, result.glb);
      setStep(MESH_STEPS.length);
      await remember(
        {
          characterId: character.id,
          createdAt: Date.now(),
          glbUri,
          note: result.mode === 'trellis' ? TRELLIS_MESH_NOTE : result.note,
          model: result.model,
          mode: result.mode,
        },
        result.glb,
      );
      setStatus(result.mode === 'trellis' ? 'TRELLIS used the front view only.' : result.note);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The mesh could not be built.');
    } finally {
      setBusy(false);
    }
  }

  async function saveSheet() {
    const current = stage.current;
    if (!current || !character) return;
    setError(null);
    try {
      const frames = (['front', 'side', 'back'] as const).map((view) => {
        const png = current.shot(view);
        if (!png) throw new Error('The viewer is not ready for a snapshot yet.');
        return { label: view, png };
      });
      const sheet = composeSheet(frames, 200, 260);
      const uri = await persistPng(`${character.id}-mesh-sheet-${Date.now()}.png`, sheet);
      setSheetUri(uri);
      if (saved) {
        const next = { ...saved, sheetUri: uri };
        const list = [next, ...(await loadMeshes()).filter((item) => item.characterId !== character.id)];
        await saveMeshes(list);
        setSaved(next);
      }
      setStatus(await saveImageToLibrary(uri, `${character.name}-3d-turnaround.png`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the 3D sheet.');
    }
  }

  async function shareGlb() {
    if (!saved) return;
    setError(null);
    try {
      setStatus(await shareFile(saved.glbUri, `${character?.name ?? 'character'}.glb`, 'model/gltf-binary'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not share the GLB.');
    }
  }

  if (!studio.ready) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.kicker}>3D turnaround</Text>
      </SafeAreaView>
    );
  }

  if (!character) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
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
          <Text style={styles.kicker}>3D turnaround</Text>
          <Text style={styles.title}>{character.name}</Text>
        </View>
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
        <Text testID="mesh-note" style={styles.note}>
          {note} {MESH_LIMIT}
        </Text>
        <Pressable testID="make-3d" style={styles.primary} disabled={busy} onPress={() => void make()}>
          <Text style={styles.primaryText}>{busy ? 'Building the mesh…' : glb ? 'Build again' : 'Build 3D turnaround'}</Text>
        </Pressable>
        {step >= 0 ? (
          <View testID="mesh-progress" style={styles.steps}>
            {MESH_STEPS.map((label, index) => (
              <Text key={label} style={[styles.step, index < step && styles.stepDone, index === step && styles.stepNow]}>
                {index < step ? 'Done' : index === step ? 'Now' : 'Next'} · {label}
              </Text>
            ))}
          </View>
        ) : null}
        {glb ? (
          <>
            <View testID="mesh-viewer" style={styles.viewer}>
              <MeshStage
                ref={stage}
                glb={glb}
                spin={spin}
                onReady={() => setReady(true)}
              />
            </View>
            <View style={styles.controls}>
              <Pressable testID="mesh-spin" onPress={() => setSpin((value) => !value)}>
                <Text style={styles.link}>{spin ? 'Stop spin' : 'Auto-spin'}</Text>
              </Pressable>
              <Pressable testID="mesh-zoom-out" onPress={() => stage.current?.zoom(0.35)}>
                <Text style={styles.link}>Zoom out</Text>
              </Pressable>
              <Pressable testID="mesh-zoom-in" onPress={() => stage.current?.zoom(-0.35)}>
                <Text style={styles.link}>Zoom in</Text>
              </Pressable>
            </View>
            <Text style={styles.body}>Drag to turn the model. Pinch, or use the zoom buttons. Auto-spin starts on.</Text>
            <Pressable testID="save-3d-sheet" style={styles.ghost} disabled={!ready} onPress={() => void saveSheet()}>
              <Text style={styles.link}>Save 3D turnaround sheet</Text>
            </Pressable>
            <Pressable testID="share-glb" style={styles.ghost} onPress={() => void shareGlb()}>
              <Text style={styles.link}>Share the .glb</Text>
            </Pressable>
            {sheetUri ? <Image testID="mesh-sheet" source={{ uri: sheetUri }} style={styles.sheet} contentFit="contain" /> : null}
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No mesh yet.</Text>
            <Text style={styles.body}>
              Make 3D builds a textured GLB you can spin and export. A TRELLIS gateway in the 3D URL uses the front view. Without that URL, Yume opens a stand-in figure and says this picture cloud cannot build meshes.
            </Text>
          </View>
        )}
        {status ? <Text style={styles.ok}>{status}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 4 },
  kicker: { color: colors.gold, fontFamily: font.black, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 26 },
  scroll: { padding: 16, gap: 12, paddingBottom: 36 },
  note: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  primary: { backgroundColor: colors.sakura, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: colors.ink, fontFamily: font.black, fontSize: 15 },
  steps: { gap: 4 },
  step: { color: colors.faint, fontFamily: font.semibold, fontSize: 13 },
  stepDone: { color: colors.ok },
  stepNow: { color: colors.gold },
  viewer: { height: 420, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 14 },
  ghost: { alignSelf: 'flex-start' },
  sheet: { width: '100%', height: 180, borderRadius: 12, backgroundColor: colors.ink },
  empty: { borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, padding: 16, gap: 6 },
  emptyTitle: { color: colors.text, fontFamily: font.black, fontSize: 18 },
  ok: { color: colors.ok, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
});
