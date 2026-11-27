import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CheckpointSheet } from '@/components/CheckpointSheet';
import { LoraSheet } from '@/components/LoraSheet';
import { Gallery } from '@/components/Gallery';
import { CREATE_PROMPT_FIELDS } from '@/src/lib/createFields';
import { characterClause } from '@/src/lib/prompt';
import { composeGenerationPrompt, drawFrames, generationParams, samplerId, sentPositiveText, sentWithTaste } from '@/src/lib/draw';
import { sendClientReport } from '@/src/lib/clientReport';
import { rememberFault } from '@/src/lib/reportText';
import { applyCheckpoint, installLocal, patchGenerator, resetBuiltPrompt, resetModelDefaults, resetQualityTags, useGenerator } from '@/src/lib/genstore';
import { WAI_ILLUSTRIOUS, baseFamily, baseLabel, illustriousOffer, loraBaseWarning, modelCardPress } from '@/src/lib/checkpoints';
import { triggerGroups } from '@/src/lib/draw';
import { runModelInstall } from '@/src/lib/modelInstall';
import { characterLoras, loraPromptNote, mergeTriggerWords } from '@/src/lib/loraPrompt';
import { generatePromptFromDescribe, namedPeople, type NamedPerson } from '@/src/lib/positiveTags';
import { defaultOutfitTags, sentNegative } from '@/src/lib/draw';
import { STUDIO_SIZES, STUDIO_STYLES } from '@/src/lib/animeStudio';
import { SAMPLERS, sizesFor } from '@/src/lib/defaultModel';
import { extractLoras } from '@/src/lib/a1111';
import { loraPage } from '@/src/lib/civitai';
import { openLink } from '@/src/lib/openLink';
import { DISK_RESET_NOTE, modelPresence } from '@/src/lib/keptModels';
import { restoreMissingModels, useRestoringIds } from '@/src/lib/restoreModels';
import { ensureSelectedLoras } from '@/src/lib/ensureLoras';
import { friendlyLoraMessage } from '@/src/lib/loraGate';
import { endpointDiffersFromLive, LIVE_GATEWAY_URL, normalizeEndpoint } from '@/src/lib/salad';
import { chooseSeeds } from '@/src/lib/seeds';
import { persistPng, readApiKey, readCivitaiToken, readPng, readSaladKey } from '@/src/lib/storage';
import { pickLocalImages } from '@/src/lib/fromImage';
import { bytesToBase64 } from '@/src/lib/base64';
import { bodySizeFromHeight, type BodySize } from '@/src/lib/referencePicture';
import { useCloudGate } from '@/src/lib/cloudGate';
import { cloudIsWaiting, phoneDropNote, shouldUsePhone } from '@/src/lib/phoneFallback';
import { consumeCloudRedo, consumePhoneGenerate } from '@/src/lib/cloudRedo';
import { captureShot, suggestedSettings } from '@/src/lib/taste';
import { useTasteProfile } from '@/src/lib/tasteStore';
import { uid } from '@/src/lib/id';
import { addJob, applyThermal, finishJob, reportJob } from '@/src/lib/queuestore';
import { readPhone } from '@/src/lib/device';
import { classifyHeat, throttleSteps } from '@/src/lib/phonePower';
import { getThrottle } from '@/src/lib/thermalState';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';
import type { Generation } from '@/src/lib/types';

