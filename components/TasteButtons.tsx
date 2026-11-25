import { Pressable, StyleSheet, Text, View } from 'react-native';

import { shotFromGeneration } from '@/src/lib/taste';
import { useTasteProfile, voteImage } from '@/src/lib/tasteStore';
import type { Generation } from '@/src/lib/types';
import { colors, font } from '@/src/theme';

export function TasteButtons({ generation, index, compact = false }: { generation: Generation; index: number; compact?: boolean }) {
  const taste = useTasteProfile();
  const id = `${generation.id}:${index}`;
  const current = taste.votes.find((vote) => vote.id === id)?.vote;
  function choose(vote: 'like' | 'dislike') {
    voteImage({
      id,
      generationId: generation.id,
      index,
      vote,
      at: Date.now(),
      shot: shotFromGeneration(generation),
    });
  }
  return (
    <View style={styles.row}>
      <Pressable testID={`like-${generation.id}-${index}`} onPress={() => choose('like')}>
        <Text style={[styles.text, current === 'like' && styles.on]}>{compact ? 'Like' : current === 'like' ? 'Liked' : 'Like'}</Text>
      </Pressable>
      <Pressable testID={`dislike-${generation.id}-${index}`} onPress={() => choose('dislike')}>
        <Text style={[styles.text, current === 'dislike' && styles.bad]}>{compact ? 'No' : current === 'dislike' ? 'Disliked' : 'Dislike'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  text: { color: colors.cyan, fontFamily: font.black, fontSize: 12 },
  on: { color: colors.ok },
  bad: { color: colors.danger },
});
