import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CheckpointSheet } from '@/components/CheckpointSheet';
import { LoraSheet } from '@/components/LoraSheet';
import { Gallery } from '@/components/Gallery';
import { characterClause } from '@/src/lib/prompt';
import { composeGenerationPrompt, drawFrames, generationParams, samplerId, sentPositiveText } from '@/src/lib/draw';
import { sendClientReport } from '@/src/lib/clientReport';
import { rememberFault } from '@/src/lib/reportText';
import { baseLabel, modelCardPress } from '@/src/lib/checkpoints';
import { STUDIO_SIZES, STUDIO_STYLES } from '@/src/lib/animeStudio';
import { SAMPLERS, sizesFor } from '@/src/lib/defaultModel';
import { extractLoras } from '@/src/lib/a1111';
import { loraPage } from '@/src/lib/civitai';
import { openLink } from '@/src/lib/openLink';
import { patchGenerator, resetBuiltPrompt, resetModelDefaults, resetQualityTags, useGenerator } from '@/src/lib/genstore';
import { DISK_RESET_NOTE, modelPresence } from '@/src/lib/keptModels';
import { restoreMissingModels, useRestoringIds } from '@/src/lib/restoreModels';
import { ensureSelectedLoras } from '@/src/lib/ensureLoras';
import { friendlyLoraMessage } from '@/src/lib/loraGate';
import { endpointDiffersFromLive, LIVE_GATEWAY_URL, normalizeEndpoint } from '@/src/lib/salad';
import { chooseSeeds } from '@/src/lib/seeds';
import { persistPng, readApiKey, readCivitaiToken, readSaladKey } from '@/src/lib/storage';
import { uid } from '@/src/lib/id';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';
import type { Generation } from '@/src/lib/types';

