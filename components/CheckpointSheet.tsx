import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { deleteCatalogCheckpoint, fetchCatalog, pollUseJob, runCheckpointUse } from '@/src/lib/checkpointUse';
import { baseLabel, defaultsForBase, modelCardPress, toInstalled, type CatalogCheckpoint } from '@/src/lib/checkpoints';
import { confirmAction } from '@/src/lib/confirm';
import { applyCheckpoint, getGenerator, removeLocal, replaceServerCheckpoints, useGenerator } from '@/src/lib/genstore';
import { normalizeEndpoint } from '@/src/lib/salad';
import { readSaladKey } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export function CheckpointSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const studio = useStudio();
  const gen = useGenerator();
  const [rows, setRows] = useState<CatalogCheckpoint[]>([]);
  const [activeId, setActiveId] = useState<number | null>(gen.checkpointId);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [using, setUsing] = useState<number | null>(null);
  const [stage, setStage] = useState('');
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const current = getGenerator();
    setError(null);
    setNote(null);
    void (async () => {
      const local = current.installed.filter((item) => item.type === 'Checkpoint');
      if (studio.settings.provider !== 'salad') {
        if (!cancelled) {
          setRows(local);
          setActiveId(current.checkpointId);
          setNote('Demo mode keeps the choice on this phone.');
        }
        return;
      }
      const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
      const key = await readSaladKey();
      if (!endpoint || !key) {
        if (!cancelled) {
          setRows(local);
          setActiveId(current.checkpointId);
          setNote('Connect a gateway to list checkpoints on the server.');
        }
        return;
      }
      try {
        const catalog = await fetchCatalog(endpoint, key);
        if (cancelled) return;
        setRows(catalog.models);
        setActiveId(catalog.activeVersionId);
        replaceServerCheckpoints(catalog.models.map(toInstalled), catalog.activeVersionId);
      } catch (caught) {
        if (cancelled) return;
        setRows(local);
        setActiveId(current.checkpointId);
        setError(caught instanceof Error ? caught.message : 'The server catalog could not be read.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, studio.settings.provider, studio.settings.saladEndpoint]);

  async function onUse(item: CatalogCheckpoint) {
    if (using != null) return;
    const defaults = defaultsForBase(item.baseModel || '', item.recommended);
    const resource = toInstalled(item);
    if (studio.settings.provider !== 'salad') {
      applyCheckpoint(resource, defaults);
      setActiveId(item.versionId);
      setStage('Ready');
      setPercent(100);
      return;
    }
    const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
    const key = await readSaladKey();
    if (!endpoint || !key) {
      setError('Connect a Salad gateway before loading a checkpoint.');
      return;
    }
    setUsing(item.versionId);
    setError(null);
    setStage('Loading checkpoint');
    setPercent(null);
    try {
      await runCheckpointUse({
        endpoint,
        apiKey: key,
        versionId: item.versionId,
        onProgress: (nextStage, nextPercent) => {
          setStage(nextStage);
          setPercent(nextPercent);
        },
      });
      applyCheckpoint(resource, defaults);
      setActiveId(item.versionId);
      setStage('Ready');
      setPercent(100);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The checkpoint could not be loaded.');
    } finally {
      setUsing(null);
    }
  }

  async function onDelete(item: CatalogCheckpoint) {
    if (using != null) return;
    const agreed = await confirmAction('Delete checkpoint', `Remove ${item.name} from the server and free the disk space?`);
    if (!agreed) return;
    setError(null);
    try {
      if (studio.settings.provider === 'salad') {
        const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
        const key = await readSaladKey();
        if (!endpoint || !key) throw new Error('Connect a Salad gateway before deleting a checkpoint.');
        const removed = await deleteCatalogCheckpoint(endpoint, key, item.versionId);
        if (removed.job) {
          setUsing(removed.job.versionId);
          setStage(removed.job.stage || 'Loading checkpoint');
          setPercent(removed.job.percent);
          const finished = await pollUseJob(endpoint, key, removed.job, (nextStage, nextPercent) => {
            setStage(nextStage);
            setPercent(nextPercent);
          });
          setUsing(null);
          if (finished.record) {
            const defaults = defaultsForBase(finished.record.baseModel || '', finished.record.recommended);
            applyCheckpoint(toInstalled(finished.record), defaults);
          }
        }
        const catalog = await fetchCatalog(endpoint, key);
        setRows(catalog.models);
        setActiveId(catalog.activeVersionId);
        replaceServerCheckpoints(catalog.models.map(toInstalled), catalog.activeVersionId);
      } else {
        removeLocal(item.versionId);
        setRows(gen.installed.filter((entry) => entry.type === 'Checkpoint' && entry.versionId !== item.versionId));
      }
    } catch (caught) {
      setUsing(null);
      setError(caught instanceof Error ? caught.message : 'The checkpoint could not be deleted.');
    }
  }

  function browse() {
    onClose();
    router.push(modelCardPress().browse);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View testID="checkpoint-sheet" style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Checkpoint</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.link}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.section}>Installed</Text>
            {rows.length === 0 ? <Text style={styles.meta}>No checkpoint is installed on the server.</Text> : null}
            {rows.map((item) => {
              const active = item.versionId === activeId;
              const loading = using === item.versionId;
              return (
                <View key={item.versionId} style={[styles.row, active && styles.rowOn]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.meta}>
                      {baseLabel(item.baseModel || '')}
                      {active ? ' · Active' : ''}
                    </Text>
                  </View>
                  <Pressable testID={`use-${item.versionId}`} disabled={loading || active} onPress={() => void onUse(item)}>
                    <Text style={[styles.link, (loading || active) && styles.faint]}>{loading ? 'Loading' : 'Use'}</Text>
                  </Pressable>
                  <Pressable testID={`delete-${item.versionId}`} disabled={loading} onPress={() => void onDelete(item)}>
                    <Text style={styles.delete}>Delete</Text>
                  </Pressable>
                </View>
              );
            })}
            {using != null || stage ? (
              <View>
                <Text style={styles.meta}>{stage || 'Loading checkpoint'}</Text>
                <View style={styles.track}>
                  <View style={[styles.bar, { width: percent == null ? '28%' : `${Math.max(0, Math.min(100, percent))}%` }]} />
                </View>
              </View>
            ) : null}
            {note ? <Text style={styles.meta}>{note}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable testID="browse-civitai" onPress={browse}>
              <Text style={styles.link}>Browse Civitai</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '78%', backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 18 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16 },
  title: { color: colors.text, fontFamily: font.black, fontSize: 18 },
  list: { padding: 16, gap: 10 },
  section: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12 },
  rowOn: { borderColor: colors.sakura },
  name: { color: colors.text, fontFamily: font.black, fontSize: 15 },
  meta: { color: colors.muted, fontFamily: font.semibold, fontSize: 13 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 15 },
  faint: { color: colors.faint },
  delete: { color: colors.danger, fontFamily: font.black, fontSize: 15 },
  track: { height: 8, borderRadius: 999, backgroundColor: colors.ink, overflow: 'hidden', marginTop: 6 },
  bar: { height: 8, backgroundColor: colors.gold },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14 },
});