export default function GenerateScreen() {
  const studio = useStudio();
  const cloud = useCloudGate();
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
  const people: NamedPerson[] = namedPeople({
    characters: studio.characters.filter((item) => item.saved || item.id === studio.selectedCharacterId),
    loras: [...gen.installed.filter((item) => /lora/i.test(item.type)), ...gen.loras],
  });
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  async function generatePrompt() {
    setPromptBusy(true);
    setPromptError(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = generatePromptFromDescribe({
        describe: gen.describe,
        prompt: gen.prompt,
        clothes: gen.clothes || '',
        positive: gen.positive,
        autoPrompt: gen.autoPrompt,
        autoClothes: gen.autoClothes,
        autoPositive: gen.autoPositive,
        people,
        baseModel: checkpoint?.baseModel,
        style: gen.studioStyle,
        character,
      });
      if (result.error) {
        setPromptError(result.error);
        return;
      }
      patchGenerator({
        prompt: result.prompt,
        clothes: result.clothes,
        positive: result.positive,
        autoPrompt: result.autoPrompt,
        autoClothes: result.autoClothes,
        autoPositive: result.autoPositive,
        promptAuto: false,
        clothesAuto: false,
        positiveAuto: false,
      });
      if (character && result.clothes !== (character.clothesPrompt ?? '')) {
        void studio.commitCharacter({ ...character, clothesPrompt: result.clothes });
      }
    } catch (caught) {
      setPromptError(caught instanceof Error ? caught.message : 'The prompt could not be generated.');
    } finally {
      setPromptBusy(false);
    }
  }

  useEffect(() => {
    void import('@/src/lib/genstore').then(({ hydrateFromDisk }) => hydrateFromDisk());
  }, []);

  const [referenceUri, setReferenceUri] = useState<string | null>(null);
  const [skeleton, setSkeleton] = useState<string | null>(null);
  const [poseNote, setPoseNote] = useState<string | null>(null);
  const clothesOwner = useRef<string | null>(null);
  useEffect(() => {
    if (!character) {
      clothesOwner.current = null;
      return;
    }
    if (clothesOwner.current === character.id) return;
    clothesOwner.current = character.id;
    const seeded = character.clothesPrompt != null ? character.clothesPrompt : defaultOutfitTags(character, gen.loras).join(', ');
    patchGenerator({ clothes: seeded, clothesAuto: false, autoClothes: seeded, referenceBody: bodySizeFromHeight(character.measurements?.heightCm) });
  }, [character?.id]);

  useEffect(() => {
    if (!gen.referencePose || !referenceUri) {
      setSkeleton(null);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const bytes = await readPng(referenceUri);
          const key = await readSaladKey();
          const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
          if (!endpoint || !key) {
            if (live) setPoseNote('Connect the cloud to preview the fitted skeleton.');
            return;
          }
          const response = await fetch(`${endpoint}/reference/pose`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${key}`,
              'Salad-Api-Key': key,
              'X-Api-Key': key,
            },
            body: JSON.stringify({
              image: bytesToBase64(bytes),
              width: gen.width,
              height: gen.height,
              fit: gen.referenceFit,
              body: gen.referenceBody,
              height_cm: character?.measurements?.heightCm ?? null,
              bust_cm: character?.measurements?.bustCm ?? null,
              hip_cm: character?.measurements?.hipCm ?? null,
            }),
          });
          const payload = (await response.json()) as { skeleton?: string; body?: string; detail?: string };
          if (!response.ok) throw new Error(payload.detail || 'The pose preview failed.');
          if (live && payload.skeleton) {
            setSkeleton(`data:image/png;base64,${payload.skeleton}`);
            setPoseNote(gen.referenceFit ? `Fitted to a ${payload.body || gen.referenceBody} body.` : 'Original proportions, fitted to the frame.');
          }
        } catch (caught) {
          if (live) setPoseNote(caught instanceof Error ? caught.message : 'The pose preview failed.');
        }
      })();
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [gen.referencePose, gen.referenceFit, gen.referenceBody, gen.width, gen.height, referenceUri, character?.id, character?.measurements?.heightCm, character?.measurements?.bustCm, character?.measurements?.hipCm, studio.settings.saladEndpoint]);

  async function useWaiIllustrious(offer: 'switch' | 'install') {
    const installed = gen.installed.find((item) => item.type === 'Checkpoint' && baseFamily(item.baseModel) === 'Illustrious');
    if (offer === 'switch' && installed) {
      applyCheckpoint(installed);
      setStatus(`Using ${installed.name}.`);
      return;
    }
    setError(null);
    setStatus('Downloading WAI-Illustrious-SDXL…');
    try {
      const key = await readSaladKey();
      const token = await readCivitaiToken().catch(() => null);
      const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
      if (!endpoint || !key) throw new Error('Connect the cloud before installing WAI-Illustrious-SDXL.');
      await runModelInstall({
        endpoint,
        apiKey: key,
        civitaiToken: token,
        versionId: WAI_ILLUSTRIOUS.versionId,
        type: 'Checkpoint',
        name: WAI_ILLUSTRIOUS.name,
        filename: WAI_ILLUSTRIOUS.filename,
        baseModel: WAI_ILLUSTRIOUS.baseModel,
        onProgress: (label) => setStatus(label),
      });
      const record = { ...WAI_ILLUSTRIOUS, hash: '', sha256: '', triggers: [], isDefault: true };
      installLocal(record);
      applyCheckpoint(record);
      setStatus('Using WAI-Illustrious-SDXL.');
    } catch (caught) {
      setStatus(null);
      setError(caught instanceof Error ? caught.message : 'Could not install WAI-Illustrious-SDXL.');
    }
  }

  async function generate(forcedPhone = false) {
    if (busy) return;
    const onPhone = shouldUsePhone({
      provider: studio.settings.provider,
      gate: cloud.gate,
      auto: studio.settings.autoPhoneWhileCloud !== false,
      forced: forcedPhone,
    });
    const prompt = composeGenerationPrompt(gen, character ? characterClause(character) : '');
    if (!prompt.trim()) {
      setError('Write a prompt. Quality tags can be turned off if you want the box to be the whole prompt.');
      return;
    }
    setBusy(true);
    setError(null);
    const started = Date.now();
    const phoneNote = onPhone ? phoneDropNote({ loras: gen.loras.filter((lora) => lora.name.trim()).length, reference: Boolean(gen.referencePose || gen.referenceCopy || gen.referenceStyle) }) : '';
    setStatus(onPhone ? 'Drawing on this phone…' : studio.settings.provider === 'salad' ? 'Sending it to Salad…' : 'Drawing on this phone…');
    const phoneJob = onPhone ? addJob('offline-generate', `On this phone · ${(gen.prompt || 'picture').slice(0, 42)}`) : null;
    try {
      if (onPhone) {
        const reading = await readPhone();
        const heat = classifyHeat({ tempC: reading.tempC, thermalStatus: reading.thermalStatus, lowPower: studio.settings.lowPower });
        if (heat === 'hot' || getThrottle().pauseQueue) {
          applyThermal('pause');
          throw new Error('Phone is hot. The queue is paused until it cools.');
        }
      }
      const chosen = chooseSeeds({ locked: !gen.seedRandom, seedText: gen.seed, count: gen.count });
      const seed = chosen.requestSeed;
      const [saladKey] = await Promise.all([readSaladKey(), readApiKey()]);
      if (studio.settings.provider === 'salad' && !onPhone) {
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
      const phoneState = onPhone
        ? { ...gen, loras: [], referencePose: false, referenceCopy: false, referenceStyle: false, ...throttleSteps(gen.steps, gen.count, getThrottle()) }
        : gen;
      const initPng = !onPhone && referenceUri && (gen.referencePose || gen.referenceCopy || gen.referenceStyle) ? await readPng(referenceUri) : null;
      const result = await drawFrames({
        state: phoneState,
        prompt,
        seed,
        provider: onPhone ? 'demo' : studio.settings.provider,
        endpoint: normalizeEndpoint(studio.settings.saladEndpoint),
        apiKey: saladKey,
        character,
        initPng,
      });
      const id = uid('gen');
      const imageUris: string[] = [];
      for (let index = 0; index < result.pngs.length; index += 1) {
        imageUris.push(await persistPng(`${id}-${index}.png`, result.pngs[index]));
      }
      const tasted = sentWithTaste(gen, prompt, character);
      const params = generationParams(gen, tasted.prompt, seed);
      const record: Generation = {
        id,
        createdAt: Date.now(),
        userPrompt: gen.prompt,
        enhancedPrompt: prompt,
        finalPrompt: tasted.prompt,
        negative: tasted.negative,
        shot: captureShot({
          prompt: gen.prompt,
          clothes: gen.clothes,
          positive: gen.positive,
          extra: gen.extraPrompt,
          quality: gen.quality,
          negative: sentNegative(gen, character),
          checkpoint: params.model,
          checkpointId: gen.checkpointId,
          loras: gen.loras,
          sampler: gen.sampler,
          steps: gen.steps,
          cfg: gen.cfg,
          width: gen.width,
          height: gen.height,
          referencePose: gen.referencePose,
          referencePoseStrength: gen.referencePoseStrength,
          referenceFit: gen.referenceFit,
          referenceBody: gen.referenceBody,
          referenceCopy: gen.referenceCopy,
          referenceDenoise: gen.referenceDenoise,
          referenceStyle: gen.referenceStyle,
          referenceStyleStrength: gen.referenceStyleStrength,
        }),
        styleId: 'watercolor',
        styleName: params.model,
        aspectId: gen.height >= gen.width ? 'wallpaper' : 'landscape',
        count: imageUris.length,
        characterId: character?.id ?? null,
        characterName: character?.name ?? null,
        imageUris,
        source: onPhone || studio.settings.provider !== 'salad' ? 'demo' : 'salad',
        model: params.model,
        provider: onPhone || studio.settings.provider !== 'salad' ? 'demo' : 'salad',
        phoneRan: onPhone,
        warning: [phoneNote, result.warning].filter(Boolean).join(' '),
        enhance: false,
        seed: (result.seeds[0] ?? chosen.seeds[0]) ?? null,
        seeds: result.seeds.length ? result.seeds : chosen.seeds,
        steps: gen.steps,
        cfg: gen.cfg,
        sampler: samplerId(gen.sampler),
        width: gen.width,
        height: gen.height,
        saladModel: checkpoint?.filename ?? '',
        loras: onPhone ? [] : gen.loras.map((lora, index) => ({
          id: `${lora.name}-${index}`,
          name: lora.name,
          weight: lora.weight,
          ...(lora.modelId ? { modelId: lora.modelId } : {}),
          ...(lora.versionId ? { versionId: lora.versionId } : {}),
          ...(lora.prompt != null ? { prompt: lora.prompt } : {}),
          ...(lora.enabled === false ? { enabled: false } : {}),
          ...(lora.kind ? { kind: lora.kind } : {}),
          ...(lora.triggers?.length ? { triggers: lora.triggers } : {}),
        })),
        regionLayout: gen.regionLayout,
        durationMs: Date.now() - started,
      };
      await studio.rememberGeneration(record);
      const used = result.seeds.length ? result.seeds : chosen.seeds;
      setLastSeeds(used);
      if (phoneJob) finishJob(phoneJob.id);
      setStatus(`${phoneNote ? `${phoneNote} ` : ''}${result.warning ? `${result.warning} ` : ''}Seed ${used.join(', ')}.`);
    } catch (caught) {
      const message = friendlyLoraMessage(caught instanceof Error ? caught.message : 'The image could not be drawn.');
      if (phoneJob) reportJob(phoneJob.id, 0, message, 'failed');
      setError(message);
      const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
      rememberFault({ time: Date.now(), source: 'generate', message, endpoint });
      const key = await readSaladKey();
      if (endpoint && key) void sendClientReport(endpoint, key).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const generateRef = useRef(generate);
  generateRef.current = generate;
  useFocusEffect(
    useCallback(() => {
      if (consumePhoneGenerate()) {
        void generateRef.current(true);
        return;
      }
      if (!consumeCloudRedo()) return;
      if (cloud.gate !== 'ready') {
        setError('The cloud is not ready yet. New pictures stay on the phone until it is.');
        return;
      }
      void generateRef.current(false);
    }, [cloud.gate]),
  );

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
        <Text style={styles.label}>{CREATE_PROMPT_FIELDS[0]}</Text>
        <TextInput
          testID="gen-describe"
          value={gen.describe}
          onChangeText={(describe) => patchGenerator({ describe })}
          placeholder="a girl with pink hair taking a selfie in her room"
          placeholderTextColor={colors.faint}
          multiline
          style={styles.prompt}
        />
        <Text style={styles.hint}>Everyday words. Tap Generate prompt to turn them into tags. Nothing is filled until you tap it, online or offline.</Text>
        <View style={styles.row}>
          <Text style={styles.label}>{CREATE_PROMPT_FIELDS[1]}</Text>
          <Pressable testID="generate-prompt" style={styles.generate} disabled={promptBusy} onPress={() => void generatePrompt()}>
            {promptBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.generateText}>Generate prompt</Text>}
          </Pressable>
        </View>
        {promptError ? <Text testID="prompt-error" style={styles.error}>{promptError}</Text> : null}
        <TextInput
          testID="gen-prompt"
          value={gen.prompt}
          onChangeText={(prompt) => patchGenerator({ prompt, promptAuto: false })}
          placeholder="1girl, solo, pink hair, selfie"
          placeholderTextColor={colors.faint}
          multiline
          style={styles.prompt}
        />
        <Text style={styles.hint}>Filled from Describe when you tap Generate prompt, without clothing. Your own edits in this box are kept.</Text>
        <View style={styles.row}>
          <Text style={styles.label}>{CREATE_PROMPT_FIELDS[2]}</Text>
          <Pressable testID="clothes-regenerate" onPress={() => void generatePrompt()}>
            <Text style={styles.link}>Generate prompt</Text>
          </Pressable>
          <Pressable
            testID="clear-clothes"
            onPress={() => {
              patchGenerator({ clothes: '', clothesAuto: false, autoClothes: '' });
              if (character) void studio.commitCharacter({ ...character, clothesPrompt: '' });
            }}>
            <Text style={styles.link}>Clear clothes</Text>
          </Pressable>
        </View>
        <TextInput
          testID="gen-clothes"
          value={gen.clothes || ''}
          onChangeText={(clothes) => {
            patchGenerator({ clothes, clothesAuto: false });
            if (character) void studio.commitCharacter({ ...character, clothesPrompt: clothes });
          }}
          placeholder="red bikini, sandals"
          placeholderTextColor={colors.faint}
          multiline
          style={styles.prompt}
        />
        <Text style={styles.hint}>Outfit only. Generate prompt fills this from the description and keeps your own edits. It is saved on the selected character.</Text>
        <Text style={styles.label}>{CREATE_PROMPT_FIELDS[3]}</Text>
        <TextInput
          testID="gen-positive"
          value={gen.positive}
          onChangeText={(positive) => patchGenerator({ positive, positiveAuto: false })}
          placeholder="supporting detail tags"
          placeholderTextColor={colors.faint}
          multiline
          style={styles.negative}
        />
        <Text style={styles.hint}>
          Generate prompt adds detail tags for {baseFamily(checkpoint?.baseModel ?? '')}, the style, and the selected character. Your own tags stay when you switch models.
        </Text>
        <Text style={styles.label}>{CREATE_PROMPT_FIELDS[4]}</Text>
        <TextInput
          testID="gen-extra"
          value={gen.extraPrompt}
          onChangeText={(extraPrompt) => patchGenerator({ extraPrompt })}
          placeholder="your own text, added as written"
          placeholderTextColor={colors.faint}
          multiline
          style={styles.negative}
        />
        <Text style={styles.hint}>Not filled automatically. Kept when you switch models.</Text>
        <Text style={styles.label}>{CREATE_PROMPT_FIELDS[5]}</Text>
        <TextInput
          testID="gen-negative"
          value={gen.negative}
          onChangeText={(negative) => patchGenerator({ negative })}
          placeholder="lowres, bad hands"
          placeholderTextColor={colors.faint}
          multiline
          style={styles.negative}
        />
        <View style={styles.row}>
          <Text style={styles.label}>{CREATE_PROMPT_FIELDS[6]}</Text>
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
        <Text style={styles.hint}>Always added at the end of the sent prompt. Editing them keeps your text when you switch models.</Text>
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
          Sent order: your prompt, LoRA triggers, positive tags, extra text, the style suffix, then quality tags.
        </Text>
        <View style={styles.row}>
          <Pressable onPress={() => patchGenerator({ qualityTags: !gen.qualityTags })}>
            <Text style={styles.link}>{gen.qualityTags ? 'Quality tags on' : 'Quality tags off'}</Text>
          </Pressable>
          <Pressable onPress={() => patchGenerator({ triggers: !gen.triggers })}>
            <Text style={styles.link}>{gen.triggers ? 'Triggers on' : 'Triggers off'}</Text>
          </Pressable>
        </View>
        <Text style={styles.label}>LoRAs</Text>
        <Pressable testID="gen-lora-add" onPress={() => setLoraSheet(true)}>
          <Text style={styles.link}>Add LoRA</Text>
        </Pressable>
        <LoraSheet visible={loraSheet} onClose={() => setLoraSheet(false)} />
        {gen.loras.map((lora, index) => {
          const page = loraPage(lora);
          const offer = illustriousOffer(checkpoint?.baseModel ?? '', lora.baseModel ?? '', gen.installed);
          const update = (patch: Partial<typeof lora>) =>
            patchGenerator({ loras: gen.loras.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) });
          return (
            <View key={`${lora.name}-${lora.versionId ?? index}`} style={styles.loraCard}>
              <View style={styles.row}>
                <Pressable onPress={() => openLink(page.url)} style={{ flex: 1 }}>
                  <Text style={styles.checkpointName}>{lora.name}</Text>
                </Pressable>
                <Pressable testID={`lora-kind-${index}`} onPress={() => update({ kind: lora.kind === 'character' ? 'style' : 'character' })}>
                  <Text style={styles.link}>{lora.kind === 'character' ? 'Character' : 'Style/Other'}</Text>
                </Pressable>
                <Pressable onPress={() => update({ enabled: lora.enabled === false })}>
                  <Text style={styles.link}>{lora.enabled === false ? 'Off' : 'On'}</Text>
                </Pressable>
                <Pressable testID={`lora-remove-${index}`} onPress={() => patchGenerator({ loras: gen.loras.filter((_, itemIndex) => itemIndex !== index) })}>
                  <Text style={styles.link}>Remove</Text>
                </Pressable>
              </View>
              <View style={styles.row}>
                {[0.4, 0.6, 0.8, 1, 1.2].map((weight) => (
                  <Pressable key={weight} onPress={() => update({ weight })} style={[styles.chipButton, lora.weight === weight && styles.chipOn]}>
                    <Text style={styles.chipText}>{weight}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                testID={`lora-prompt-${index}`}
                value={lora.prompt || ''}
                onChangeText={(prompt) => update({ prompt })}
                placeholder="This LoRA's prompt"
                placeholderTextColor={colors.faint}
                multiline
                style={styles.prompt}
              />
              <Pressable testID={`lora-triggers-${index}`} onPress={() => update({ prompt: mergeTriggerWords(lora.prompt || '', lora.triggers) })}>
                <Text style={styles.link}>Re-insert triggers</Text>
              </Pressable>
              {loraPromptNote(lora.triggers) ? <Text style={styles.hint}>{loraPromptNote(lora.triggers)}</Text> : null}
              {offer ? (
                <Pressable testID="use-wai-illustrious" onPress={() => void useWaiIllustrious(offer)}>
                  <Text style={styles.link}>{offer === 'switch' ? 'Switch to Illustrious' : 'Install WAI-Illustrious'}</Text>
                </Pressable>
              ) : null}
              {loraBaseWarning(checkpoint?.baseModel ?? '', lora.baseModel ?? '') ? (
                <Text style={styles.hint}>{loraBaseWarning(checkpoint?.baseModel ?? '', lora.baseModel ?? '')}</Text>
              ) : null}
            </View>
          );
        })}
        {characterLoras(gen.loras).length >= 2 ? (
          <View style={styles.row}>
            <Pressable testID="layout-side" onPress={() => patchGenerator({ regionLayout: 'side' })}>
              <Text style={styles.link}>{gen.regionLayout === 'stack' ? 'Side by side' : 'Side by side · on'}</Text>
            </Pressable>
            <Pressable testID="layout-stack" onPress={() => patchGenerator({ regionLayout: 'stack' })}>
              <Text style={styles.link}>{gen.regionLayout === 'stack' ? 'Top and bottom · on' : 'Top and bottom'}</Text>
            </Pressable>
          </View>
        ) : null}
        {characterLoras(gen.loras).length >= 2 ? (
          <Text style={styles.hint}>Each character LoRA is painted in its own area, left to right or top to bottom, so the characters do not blend. Style LoRAs still cover the whole picture.</Text>
        ) : null}
        <View style={styles.row}>
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
        <Text style={styles.label}>Reference picture</Text>
        <Pressable
          testID="reference-pick"
          style={styles.chipButton}
          onPress={() => {
            void (async () => {
              try {
                const picked = await pickLocalImages(1);
                const photo = picked?.[0];
                if (!photo) return;
                setReferenceUri(await persistPng(`reference-${Date.now()}.jpg`, photo.bytes));
                setError(null);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'The photo gallery did not open.');
              }
            })();
          }}>
          <Text style={styles.chipText}>{referenceUri ? 'Change reference picture' : 'Choose reference picture'}</Text>
        </Pressable>
        {referenceUri ? <Image source={{ uri: referenceUri }} style={styles.reference} contentFit="cover" /> : null}
        <Pressable testID="reference-pose" onPress={() => patchGenerator({ referencePose: !gen.referencePose })}>
          <Text style={styles.link}>{gen.referencePose ? 'Copy pose on' : 'Copy pose off'}</Text>
        </Pressable>
        {gen.referencePose ? (
          <View style={styles.stack}>
            <Strength testID="pose-strength" value={gen.referencePoseStrength ?? 0.85} onChange={(referencePoseStrength) => patchGenerator({ referencePoseStrength })} />
            <Pressable testID="pose-fit" onPress={() => patchGenerator({ referenceFit: !gen.referenceFit })}>
              <Text style={styles.link}>{gen.referenceFit ? "Fit to my character's body" : 'Fit to my character off'}</Text>
            </Pressable>
            <View style={styles.row}>
              {(['petite', 'average', 'tall'] as BodySize[]).map((size) => (
                <Pressable key={size} testID={`pose-body-${size}`} onPress={() => patchGenerator({ referenceBody: size })} style={[styles.chipButton, gen.referenceBody === size && styles.chipOn]}>
                  <Text style={styles.chipText}>{size}</Text>
                </Pressable>
              ))}
            </View>
            {skeleton ? <Image testID="pose-preview" source={{ uri: skeleton }} style={styles.reference} contentFit="contain" /> : null}
            {poseNote ? <Text style={styles.hint}>{poseNote}</Text> : null}
          </View>
        ) : null}
        <Pressable testID="reference-copy" onPress={() => patchGenerator({ referenceCopy: !gen.referenceCopy })}>
          <Text style={styles.link}>{gen.referenceCopy ? 'Copy whole picture on' : 'Copy whole picture off'}</Text>
        </Pressable>
        {gen.referenceCopy ? <Strength testID="copy-denoise" value={gen.referenceDenoise ?? 0.6} onChange={(referenceDenoise) => patchGenerator({ referenceDenoise })} /> : null}
        <Pressable testID="reference-style" onPress={() => patchGenerator({ referenceStyle: !gen.referenceStyle })}>
          <Text style={styles.link}>{gen.referenceStyle ? 'Copy art style on' : 'Copy art style off'}</Text>
        </Pressable>
        {gen.referenceStyle ? <Strength testID="style-strength" value={gen.referenceStyleStrength ?? 0.55} onChange={(referenceStyleStrength) => patchGenerator({ referenceStyleStrength })} /> : null}
        <Text style={styles.hint}>Pose, the whole picture, and art style can be on together. Clothes, the character, and the LoRAs still apply. The skeleton is the pose after it is fitted.</Text>
        <TasteRow />
        {cloud.toast ? <Text testID="cloud-toast" style={styles.ok}>{cloud.toast}</Text> : null}
        {studio.settings.provider === 'salad' && cloudIsWaiting(cloud.gate) ? (
          <Pressable testID="generate-on-phone" style={styles.chipButton} onPress={() => void generate(true)}>
            <Text style={styles.chipText}>Generate on my phone now</Text>
          </Pressable>
        ) : null}
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

function TasteRow() {
  const gen = useGenerator();
  const taste = useTasteProfile();
  const suggested = suggestedSettings(taste);
  const note = [suggested.sampler, suggested.steps ? `${suggested.steps} steps` : '', suggested.cfg ? `CFG ${suggested.cfg}` : ''].filter(Boolean).join(' · ');
  return (
    <View style={styles.stack}>
      <Pressable testID="use-taste" onPress={() => patchGenerator({ useTaste: gen.useTaste === false })}>
        <Text style={styles.link}>{gen.useTaste === false ? 'Use my taste off' : 'Use my taste on'}</Text>
      </Pressable>
      <Pressable testID="open-taste" onPress={() => router.push('/taste')}>
        <Text style={styles.link}>My taste</Text>
      </Pressable>
      {note ? (
        <Pressable
          testID="apply-taste-settings"
          onPress={() =>
            patchGenerator({
              ...(suggested.sampler ? { sampler: suggested.sampler } : {}),
              ...(suggested.steps ? { steps: suggested.steps } : {}),
              ...(suggested.cfg ? { cfg: suggested.cfg } : {}),
            })
          }>
          <Text style={styles.hint}>Liked settings: {note}. Apply</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Strength({ value, onChange, testID }: { value: number; onChange: (next: number) => void; testID: string }) {
  const shown = Math.round(value * 100) / 100;
  return (
    <View style={styles.row}>
      <Pressable testID={`${testID}-down`} onPress={() => onChange(Math.max(0.05, Math.round((shown - 0.05) * 100) / 100))}>
        <Text style={styles.link}>−</Text>
      </Pressable>
      <Text testID={testID} style={styles.hint}>{shown.toFixed(2)}</Text>
      <Pressable testID={`${testID}-up`} onPress={() => onChange(Math.min(1, Math.round((shown + 0.05) * 100) / 100))}>
        <Text style={styles.link}>+</Text>
      </Pressable>
    </View>
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
  stack: { gap: 8 },
  reference: { width: '100%', height: 220, borderRadius: 12, backgroundColor: colors.ink },
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
  loraCard: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 12, gap: 8, backgroundColor: colors.card },
  go: { backgroundColor: colors.sakura, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  generate: { backgroundColor: colors.sakura, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minWidth: 148, alignItems: 'center' },
  generateText: { color: colors.text, fontFamily: font.black, fontSize: 14 },
  goText: { color: colors.ink, fontFamily: font.black, fontSize: 16 },
  ok: { color: colors.ok, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
});
