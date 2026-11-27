import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompareSlider } from '@/components/CompareSlider';
import { compareDirection } from '@/src/lib/compare';
import { colors, font } from '@/src/theme';

export function ResultCompare({ original, results, onOpen }: { original: string; results: string[]; onOpen?: (index: number) => void }) {
  const [width, setWidth] = useState(0);
  const [focus, setFocus] = useState(Math.max(0, results.length - 1));
  const [zoomed, setZoomed] = useState(false);
  const [showNew, setShowNew] = useState(true);
  const direction = compareDirection(width);
  const safeFocus = results.length ? Math.min(focus, results.length - 1) : 0;
  const chosen = results[safeFocus];

  useEffect(() => {
    setFocus(Math.max(0, results.length - 1));
    setShowNew(true);
  }, [results.length]);

  return (
    <View testID="result-compare" style={styles.wrap} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={[styles.strip, direction === 'column' ? styles.stack : styles.row]}>
        <Pane label="Original" uri={original} onPress={() => onOpen?.(-1)} />
        {results.map((uri, index) => (
          <Pane
            key={`${index}-${uri.slice(-12)}`}
            label={`Result ${index + 1}`}
            uri={uri}
            selected={index === safeFocus}
            onPress={() => {
              setFocus(index);
              setZoomed(false);
              onOpen?.(index);
            }}
          />
        ))}
      </View>
      {chosen ? (
        <View style={styles.detail}>
          <View style={styles.tools}>
            <Text style={styles.hint}>Original beside result {safeFocus + 1}</Text>
            <Pressable testID="compare-zoom" onPress={() => setZoomed((value) => !value)}>
              <Text style={styles.link}>{zoomed ? 'Slider' : 'Zoom'}</Text>
            </Pressable>
          </View>
          {zoomed ? (
            <Pressable testID="compare-toggle" style={styles.zoom} onPress={() => setShowNew((value) => !value)}>
              <Image source={{ uri: showNew ? chosen : original }} style={styles.zoomImage} contentFit="contain" />
              <Text style={styles.zoomLabel}>{showNew ? 'Result · tap for original' : 'Original · tap for result'}</Text>
            </Pressable>
          ) : (
            <CompareSlider before={original} after={chosen} />
          )}
        </View>
      ) : null}
    </View>
  );
}

function Pane({ label, uri, selected, onPress }: { label: string; uri: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.pane, selected && styles.selected]}>
      <Image source={{ uri }} style={styles.thumb} contentFit="contain" />
      <Text style={styles.caption}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  strip: { gap: 8 },
  row: { flexDirection: 'row' },
  stack: { flexDirection: 'column' },
  pane: { flex: 1, minWidth: 120, gap: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 4, backgroundColor: colors.card },
  selected: { borderColor: colors.sakura },
  thumb: { width: '100%', height: 220, borderRadius: 8, backgroundColor: colors.ink },
  caption: { color: colors.muted, fontFamily: font.bold, fontSize: 12, textAlign: 'center' },
  detail: { gap: 8 },
  tools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { color: colors.faint, fontFamily: font.semibold, fontSize: 12 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 14 },
  zoom: { height: 420, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.card },
  zoomImage: { width: '100%', height: '100%' },
  zoomLabel: { position: 'absolute', left: 8, bottom: 8, color: colors.text, fontFamily: font.bold, fontSize: 12, backgroundColor: colors.card, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
});
