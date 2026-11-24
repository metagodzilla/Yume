import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { filterTiles, galleryTiles, type GalleryTile } from '@/src/lib/gallery';
import { saveImageToLibrary } from '@/src/lib/media';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export function Gallery({ variant = 'grid' }: { variant?: 'grid' | 'strip' }) {
  const studio = useStudio();
  const tiles = useMemo(() => galleryTiles(studio.history), [studio.history]);
  if (variant === 'strip') return <Strip tiles={tiles} />;
  return <Grid tiles={tiles} />;
}

function Strip({ tiles }: { tiles: GalleryTile[] }) {
  const studio = useStudio();
  const shown = tiles.slice(0, 12);
  if (!shown.length) return null;
  return (
    <View style={styles.stripWrap}>
      <View style={styles.row}>
        <Text style={styles.label}>Gallery</Text>
        <Pressable testID="see-all-gallery" onPress={() => router.push('/(tabs)/shelf')}>
          <Text style={styles.link}>See all</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {shown.map((tile) => (
          <Pressable key={tile.key} onPress={() => openTile(studio, tiles, tile)}>
            <Image source={{ uri: tile.uri }} style={styles.stripThumb} contentFit="cover" recyclingKey={tile.key} cachePolicy="memory-disk" />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function Grid({ tiles }: { tiles: GalleryTile[] }) {
  const studio = useStudio();
  const width = useWindowDimensions().width;
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const visible = useMemo(() => filterTiles(tiles, { query, favoritesOnly }), [tiles, query, favoritesOnly]);
  const cell = Math.floor((Math.min(width, 480) - 32 - 16) / 3);

  function toggle(key: string) {
    setSelected((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  async function removeSelected() {
    const keys = visible.filter((tile) => selected.includes(tile.key)).map((tile) => ({ generationId: tile.generationId, index: tile.index }));
    await studio.removeGalleryTiles(keys);
    setSelected([]);
    setSelecting(false);
  }

  async function saveSelected() {
    const chosen = visible.filter((tile) => selected.includes(tile.key));
    for (const tile of chosen) {
      await saveImageToLibrary(tile.uri, `yume-${tile.generationId}-${tile.index + 1}.png`);
    }
    setNote(`Saved ${chosen.length}.`);
    setSelected([]);
    setSelecting(false);
  }

  return (
    <View>
      <View style={styles.row}>
        <TextInput
          testID="gallery-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Search prompts"
          placeholderTextColor={colors.faint}
          style={styles.search}
        />
        <Pressable onPress={() => setFavoritesOnly((value) => !value)}>
          <Text style={styles.link}>{favoritesOnly ? 'Favorites' : 'All'}</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable
          onPress={() => {
            setSelecting((value) => !value);
            setSelected([]);
          }}>
          <Text style={styles.link}>{selecting ? 'Done' : 'Select'}</Text>
        </Pressable>
        {selecting && selected.length ? (
          <>
            <Pressable onPress={() => void saveSelected()}>
              <Text style={styles.link}>Save {selected.length}</Text>
            </Pressable>
            <Pressable onPress={() => void removeSelected()}>
              <Text style={styles.danger}>Delete {selected.length}</Text>
            </Pressable>
          </>
        ) : null}
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {visible.length === 0 ? <Text style={styles.empty}>No pictures match.</Text> : null}
      <FlatList
        data={visible}
        keyExtractor={(item) => item.key}
        numColumns={3}
        scrollEnabled={false}
        columnWrapperStyle={styles.columns}
        renderItem={({ item }) => {
          const on = selected.includes(item.key);
          return (
            <Pressable
              onLongPress={() => {
                setSelecting(true);
                toggle(item.key);
              }}
              onPress={() => (selecting ? toggle(item.key) : openTile(studio, visible, item))}
              style={{ width: cell, height: cell }}>
              <Image source={{ uri: item.uri }} style={styles.thumb} contentFit="cover" recyclingKey={item.key} cachePolicy="memory-disk" />
              {item.favorite ? <Text style={styles.star}>★</Text> : null}
              {selecting ? <View style={[styles.mark, on && styles.markOn]} /> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function openTile(studio: ReturnType<typeof useStudio>, tiles: GalleryTile[], tile: GalleryTile) {
  const index = Math.max(0, tiles.findIndex((item) => item.key === tile.key));
  studio.openViewer({
    images: tiles.map((item) => item.uri),
    index,
    prompt: tile.prompt,
    title: 'Gallery',
    filename: `yume-${tile.generationId}-${tile.index + 1}.png`,
    generationId: tile.generationId,
    frames: tiles.map((item) => ({ generationId: item.generationId, imageIndex: item.index })),
  });
}

const styles = StyleSheet.create({
  stripWrap: { gap: 8 },
  strip: { gap: 8 },
  stripThumb: { width: 96, height: 128, borderRadius: 12, backgroundColor: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  label: { flex: 1, color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 14 },
  danger: { color: colors.danger, fontFamily: font.black, fontSize: 14 },
  search: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    fontFamily: font.semibold,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  columns: { gap: 8, marginBottom: 8 },
  thumb: { width: '100%', height: '100%', borderRadius: 10, backgroundColor: colors.ink },
  star: { position: 'absolute', top: 4, right: 6, color: colors.gold, fontSize: 14 },
  mark: { position: 'absolute', top: 6, left: 6, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.text },
  markOn: { backgroundColor: colors.sakura, borderColor: colors.sakura },
  empty: { color: colors.muted, fontFamily: font.semibold, fontSize: 14 },
  note: { color: colors.ok, fontFamily: font.semibold, fontSize: 13 },
});
