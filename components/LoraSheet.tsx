import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fetchResources } from '@/src/lib/checkpointUse';
import { loraBaseWarning, toInstalled, type CatalogCheckpoint } from '@/src/lib/checkpoints';
import { addLoraWithTriggers, useGenerator } from '@/src/lib/genstore';
import { readCivitaiToken } from '@/src/lib/storage';
import { loraChoices } from '@/src/lib/loraGate';
import { readKeptLibrary } from '@/src/lib/restoreModels';
import { normalizeEndpoint } from '@/src/lib/salad';
import { readSaladKey } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

const STRENGTHS = [0.4, 0.6, 0.8, 1, 1.2];

function isLora(item: { type?: string }): boolean {
  const type = (item.type || '').toLowerCase();
  return type === 'lora' || type === 'locon' || type === 'lycoris';
}

export function LoraSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const studio = useStudio();
  const gen = useGenerator();
  const checkpoint = gen.installed.find((item) => item.versionId === gen.checkpointId);
  const [rows, setRows] = useState<CatalogCheckpoint[]>([]);
  const [strength, setStrength] = useState(0.8);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const local = gen.installed.filter(isLora);
    void (async () => {
      if (studio.settings.provider !== 'salad') {
        if (!cancelled) setRows(local);
        return;
      }
      const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
      const key = await readSaladKey();
      if (!endpoint || !key) {
        if (!cancelled) setRows([]);
        return;
      }
      try {
        const [catalog, kept] = await Promise.all([fetchResources(endpoint, key), readKeptLibrary()]);
        if (cancelled) return;
        const choices = loraChoices(catalog.models, kept.models);
        setRows(choices.map((item) => ({ ...item, type: 'LORA', hash: '', sha256: '', isDefault: false })));
      } catch (caught) {
        if (!cancelled) {
          setRows([]);
          setError(caught instanceof Error ? caught.message : 'The LoRA list could not be read.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, studio.settings.provider, studio.settings.saladEndpoint, gen.installed]);

  function browse() {
    onClose();
    router.push({ pathname: '/(tabs)/explore', params: { type: 'LORA' } });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View testID="lora-sheet" style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Add LoRA</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.link}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.section}>Strength</Text>
            <View style={styles.strengths}>
              {STRENGTHS.map((value) => (
                <Pressable key={value} onPress={() => setStrength(value)} style={[styles.chip, strength === value && styles.chipOn]}>
                  <Text style={styles.chipText}>{value}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.section}>Installed</Text>
            {rows.length === 0 ? <Text style={styles.meta}>No LoRA is installed on the server yet.</Text> : null}
            {rows.map((item) => {
              const warning = loraBaseWarning(checkpoint?.baseModel ?? '', item.baseModel || '');
              const added = gen.loras.some((lora) => lora.versionId === item.versionId || lora.name === item.filename || lora.name === item.name);
              return (
                <View key={item.versionId} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.meta}>
                      {item.baseModel || 'unknown base'}
                      {'restoring' in item && item.restoring ? ' · restoring' : ''}
                      {item.triggers?.length ? ` · ${item.triggers.join(', ')}` : ''}
                    </Text>
                    {warning ? <Text style={styles.warn}>{warning}</Text> : null}
                  </View>
                  <Pressable
                    testID={`add-lora-${item.versionId}`}
                    onPress={() => {
                      const resource = toInstalled(item);
                      void (async () => {
                        const token = await readCivitaiToken().catch(() => null);
                        const result = await addLoraWithTriggers({
                          name: resource.filename || resource.name,
                          weight: strength,
                          modelId: resource.modelId,
                          versionId: resource.versionId,
                          triggers: resource.triggers,
                          baseModel: resource.baseModel,
                          type: resource.type,
                        }, token);
                        setError(result.message);
                      })();
                    }}>
                    <Text style={styles.link}>{added ? 'Update' : 'Add'}</Text>
                  </Pressable>
                </View>
              );
            })}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable testID="browse-civitai-loras" onPress={browse}>
              <Text style={styles.link}>Browse Civitai LoRAs</Text>
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
  strengths: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { borderColor: colors.sakura, backgroundColor: colors.cardAlt },
  chipText: { color: colors.text, fontFamily: font.semibold, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12 },
  name: { color: colors.text, fontFamily: font.black, fontSize: 15 },
  meta: { color: colors.muted, fontFamily: font.semibold, fontSize: 13 },
  warn: { color: colors.sakura, fontFamily: font.semibold, fontSize: 12, marginTop: 4 },
  link: { color: colors.sakura, fontFamily: font.black, fontSize: 14 },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 13 },
});
