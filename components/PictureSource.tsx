import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { bytesToBase64 } from '@/src/lib/base64';
import { pickLocalImages } from '@/src/lib/fromImage';
import { galleryTiles } from '@/src/lib/gallery';
import { readPng } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export function PictureSource({ label, uri, onPick }: { label: string; uri: string | null; onPick: (bytes: Uint8Array, preview: string) => void }) {
  const studio = useStudio();
  const [note, setNote] = useState<string | null>(null);
  const tiles = galleryTiles(studio.history).slice(0, 8);
  return (
    <View style={styles.wrap}>
      <Pressable
        testID="pick-photo"
        style={styles.chip}
        onPress={() => {
          void (async () => {
            try {
              const picked = await pickLocalImages(1, 0.92);
              const photo = picked?.[0];
              if (!photo) return;
              onPick(photo.bytes, `data:image/jpeg;base64,${bytesToBase64(photo.bytes)}`);
              setNote(null);
            } catch (caught) {
              setNote(caught instanceof Error ? caught.message : 'The photo gallery did not open.');
            }
          })();
        }}>
        <Text style={styles.chipText}>{label}</Text>
      </Pressable>
      {tiles.length ? <Text style={styles.hint}>Or choose one already in Yume</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {tiles.map((tile) => (
          <Pressable
            key={tile.key}
            testID={`gallery-source-${tile.key}`}
            onPress={() => {
              void (async () => {
                const bytes = await readPng(tile.uri);
                onPick(bytes, tile.uri);
              })();
            }}>
            <Image source={{ uri: tile.uri }} style={styles.thumb} contentFit="cover" />
          </Pressable>
        ))}
      </ScrollView>
      {uri ? <Image source={{ uri }} style={styles.preview} contentFit="contain" /> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  chip: { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: colors.text, fontFamily: font.bold, fontSize: 14 },
  hint: { color: colors.faint, fontFamily: font.semibold, fontSize: 12 },
  row: { gap: 8 },
  thumb: { width: 64, height: 84, borderRadius: 8, backgroundColor: colors.card },
  preview: { width: '100%', height: 280, borderRadius: 12, backgroundColor: colors.card },
  note: { color: colors.danger, fontFamily: font.semibold, fontSize: 13 },
});