export default function GenerateScreen() {
  const studio = useStudio();
  const gen = useGenerator();
  const [loraSheet, setLoraSheet] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [negativeOpen, setNegativeOpen] = useState(false);
  const [lastSeeds, setLastSeeds] = useState<number[]>([]);
  const [picker, setPicker] = useState(false);
  const checkpoint = gen.installed.find((item) => item.versionId === gen.checkpointId) ?? gen.installed[0];
  const restoringIds = useRestoringIds();
  const restoring = checkpoint ? modelPresence(checkpoint.versionId, [], restoringIds) === 'restoring' : false;
  useEffect(() => {
    if (studio.settings.provider !== 'salad') return;
    const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
    if (!endpoint) return;
    void (async () => {
      const key = await readSaladKey();
      const token = await readCivitaiToken().catch(() => null);
      if (key) await restoreMissingModels({ endpoint, apiKey: key, civitaiToken: token }).catch(() => undefined);
    })();
  }, [studio.settings.provider, studio.settings.saladEndpoint]);
  const latest = studio.history[0];
  const parsed = extractLoras(gen.prompt).loras;
  const character = studio.selectedCharacter;
  const characterText = character ? characterClause(character) : '';
  const finalPrompt = sentPositiveText(gen, characterText);

  useEffect(() => {
    void import('@/src/lib/genstore').then(({ hydrateFromDisk }) => hydrateFromDisk());
  }, []);

  async function generate() {
    if (busy) return;
    const prompt = composeGenerationPrompt(gen, character ? characterClause(character) : '');
    if (!prompt.trim()) {
      setError('Write a prompt. Quality tags can be turned off if you want the box to be the whole prompt.');
      return;
    }
    setBusy(true);
    setError(null);
    const started = Date.now();
    setStatus(studio.settings.provider === 'salad' ? 'Sending it to Salad…' : 'Drawing on this phone…');
    try {
      const chosen = chooseSeeds({ locked: !gen.seedRandom, seedText: gen.seed, count: gen.count });
      const seed = chosen.requestSeed;
      const [saladKey] = await Promise.all([readSaladKey(), readApiKey()]);
      if (studio.settings.provider === 'salad') {
        const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
        const token = await readCivitaiToken().catch(() => null);
        if (endpoint && saladKey) {
          await ensureSelectedLoras({
            loras: gen.loras,
            endpoint,
            apiKey: saladKey,
            civitaiToken: token,
            onProgress: (label) => setStatus(label),
          });
        }
      }
      const result = await drawFrames({
        state: gen,
        prompt,
        seed,
        provider: studio.settings.provider,
        endpoint: normalizeEndpoint(studio.settings.saladEndpoint),
        apiKey: saladKey,
        character,
      });
      const id = uid('gen');
      const imageUris: string[] = [];
      for (let index = 0; index < result.pngs.length; index += 1) {
        imageUris.push(await persistPng(`${id}-${index}.png`, result.pngs[index]));
      }
      const params = generationParams(gen, prompt, seed);
      const record: Generation = {
        id,
        createdAt: Date.now(),
        userPrompt: gen.prompt,
        enhancedPrompt: prompt,
        finalPrompt: prompt,
        negative: gen.negative,
        styleId: 'watercolor',
        styleName: params.model,
        aspectId: gen.height >= gen.width ? 'wallpaper' : 'landscape',
        count: imageUris.length,
        characterId: character?.id ?? null,
        characterName: character?.name ?? null,
        imageUris,
        source: studio.settings.provider === 'salad' ? 'salad' : 'demo',
        model: params.model,
        provider: studio.settings.provider === 'salad' ? 'salad' : 'demo',
        enhance: false,
        seed: (result.seeds[0] ?? chosen.seeds[0]) ?? null,
        seeds: result.seeds.length ? result.seeds : chosen.seeds,
        steps: gen.steps,
        cfg: gen.cfg,
        sampler: samplerId(gen.sampler),
        width: gen.width,
        height: gen.height,
        saladModel: checkpoint?.filename ?? '',
        loras: gen.loras.map((lora, index) => ({
          id: `${lora.name}-${index}`,
          name: lora.name,
          weight: lora.weight,
          ...(lora.modelId ? { modelId: lora.modelId } : {}),
          ...(lora.versionId ? { versionId: lora.versionId } : {}),
        })),
        warning: result.warning,
        durationMs: Date.now() - started,
      };
      await studio.rememberGeneration(record);
      const used = result.seeds.length ? result.seeds : chosen.seeds;
      setLastSeeds(used);
      setStatus(`${result.warning ? `${result.warning} ` : ''}Seed ${used.join(', ')}.`);
    } catch (caught) {
      const message = friendlyLoraMessage(caught instanceof Error ? caught.message : 'The image could not be drawn.');
      setError(message);
      const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
      rememberFault({ time: Date.now(), source: 'generate', message, endpoint });
      const key = await readSaladKey();
      if (endpoint && key) void sendClientReport(endpoint, key).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Generator</Text>
            <Text style={styles.title}>Yume</Text>
          </View>
          <Pressable testID="open-import" onPress={() => router.push('/import')}>
            <Text style={styles.link}>Import</Text>
          </Pressable>
        </View>
        <Pressable
          testID="gen-checkpoint"
          style={styles.checkpoint}
          onPress={() => {
            if (modelCardPress().action === 'open-sheet') setPicker(true);
          }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.checkpointName}>{checkpoint?.name ?? 'No checkpoint'}</Text>
            <Text style={styles.meta}>
              {baseLabel(checkpoint?.baseModel ?? '')} · {restoring ? 'restoring' : checkpoint?.isDefault ? 'Active' : checkpoint?.version}
            </Text>
            <Text style={styles.hint}>{DISK_RESET_NOTE}</Text>
          </View>
        </Pressable>
        <CheckpointSheet visible={picker} onClose={() => setPicker(false)} />
        <Text style={styles.label}>Anime Studio</Text>
        <View style={styles.row}>
          {STUDIO_STYLES.map((style) => (
            <Pressable
              key={style.id}
              testID={`studio-${style.id}`}
              onPress={() => patchGenerator({ studioStyle: gen.studioStyle === style.id ? 'off' : style.id })}
              style={[styles.chipButton, gen.studioStyle === style.id && styles.chipOn]}>
              <Text style={styles.chipText}>{style.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>Prompt</Text>
        <TextInput
          testID="gen-prompt"
          value={gen.prompt}
          onChangeText={(prompt) => patchGenerator({ prompt })}
          placeholder="1girl, shrine maiden, rain, looking at viewer"
          placeholderTextColor={colors.faint}
          multiline
          style={styles.prompt}
        />
        <View style={styles.row}>
          <Text style={styles.label}>Quality tags</Text>
          <Pressable testID="reset-quality-tags" onPress={() => resetQualityTags(checkpoint?.baseModel ?? '', checkpoint?.name ?? '')}>
            <Text style={styles.link}>Reset</Text>
          </Pressable>
        </View>
        <TextInput
          testID="gen-quality"
          value={gen.quality}
          onChangeText={(quality) => patchGenerator({ quality, qualityEdited: true })}
          placeholder="masterpiece, best quality"
          placeholderTextColor={colors.faint}
          multiline
          style={styles.negative}
        />
        <Text style={styles.hint}>These tags are added at the end of the sent prompt. Editing them keeps your text when you switch models.</Text>
        <Text style={styles.label}>Extra prompt</Text>
        <TextInput
          testID="gen-extra"
          value={gen.extraPrompt}
          onChangeText={(extraPrompt) => patchGenerator({ extraPrompt })}
          placeholder="tags or text added as-is, kept when you switch models"
          placeholderTextColor={colors.faint}
          multiline
          style={styles.negative}
        />
        <View style={styles.finalBox}>
          <View style={styles.row}>
            <Text style={styles.label}>Sent prompt</Text>
            <Pressable testID="copy-final-prompt" onPress={() => void Clipboard.setStringAsync(finalPrompt)}>
              <Text style={styles.link}>Copy</Text>
            </Pressable>
          </View>
          <Text testID="final-prompt" selectable style={styles.final}>
            {finalPrompt || 'The prompt is empty.'}
          </Text>
          <Pressable testID="reset-built-prompt" onPress={() => resetBuiltPrompt(checkpoint?.baseModel ?? '', checkpoint?.name ?? '')}>
            <Text style={styles.link}>Reset prompt</Text>
          </Pressable>
          <Pressable onPress={() => setNegativeOpen((open) => !open)}>
            <Text style={styles.hint}>{negativeOpen ? 'Hide final negative' : 'Final negative'}</Text>
          </Pressable>
          {negativeOpen ? (
            <Text testID="final-negative" selectable style={styles.final}>
              {gen.negative || 'No negative prompt.'}
            </Text>
          ) : null}
        </View>
        <Text style={styles.hint}>
          (word:1.2) weights, [de-emphasis], {'<lora:name:0.8>'}, BREAK, and embedding names are kept. Quality tags and trigger words can be added in front.
        </Text>
        <View style={styles.row}>
          <Pressable onPress={() => patchGenerator({ qualityTags: !gen.qualityTags })}>
            <Text style={styles.link}>{gen.qualityTags ? 'Quality tags on' : 'Quality tags off'}</Text>
          </Pressable>
          <Pressable onPress={() => patchGenerator({ triggers: !gen.triggers })}>
            <Text style={styles.link}>{gen.triggers ? 'Triggers on' : 'Triggers off'}</Text>
          </Pressable>
        </View>
        <Text style={styles.label}>Negative prompt</Text>
        <TextInput
          testID="gen-negative"
          value={gen.negative}
          onChangeText={(negative) => patchGenerator({ negative })}
          multiline
          style={styles.negative}
        />
        <Text style={styles.label}>LoRAs</Text>
        <Pressable testID="gen-lora-add" onPress={() => setLoraSheet(true)}>
          <Text style={styles.link}>Add LoRA</Text>
        </Pressable>
        <LoraSheet visible={loraSheet} onClose={() => setLoraSheet(false)} />
        <View style={styles.row}>
          {gen.loras.map((lora) => {
            const page = loraPage(lora);
            return (
              <View key={`${lora.name}-${lora.versionId ?? lora.weight}`} style={styles.chipButton}>
                <Pressable onPress={() => openLink(page.url)}>
                  <Text style={styles.chipText}>{page.label === 'Search on Civitai' ? `Search ${lora.name}` : lora.name}</Text>
                </Pressable>
                <Text style={styles.chipText}>{lora.weight}</Text>
                <Pressable onPress={() => patchGenerator({ loras: gen.loras.filter((item) => item !== lora) })}>
                  <Text style={styles.chipText}>×</Text>
                </Pressable>
              </View>
            );
          })}
          {parsed.map((lora) => (
            <Text key={`tag-${lora.name}`} style={styles.chip}>
              from prompt {lora.name}:{lora.weight}
            </Text>
          ))}
        </View>
        <Pressable
          testID="reset-model-defaults"
          onPress={() => resetModelDefaults(checkpoint?.baseModel ?? '', checkpoint?.name ?? '')}>
          <Text style={styles.link}>Reset to model defaults</Text>
        </Pressable>
        <Text style={styles.label}>Sampler</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {SAMPLERS.map((sampler) => (
            <Pressable key={sampler} onPress={() => patchGenerator({ sampler })} style={[styles.chipButton, gen.sampler === sampler && styles.chipOn]}>
              <Text style={styles.chipText}>{sampler}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.grid}>
          <Field label="Steps" value={String(gen.steps)} onChange={(value) => patchGenerator({ steps: clamp(value, 1, 50, 25) })} />
          <Field label="CFG" value={String(gen.cfg)} onChange={(value) => patchGenerator({ cfg: clamp(value, 1, 20, 6) })} />
          <Field label="Clip skip" value={String(gen.clipSkip)} onChange={(value) => patchGenerator({ clipSkip: clamp(value, 1, 4, 2) })} />
          <Field label="Count" value={String(gen.count)} onChange={(value) => patchGenerator({ count: clamp(value, 1, 4, 1) })} />
        </View>
        <View style={styles.row}>
          <TextInput
            testID="gen-seed"
            value={gen.seedRandom ? 'random' : gen.seed}
            editable={!gen.seedRandom}
            onChangeText={(seed) => patchGenerator({ seed: seed.replace(/[^\d]/g, ''), seedRandom: false })}
            keyboardType="number-pad"
            style={[styles.input, { flex: 1 }]}
          />
          <Pressable testID="seed-lock" onPress={() => patchGenerator({ seedRandom: !gen.seedRandom })}>
            <Text style={styles.link}>{gen.seedRandom ? 'Seed unlocked' : 'Seed locked'}</Text>
          </Pressable>
        </View>
        {gen.studioStyle !== 'off' ? (
          <View style={styles.row}>
            {STUDIO_SIZES.map((size) => (
              <Pressable
                key={size.label}
                onPress={() => patchGenerator({ width: size.width, height: size.height })}
                style={[styles.chipButton, gen.width === size.width && gen.height === size.height && styles.chipOn]}>
                <Text style={styles.chipText}>{size.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text style={styles.label}>Size · {checkpoint?.baseModel}</Text>
        <View style={styles.row}>
          {sizesFor(checkpoint?.baseModel ?? 'SDXL 1.0').map((size) => (
            <Pressable
              key={size.label}
              onPress={() => patchGenerator({ width: size.width, height: size.height })}
              style={[styles.chipButton, gen.width === size.width && gen.height === size.height && styles.chipOn]}>
              <Text style={styles.chipText}>{size.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable testID="hires-toggle" onPress={() => patchGenerator({ hires: !gen.hires })}>
          <Text style={styles.link}>{gen.hires ? 'Hires fix on' : 'Hires fix off'}</Text>
        </Pressable>
        {gen.hires ? (
          <View style={styles.row}>
            {['Latent', 'Anime ESRGAN'].map((name) => (
              <Pressable key={name} onPress={() => patchGenerator({ hiresUpscaler: name })} style={[styles.chipButton, gen.hiresUpscaler === name && styles.chipOn]}>
                <Text style={styles.chipText}>{name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {gen.hires ? (
          <Text style={styles.hint}>
            {gen.hiresUpscaler}, scale {gen.hiresScale}, denoise {gen.hiresDenoise}, {gen.hiresSteps} steps. The second pass is img2img. Anime ESRGAN is used when that file is on the server.
          </Text>
        ) : null}
        <View style={styles.row}>
          {(['txt2img', 'img2img', 'inpaint'] as const).map((mode) => (
            <Pressable key={mode} onPress={() => patchGenerator({ mode })} style={[styles.chipButton, gen.mode === mode && styles.chipOn]}>
              <Text style={styles.chipText}>{mode}</Text>
            </Pressable>
          ))}
        </View>
        {gen.mode !== 'txt2img' ? (
          <Text style={styles.hint}>
            Denoise {gen.denoise}. On Salad, attach the source from a turnaround or a saved frame in a later pass. Demo records the mode and does not edit pixels.
          </Text>
        ) : null}
        <Text style={styles.label}>Embeddings</Text>
        <TextInput
          value={gen.embeddings}
          onChangeText={(embeddings) => patchGenerator({ embeddings })}
          placeholder="embedding token, another"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          style={styles.input}
        />
        <Pressable testID="gen-generate" style={styles.go} disabled={busy} onPress={() => void generate()}>
          <Text style={styles.goText}>{busy ? 'Drawing…' : `Generate ${gen.count}`}</Text>
        </Pressable>
        {status ? <Text style={styles.ok}>{status}</Text> : null}
        {lastSeeds.length ? (
          <Pressable testID="reuse-seed" onPress={() => patchGenerator({ seed: String(lastSeeds[0]), seedRandom: false })}>
            <Text style={styles.link}>Reuse seed {lastSeeds.join(', ')}</Text>
          </Pressable>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {studio.settings.provider === 'salad' && endpointDiffersFromLive(studio.settings.saladEndpoint) ? (
          <Pressable testID="use-live-server" onPress={() => void studio.saveSaladEndpoint(LIVE_GATEWAY_URL)}>
            <Text style={styles.link}>Use live server</Text>
          </Pressable>
        ) : null}
        <Gallery variant="strip" />
        <View style={styles.row}>
          <Pressable onPress={() => router.push('/cast')}>
            <Text style={styles.link}>Cast</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/styles')}>
            <Text style={styles.link}>Style helper</Text>
          </Pressable>
        </View>
        {studio.characters.filter((item) => item.saved).length ? (
          <View style={styles.row}>
            {studio.characters
              .filter((item) => item.saved)
              .map((item) => (
                <Pressable key={item.id} onPress={() => studio.selectCharacter(studio.selectedCharacterId === item.id ? null : item.id)}>
                  <Text style={[styles.chip, studio.selectedCharacterId === item.id && styles.chipOnText]}>{item.name || 'Unnamed'}</Text>
                </Pressable>
              ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" style={styles.input} />
    </View>
  );
}

function clamp(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center' },
  kicker: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 14 },
  checkpoint: { borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, padding: 12 },
  checkpointName: { color: colors.text, fontFamily: font.black, fontSize: 16 },
  meta: { color: colors.muted, fontFamily: font.semibold, fontSize: 13 },
  label: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  finalBox: { gap: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 10 },
  final: { color: colors.text, fontFamily: font.semibold, fontSize: 13, lineHeight: 18 },
  prompt: {
    minHeight: 110,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: font.semibold,
    fontSize: 16,
    padding: 12,
    textAlignVertical: 'top',
  },
  negative: {
    minHeight: 72,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: font.semibold,
    fontSize: 14,
    padding: 12,
    textAlignVertical: 'top',
  },
  hint: { color: colors.faint, fontFamily: font.semibold, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: font.semibold,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  weight: { width: 64 },
  chip: { color: colors.text, fontFamily: font.bold, fontSize: 13 },
  chipButton: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.card },
  chipOn: { borderColor: colors.sakura, backgroundColor: colors.cardAlt },
  chipOnText: { color: colors.sakura },
  chipText: { color: colors.text, fontFamily: font.bold, fontSize: 13 },
  grid: { flexDirection: 'row', gap: 8 },
  go: { backgroundColor: colors.sakura, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  goText: { color: colors.ink, fontFamily: font.black, fontSize: 16 },
  ok: { color: colors.ok, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
});
