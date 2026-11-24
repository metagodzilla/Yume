import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { SAMPLERS, snapSize } from '@/src/lib/library';
import { uid } from '@/src/lib/id';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';
import type { SamplerId } from '@/src/lib/types';

export function AdvancedPanel() {
  const studio = useStudio();
  const [open, setOpen] = useState(true);
  const providerNote =
    studio.settings.provider === 'salad'
      ? 'These settings are sent to your Salad container.'
      : studio.settings.provider === 'openai'
        ? 'OpenAI uses the prompt and the closest supported frame size. Steps, CFG, sampler, seed, and LoRAs are kept for Remix and for Salad.'
        : 'Demo studio paints on this phone from the prompt below. The other knobs are saved with the picture so Remix can restore them.';

  return (
    <View testID="advanced-panel" style={styles.wrap}>
      <Pressable accessibilityRole="button" onPress={() => setOpen((value) => !value)}>
        <Text style={styles.section}>{open ? 'Advanced  ▾' : 'Advanced  ▸'}</Text>
      </Pressable>
      <Text style={styles.note}>{providerNote}</Text>

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Enhance prompt</Text>
          <Text style={styles.note}>
            {studio.settings.enhance
              ? 'On. The preview adds the style, character, and frame.'
              : 'Off. Raw mode: nothing is wrapped around the preview.'}
          </Text>
        </View>
        <Switch
          testID="enhance-toggle"
          value={studio.settings.enhance}
          onValueChange={studio.setEnhance}
          trackColor={{ false: '#3a2a44', true: colors.sakuraDeep }}
          thumbColor={colors.text}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Expand {'{snippets}'}</Text>
          <Text style={styles.note}>Turns {'{hair_color}'} into one of the words in your library.</Text>
        </View>
        <Switch
          value={studio.settings.expandSnippets}
          onValueChange={studio.setExpandSnippets}
          trackColor={{ false: '#3a2a44', true: colors.sakuraDeep }}
          thumbColor={colors.text}
        />
      </View>

      <View style={styles.labelRow}>
        <Text style={styles.label}>Prompt that will be sent</Text>
        <Pressable onPress={studio.resetPreview}>
          <Text style={styles.link}>Reset</Text>
        </Pressable>
        {studio.settings.expandSnippets ? (
          <Pressable onPress={studio.rerollSnippets}>
            <Text style={styles.link}>Reroll snippets</Text>
          </Pressable>
        ) : null}
      </View>
      {studio.previewDirty ? <Text style={styles.note}>You edited this preview. Reset to rebuild it from the box above.</Text> : null}
      <TextInput
        testID="final-prompt"
        value={studio.preview}
        onChangeText={studio.setPreview}
        multiline
        textAlignVertical="top"
        placeholder="What Yume will actually send"
        placeholderTextColor={colors.faint}
        style={styles.area}
      />

      <View style={styles.labelRow}>
        <Text style={styles.label}>Negative prompt</Text>
        <Pressable onPress={studio.resetTune}>
          <Text style={styles.link}>Use style defaults</Text>
        </Pressable>
      </View>
      <TextInput
        testID="negative-prompt"
        value={studio.settings.negative}
        onChangeText={studio.setNegative}
        multiline
        textAlignVertical="top"
        placeholder="What to avoid"
        placeholderTextColor={colors.faint}
        style={[styles.area, styles.negative]}
      />

      {open ? (
        <View style={styles.grid}>
          <Text style={styles.label}>Seed</Text>
          <View style={styles.row}>
            <Pressable
              onPress={() => studio.setSeedMode('random')}
              style={[styles.chip, studio.settings.seedMode === 'random' && styles.chipOn]}>
              <Text style={styles.chipText}>Random</Text>
            </Pressable>
            <Pressable
              onPress={() => studio.setSeedMode('fixed')}
              style={[styles.chip, studio.settings.seedMode === 'fixed' && styles.chipOn]}>
              <Text style={styles.chipText}>Fixed</Text>
            </Pressable>
            <TextInput
              testID="seed-input"
              value={String(studio.settings.seed)}
              onChangeText={(value) => studio.setSeed(Number(value.replace(/[^0-9]/g, '')) || 0)}
              keyboardType="number-pad"
              style={styles.number}
            />
          </View>
          <Text style={styles.note}>
            {studio.settings.seedMode === 'random'
              ? 'A new seed is chosen each draw, then saved here and on the history card so you can reuse it.'
              : 'This exact seed is sent. Remix from history locks the seed that made that picture.'}
          </Text>

          <View style={styles.pair}>
            <Field label="Steps" testID="steps-input" value={String(studio.settings.steps)} onChange={(value) => studio.setSteps(clamp(value, 1, 50, studio.settings.steps))} />
            <Field label="CFG" testID="cfg-input" value={String(studio.settings.cfg)} onChange={(value) => studio.setCfg(clamp(value, 1, 20, studio.settings.cfg))} />
          </View>

          <Text style={styles.label}>Sampler</Text>
          <View style={styles.row}>
            {SAMPLERS.map((sampler) => {
              const on = studio.settings.sampler === sampler.id;
              return (
                <Pressable key={sampler.id} onPress={() => studio.setSampler(sampler.id as SamplerId)} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={styles.chipText}>{sampler.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Custom size</Text>
              <Text style={styles.note}>Off uses the frame above. Salad needs multiples of 8, from 512 to 1536.</Text>
            </View>
            <Switch
              value={studio.settings.customSize}
              onValueChange={studio.setCustomSize}
              trackColor={{ false: '#3a2a44', true: colors.sakuraDeep }}
              thumbColor={colors.text}
            />
          </View>
          <View style={styles.pair}>
            <Field
              label="Width"
              testID="width-input"
              value={String(studio.settings.width)}
              onChange={(value) => studio.setWidth(snapSize(clamp(value, 512, 1536, studio.settings.width)))}
            />
            <Field
              label="Height"
              testID="height-input"
              value={String(studio.settings.height)}
              onChange={(value) => studio.setHeight(snapSize(clamp(value, 512, 1536, studio.settings.height)))}
            />
          </View>

          <Text style={styles.label}>Batch</Text>
          <View style={styles.row}>
            {[1, 2, 3, 4].map((count) => (
              <Pressable key={count} onPress={() => studio.setCount(count)} style={[styles.chip, studio.count === count && styles.chipOn]}>
                <Text style={styles.chipText}>{count}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Checkpoint</Text>
          <TextInput
            testID="model-input"
            value={studio.settings.saladModel}
            onChangeText={studio.setSaladModel}
            placeholder="Blank uses the server default, Animagine XL 4.0"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.line}
          />

          <View style={styles.labelRow}>
            <Text style={styles.label}>LoRAs</Text>
            <Pressable
              onPress={() => studio.setLoras([...studio.settings.loras, { id: uid('lora'), name: '', weight: 0.8 }])}>
              <Text style={styles.link}>Add</Text>
            </Pressable>
          </View>
          {studio.settings.loras.length === 0 ? <Text style={styles.note}>None. The file has to sit in the container's /loras folder.</Text> : null}
          {studio.settings.loras.map((lora) => (
            <View key={lora.id} style={styles.lora}>
              <TextInput
                value={lora.name}
                onChangeText={(name) =>
                  studio.setLoras(studio.settings.loras.map((item) => (item.id === lora.id ? { ...item, name } : item)))
                }
                placeholder="ribbon.safetensors"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                style={[styles.line, { flex: 1 }]}
              />
              <TextInput
                value={String(lora.weight)}
                onChangeText={(value) =>
                  studio.setLoras(
                    studio.settings.loras.map((item) =>
                      item.id === lora.id ? { ...item, weight: clamp(value, 0, 2, item.weight) } : item,
                    ),
                  )
                }
                keyboardType="decimal-pad"
                style={styles.weight}
              />
              <Pressable onPress={() => studio.setLoras(studio.settings.loras.filter((item) => item.id !== lora.id))}>
                <Text style={styles.link}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Field({ label, value, onChange, testID }: { label: string; value: string; onChange: (value: string) => void; testID: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput testID={testID} value={value} onChangeText={onChange} keyboardType="decimal-pad" style={styles.line} />
    </View>
  );
}

function clamp(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 4 },
  section: {
    color: colors.sakura,
    fontFamily: font.black,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  label: { color: colors.text, fontFamily: font.black, fontSize: 14 },
  note: { color: colors.faint, fontFamily: font.semibold, fontSize: 12, lineHeight: 17 },
  switchRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  labelRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  link: { color: colors.sakura, fontFamily: font.black, fontSize: 13 },
  area: {
    minHeight: 88,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    padding: 12,
  },
  negative: { minHeight: 64 },
  grid: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  pair: { flexDirection: 'row', gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipOn: { borderColor: colors.sakura, backgroundColor: 'rgba(255, 142, 199, 0.16)' },
  chipText: { color: colors.text, fontFamily: font.bold, fontSize: 13 },
  number: {
    minWidth: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
    color: colors.text,
    fontFamily: font.bold,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  line: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
    color: colors.text,
    fontFamily: font.semibold,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  lora: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  weight: {
    width: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
    color: colors.text,
    fontFamily: font.bold,
    paddingHorizontal: 8,
    paddingVertical: 8,
    textAlign: 'center',
  },
});
