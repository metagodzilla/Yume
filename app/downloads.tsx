import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { controlDownload, fetchInstalls, startDownload } from '@/src/lib/downloadClient';
import { ensureDownloadBackground, rememberDownloadTarget } from '@/src/lib/downloadTask';
import { RECONNECTING, downloadButtons, downloadKind, downloadPercent, downloadSummary, downloadTitle, type DownloadJob } from '@/src/lib/downloads';
import { normalizeEndpoint } from '@/src/lib/salad';
import { readSaladKey } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function DownloadsScreen() {
  const studio = useStudio();
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
      if (!endpoint) {
        if (!cancelled) setBanner('Connect a gateway to see server downloads.');
        return;
      }
      await rememberDownloadTarget(endpoint);
      const key = await readSaladKey();
      if (!key) {
        if (!cancelled) setBanner('Add the Salad API key to see server downloads.');
        return;
      }
      try {
        const next = await fetchInstalls(endpoint, key);
        if (cancelled) return;
        setJobs(next);
        setBanner(null);
        setError(null);
        if (next.some((job) => job.state === 'queued' || job.state === 'downloading' || job.state === 'paused')) {
          void ensureDownloadBackground();
        }
      } catch {
        if (!cancelled) setBanner(RECONNECTING);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [studio.settings.saladEndpoint]);

  async function act(job: DownloadJob, action: 'pause' | 'resume' | 'cancel' | 'retry') {
    const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
    const key = await readSaladKey();
    if (!endpoint || !key) {
      setError('Connect a Salad gateway first.');
      return;
    }
    setError(null);
    try {
      if (action === 'retry' && job.state === 'cancelled') {
        await startDownload(endpoint, key, job.versionId, { type: job.type, name: job.name || job.record?.name, filename: job.record?.filename });
      } else if (action === 'retry') {
        await controlDownload(endpoint, key, job.id, 'resume');
      } else {
        await controlDownload(endpoint, key, job.id, action);
      }
      setJobs(await fetchInstalls(endpoint, key));
      setBanner(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The download could not be updated.';
      if (/network request failed|failed to fetch|network error/i.test(message)) setBanner(RECONNECTING);
      else setError(message);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Downloads</Text>
        <Text style={styles.body}>Checkpoints, LoRAs, and embeddings keep downloading on the server. A dropped connection resumes from the last byte.</Text>
        {banner ? <Text style={styles.warn}>{banner}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {jobs.length === 0 && !banner ? <Text style={styles.body}>No downloads yet. Install a model from Explore.</Text> : null}
        {jobs.map((job) => {
          const buttons = downloadButtons(job.state);
          const percent = downloadPercent(job);
          return (
            <View key={job.id} style={styles.card}>
              <Text style={styles.name}>{downloadTitle(job)}</Text>
              <Text style={styles.body}>
                {downloadKind(job)} · {downloadSummary(job)}
              </Text>
              {job.error && job.state === 'error' ? <Text style={styles.error}>{job.error}</Text> : null}
              <View style={styles.track}>
                <View style={[styles.bar, { width: percent == null ? '28%' : `${percent}%` }]} />
              </View>
              <View style={styles.row}>
                {buttons.pause ? (
                  <Pressable onPress={() => void act(job, 'pause')}>
                    <Text style={styles.link}>Pause</Text>
                  </Pressable>
                ) : null}
                {buttons.resume ? (
                  <Pressable onPress={() => void act(job, 'resume')}>
                    <Text style={styles.link}>Resume</Text>
                  </Pressable>
                ) : null}
                {buttons.retry ? (
                  <Pressable onPress={() => void act(job, 'retry')}>
                    <Text style={styles.link}>Retry</Text>
                  </Pressable>
                ) : null}
                {buttons.cancel ? (
                  <Pressable onPress={() => void act(job, 'cancel')}>
                    <Text style={styles.danger}>Cancel</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 32 },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  name: { color: colors.text, fontFamily: font.black, fontSize: 16 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 15 },
  danger: { color: colors.danger, fontFamily: font.black, fontSize: 15 },
  warn: { color: colors.gold, fontFamily: font.black, fontSize: 15 },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14 },
  card: { gap: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, padding: 12 },
  row: { flexDirection: 'row', gap: 16 },
  track: { height: 8, borderRadius: 999, backgroundColor: colors.ink, overflow: 'hidden' },
  bar: { height: 8, backgroundColor: colors.sakura },
});
