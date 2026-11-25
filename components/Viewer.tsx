import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TasteButtons } from '@/components/TasteButtons';
import { metadataLines, reusePatch } from '@/src/lib/gallery';
import { confirmAction } from '@/src/lib/confirm';
import { patchGenerator } from '@/src/lib/genstore';
import { copyText, saveImageToLibrary, shareImage } from '@/src/lib/media';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export function Viewer() {
  const studio = useStudio();
  const { viewer, closeViewer, setViewerIndex } = studio;
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const viewerKey = viewer ? `${viewer.title}:${viewer.index}:${viewer.images.length}` : '';

  useEffect(() => {
    setNote(null);
    setScale(1);
    scaleRef.current = 1;
  }, [viewerKey]);

  const shiftRef = useRef<(direction: -1 | 1) => void>(() => undefined);
  shiftRef.current = (direction) => {
    if (!viewer || viewer.images.length < 2) return;
    const index = (viewer.index + direction + viewer.images.length) % viewer.images.length;
    setViewerIndex(index);
    setScale(1);
    scaleRef.current = 1;
  };
  const pinch = useRef({ dist: 0, scale: 1 });
  const swiped = useRef(false);
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2 || Math.abs(event.nativeEvent.pageX) > 0,
      onPanResponderGrant: (event) => {
        swiped.current = false;
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) pinch.current = { dist: span(touches), scale: scaleRef.current };
      },
      onPanResponderMove: (event, gesture) => {
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2 && pinch.current.dist > 0) {
          const next = Math.max(1, Math.min(4, pinch.current.scale * (span(touches) / pinch.current.dist)));
          scaleRef.current = next;
          setScale(next);
          return;
        }
        if (!swiped.current && scaleRef.current <= 1.05 && Math.abs(gesture.dx) > 48) {
          swiped.current = true;
          shiftRef.current(gesture.dx > 0 ? -1 : 1);
        }
      },
    }),
  ).current;

  if (!viewer) return null;
  const uri = viewer.images[viewer.index];
  const frame = viewer.frames?.[viewer.index];
  const generation = frame ? studio.history.find((item) => item.id === frame.generationId) : viewer.generationId ? studio.history.find((item) => item.id === viewer.generationId) : undefined;
  const imageIndex = frame?.imageIndex ?? viewer.index;
  const favorite = generation ? (generation.favoriteIndexes ?? []).includes(imageIndex) : false;
  const prompt = generation?.finalPrompt || generation?.userPrompt || viewer.prompt;
  const filename = generation ? `yume-${generation.id}-${imageIndex + 1}.png` : viewer.filename;

  async function run(action: () => Promise<string>) {
    if (!uri || busy) return;
    setBusy(true);
    setNote(null);
    try {
      setNote(await action());
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="fade" onRequestClose={closeViewer} statusBarTranslucent>
      <View style={styles.root}>
        <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={closeViewer} hitSlop={12}>
            <Ionicons name="close" size={28} color={colors.text} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {viewer.title}
          </Text>
          <Text style={styles.count}>
            {viewer.index + 1}/{viewer.images.length}
          </Text>
        </View>

        <View style={styles.stage} {...swipe.panHandlers}>
          {uri ? (
            <Image source={{ uri }} style={[styles.image, { transform: [{ scale }] }]} contentFit="contain" cachePolicy="memory-disk" />
          ) : null}
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable onPress={() => setDetails((open) => !open)}>
            <Text style={styles.link}>{details ? 'Hide details' : 'Details'}</Text>
          </Pressable>
          {details && generation ? (
            <Text style={styles.prompt}>{metadataLines(generation, imageIndex).join('\n')}</Text>
          ) : (
            <Text style={styles.prompt} numberOfLines={3}>
              {prompt || 'Character sheet only'}
            </Text>
          )}
          {note ? <Text style={styles.note}>{note}</Text> : null}
          <View style={styles.actions}>
            <Action icon="download-outline" label="Save" onPress={() => run(() => saveImageToLibrary(uri, filename))} />
            <Action icon="share-social-outline" label="Share" onPress={() => run(() => shareImage(uri, filename))} />
            <Action
              icon="copy-outline"
              label="Prompt"
              onPress={() =>
                run(async () => {
                  await copyText(prompt);
                  return 'Prompt copied.';
                })
              }
            />
          </View>
          {generation ? (
            <View style={styles.actions}>
              <TasteButtons generation={generation} index={imageIndex} />
              <Action
                icon={favorite ? 'heart' : 'heart-outline'}
                label={favorite ? 'Favorited' : 'Favorite'}
                onPress={() => void studio.toggleFavorite(generation.id, imageIndex)}
              />
              <Action
                icon="refresh-outline"
                label="Reuse"
                onPress={() => {
                  studio.remix(generation);
                  patchGenerator(reusePatch(generation, imageIndex));
                  closeViewer();
                  router.push('/(tabs)/create');
                }}
              />
              <Action
                icon="trash-outline"
                label="Delete"
                onPress={() =>
                  void (async () => {
                    const ok = await confirmAction('Delete picture', 'Remove this picture from the gallery on this phone?');
                    if (!ok) return;
                    await studio.removeGalleryTiles([{ generationId: generation.id, index: imageIndex }]);
                  })()
                }
              />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function span(touches: readonly { pageX: number; pageY: number }[]): number {
  const [a, b] = touches;
  if (!a || !b) return 0;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

function Action({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
      <Ionicons name={icon} size={18} color={colors.ink} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07040c' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  title: { flex: 1, color: colors.text, fontFamily: font.bold, fontSize: 16 },
  count: { color: colors.faint, fontFamily: font.bold },
  stage: { flex: 1, overflow: 'hidden' },
  image: { flex: 1, width: '100%', height: '100%' },
  bottom: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  prompt: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 14 },
  note: { color: colors.ok, fontFamily: font.bold, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.sakura,
    borderRadius: 999,
    paddingVertical: 10,
  },
  actionLabel: { color: colors.ink, fontFamily: font.black, fontSize: 13 },
});
