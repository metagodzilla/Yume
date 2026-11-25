import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { colors } from '@/src/theme';

export function CompareSlider({ before, after }: { before: string; after: string }) {
  const [ratio, setRatio] = useState(0.5);
  const [frameWidth, setFrameWidth] = useState(1);
  const width = useRef(1);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => setRatio(clamp(event.nativeEvent.locationX / width.current)),
      onPanResponderMove: (event) => setRatio(clamp(event.nativeEvent.locationX / width.current)),
    }),
  ).current;
  return (
    <View
      testID="compare-slider"
      style={styles.frame}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width || 1;
        width.current = next;
        setFrameWidth(next);
      }}
      {...pan.panHandlers}>
      <Image source={{ uri: before }} style={StyleSheet.absoluteFill} contentFit="contain" />
      <View style={[styles.clip, { width: `${ratio * 100}%` }]}>
        <Image source={{ uri: after }} style={{ width: frameWidth, height: 360 }} contentFit="contain" />
      </View>
      <View style={[styles.handle, { left: `${ratio * 100}%` }]} />
    </View>
  );
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0.02, Math.min(0.98, value));
}

const styles = StyleSheet.create({
  frame: { height: 360, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.card },
  clip: { height: '100%', overflow: 'hidden' },
  after: { width: 480, height: 360 },
  handle: { position: 'absolute', top: 0, bottom: 0, width: 3, marginLeft: -1.5, backgroundColor: colors.text },
});
