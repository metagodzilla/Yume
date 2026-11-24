import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SAMPLERS } from '@/src/lib/library';
import { uid } from '@/src/lib/id';
import { orderedStyles, useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';
import type { SamplerId, UserStyle } from '@/src/lib/types';

export default function StylesScreen() {
  const studio = useStudio();
  const stylesInOrder = orderedStyles(studio.library.styles);
  const [openId, setOpenId] = useState<string | null>(null);

  function update(style: UserStyle, patch: Partial<UserStyle>) {
    void studio.upsertStyle({ ...style, ...patch });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.kicker}>Styles</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.body}>
          Built-ins are starting points. Edit the prefix, suffix, and negative. Draw uses whatever is saved here.
        </Text>
        <View style={styles.actions}>
          <Pressable
            style={styles.add}
            onPress={() => {
              const id = uid('style');
              void studio.upsertStyle({
                id,
                name: 'New style',
                note: 'Custom',
                blurb: '',
                prefix: '',
                suffix: '',
                negative: '',
                steps: 28,
                cfg: 5.5,
                sampler: 'euler_a',
                swatch: ['#ff8ec7', '#c084fc', '#7ee7ff'],
                builtIn: false,
                order: stylesInOrder.length,
              });
              setOpenId(id);
            }}>
            <Text style={styles.addText}>New style</Text>
          </Pressable>
          <Pressable onPress={() => void studio.restoreStyles()}>
            <Text style={styles.link}>Restore built-ins</Text>
          </Pressable>
        </View>
        {stylesInOrder.map((style, index) => {
          const open = openId === style.id;
          return (
            <View key={style.id} style={styles.card}>
              <Pressable onPress={() => setOpenId(open ? null : style.id)}>
                <Text style={styles.name}>{style.name}</Text>
                <Text style={styles.note}>{style.builtIn ? 'Built-in template' : 'Yours'} · {style.note}</Text>
              </Pressable>
              <View style={styles.row}>
                <Pressable disabled={index === 0} onPress={() => void studio.moveStyle(style.id, -1)}>
                  <Text style={styles.link}>Up</Text>
                </Pressable>
                <Pressable disabled={index === stylesInOrder.length - 1} onPress={() => void studio.moveStyle(style.id, 1)}>
                  <Text style={styles.link}>Down</Text>
                </Pressable>
                <Pressable onPress={() => void studio.duplicateStyle(style.id)}>
                  <Text style={styles.link}>Duplicate</Text>
                </Pressable>
                <Pressable onPress={() => void studio.deleteStyle(style.id)}>
                  <Text style={styles.danger}>Delete</Text>
                </Pressable>
              </View>
              {open ? (
                <View style={styles.form}>
                  <Field label="Name" value={style.name} onChange={(name) => update(style, { name })} />
                  <Field label="Note" value={style.note} onChange={(note) => update(style, { note })} />
                  <Field label="Prefix" value={style.prefix} onChange={(prefix) => update(style, { prefix })} multiline />
                  <Field label="Suffix" value={style.suffix} onChange={(suffix) => update(style, { suffix })} multiline />
                  <Field label="Negative" value={style.negative} onChange={(negative) => update(style, { negative })} multiline />
                  <Field label="Steps" value={String(style.steps)} onChange={(value) => update(style, { steps: numberOf(value, style.steps) })} />
                  <Field label="CFG" value={String(style.cfg)} onChange={(value) => update(style, { cfg: numberOf(value, style.cfg) })} />
                  <Text style={styles.note}>Sampler</Text>
                  <View style={styles.row}>
                    {SAMPLERS.map((sampler) => (
                      <Pressable
                        key={sampler.id}
                        onPress={() => update(style, { sampler: sampler.id as SamplerId })}
                        style={[styles.chip, style.sampler === sampler.id && styles.chipOn]}>
                        <Text style={styles.chipText}>{sampler.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.note}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} multiline={multiline} style={[styles.input, multiline && styles.area]} placeholderTextColor={colors.faint} />
    </View>
  );
}

function numberOf(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  kicker: { color: colors.sakura, fontFamily: font.black, letterSpacing: 1, textTransform: 'uppercase' },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  add: { backgroundColor: colors.sakura, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  addText: { color: colors.ink, fontFamily: font.black },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 8 },
  name: { color: colors.text, fontFamily: font.black, fontSize: 16 },
  note: { color: colors.faint, fontFamily: font.semibold, fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  link: { color: colors.sakura, fontFamily: font.black },
  danger: { color: colors.danger, fontFamily: font.black },
  form: { gap: 8 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
    color: colors.text,
    fontFamily: font.semibold,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  area: { minHeight: 64, textAlignVertical: 'top' },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 6 },
  chipOn: { borderColor: colors.sakura },
  chipText: { color: colors.text, fontFamily: font.bold, fontSize: 12 },
});
