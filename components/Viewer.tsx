import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { copyText, saveImageToLibrary, shareImage } from '@/src/lib/media';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export function Viewer() {
  const { viewer, closeViewer, setViewerIndex } = useStudio();
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const viewerKey = viewer ? `${viewer.title}:${viewer.index}:${viewer.images.length}` : '';

  useEffect(() => {
    setNote(null);
  }, [viewerKey]);

  if (!viewer) return null;
  const uri = viewer.images[viewer.index];
  const multiple = viewer.images.length > 1;

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

        <View style={styles.stage}>
          {multiple ? (
            <Pressable
              accessibilityLabel="Previous frame"
              onPress={() => setViewerIndex((viewer.index + viewer.images.length - 1) % viewer.images.length)}
              style={styles.edge}>
              <Ionicons name="chevron-back" size={28} color={colors.text} />
            </Pressable>
          ) : null}
          {uri ? <Image source={{ uri }} style={styles.image} contentFit="contain" /> : null}
          {multiple ? (
            <Pressable
              accessibilityLabel="Next frame"
              onPress={() => setViewerIndex((viewer.index + 1) % viewer.images.length)}
              style={styles.edge}>
              <Ionicons name="chevron-forward" size={28} color={colors.text} />
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.prompt} numberOfLines={3}>
            {viewer.prompt || 'Character sheet only'}
          </Text>
          {note ? <Text style={styles.note}>{note}</Text> : null}
          <View style={styles.actions}>
            <Action
              icon="download-outline"
              label="Save"
              onPress={() => run(() => saveImageToLibrary(uri, viewer.filename))}
            />
            <Action icon="share-social-outline" label="Share" onPress={() => run(() => shareImage(uri, viewer.filename))} />
            <Action
              icon="copy-outline"
              label="Prompt"
              onPress={() =>
                run(async () => {
                  await copyText(viewer.prompt);
                  return 'Prompt copied.';
                })
              }
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Action({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
      <Ionicons name={icon} size={20} color={colors.ink} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#07040c',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily: font.bold,
    fontSize: 16,
  },
  count: {
    color: colors.faint,
    fontFamily: font.bold,
  },
  stage: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  edge: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    flex: 1,
    height: '100%',
  },
  bottom: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  prompt: {
    color: colors.muted,
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 20,
  },
  note: {
    color: colors.ok,
    fontFamily: font.bold,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.sakura,
    borderRadius: 999,
    paddingVertical: 12,
  },
  actionLabel: {
    color: colors.ink,
    fontFamily: font.black,
    fontSize: 14,
  },
});
