import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBar } from '@/components/AppBar';
import { hydrateQueue, queueAction, queueAll, setAutoResume, useQueue } from '@/src/lib/queuestore';
import { colors, font } from '@/src/theme';

export default function QueueScreen() {
  const queue = useQueue();
  useEffect(() => {
    void hydrateQueue();
  }, []);
  const groups = ['running', 'waiting', 'paused', 'done', 'failed', 'cancelled'] as const;
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBar />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Queue</Text>
        <Text style={styles.body}>
          Jobs stay on this phone if you leave. A running GPU picture cannot pause halfway; Resume starts that picture again. Downloads continue from the last byte when the server allows it. User pauses stay paused until you press Resume.
        </Text>
        <View style={styles.row}>
          <Pressable testID="pause-all" onPress={() => queueAll('pause')}>
            <Text style={styles.link}>Pause all</Text>
          </Pressable>
          <Pressable testID="resume-all" onPress={() => queueAll('resume')}>
            <Text style={styles.resume}>Resume all</Text>
          </Pressable>
          <Pressable testID="cancel-all" onPress={() => queueAll('cancel')}>
            <Text style={styles.link}>Cancel all</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => setAutoResume(!queue.autoResume)}>
          <Text style={styles.body}>{queue.autoResume ? 'Auto-resume when connection returns: on' : 'Auto-resume when connection returns: off'}</Text>
        </Pressable>
        {queue.jobs.length === 0 ? <Text style={styles.body}>Nothing is running or waiting.</Text> : null}
        {groups.map((status) => {
          const jobs = queue.jobs.filter((job) => job.status === status);
          if (!jobs.length) return null;
          return (
            <View key={status} style={styles.group}>
              <Text style={styles.heading}>{status}</Text>
              {jobs.map((job) => (
                <View key={job.id} style={styles.card}>
                  <Text style={styles.name}>{job.title}</Text>
                  <Text style={styles.body}>
                    {job.kind} · {Math.round(job.progress * 100)}%{job.reason ? ` · ${job.reason}` : ''}
                  </Text>
                  <View style={styles.row}>
                    {job.status !== 'paused' ? (
                      <Pressable onPress={() => queueAction('pause', job.id)}>
                        <Text style={styles.link}>Pause</Text>
                      </Pressable>
                    ) : (
                      <Pressable testID="resume-job" onPress={() => queueAction('resume', job.id)}>
                        <Text style={styles.resume}>Resume</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => queueAction('cancel', job.id)}>
                      <Text style={styles.link}>Cancel</Text>
                    </Pressable>
                    {job.status === 'waiting' ? (
                      <Pressable onPress={() => queueAction('top', job.id)}>
                        <Text style={styles.link}>Move to top</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  heading: { color: colors.text, fontFamily: font.black, fontSize: 13, textTransform: 'uppercase' },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  name: { color: colors.text, fontFamily: font.black, fontSize: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 14 },
  resume: { color: '#fff', backgroundColor: colors.accent, borderRadius: 14, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 4, fontFamily: font.black, fontSize: 14 },
  group: { gap: 8 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 12, gap: 6 },
});
