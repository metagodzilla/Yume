import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { aspectById } from '@/src/lib/presets';
import type { AspectId } from '@/src/lib/types';
import { colors } from '@/src/theme';

export function FrameGrid({
  uris,
  aspectId,
  onPress,
}: {
  uris: string[];
  aspectId: AspectId;
  onPress: (index: number) => void;
}) {
  const aspect = aspectById(aspectId);
  return (
    <View style={styles.grid}>
      {uris.map((uri, index) => (
        <Pressable
          key={`${uri}-${index}`}
          accessibilityRole="button"
          accessibilityLabel={`Open frame ${index + 1}`}
          onPress={() => onPress(index)}
          style={[styles.cell, aspect.columns === 1 && styles.full]}>
          <Image
            source={{ uri }}
            style={[styles.image, { aspectRatio: aspect.ratio }]}
            contentFit="cover"
            transition={120}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -5,
  },
  cell: {
    width: '50%',
    padding: 5,
  },
  full: {
    width: '100%',
  },
  image: {
    width: '100%',
    borderRadius: 18,
    backgroundColor: colors.cardAlt,
  },
});
