import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { pickPreview, thumbnailUrl, type CivitaiModel, type ContentFilter } from '@/src/lib/civitai';
import { colors, font } from '@/src/theme';

export function ModelThumb({ model, filter }: { model: CivitaiModel; filter: ContentFilter }) {
  const preview = pickPreview(model, filter);
  const [failed, setFailed] = useState(false);
  const label = !preview ? 'No image' : preview.kind === 'video' ? 'Video' : failed ? 'Preview unavailable' : '';
  if (!preview || preview.kind === 'video' || failed) {
    return (
      <View style={styles.box}>
        <Text style={styles.label}>{label}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: thumbnailUrl(preview.url) }}
      placeholder={preview.blurhash ? { blurhash: preview.blurhash } : undefined}
      style={styles.box}
      contentFit="cover"
      transition={150}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  box: { width: 72, height: 96, borderRadius: 10, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  label: { color: colors.muted, fontFamily: font.bold, fontSize: 11, textAlign: 'center', paddingHorizontal: 4 },
});
