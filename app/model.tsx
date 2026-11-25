import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { civitaiModelUrl, getCivitaiModel, loraFileName, thumbnailUrl, versionFile, type CivitaiModel, type CivitaiVersion } from '@/src/lib/civitai';
import { openLink } from '@/src/lib/openLink';
import { addLora, applyCheckpoint, getGenerator, patchGenerator, rememberServerModels, setDefaultCheckpoint } from '@/src/lib/genstore';
import { recommendedFromMeta, toInstalled, type CatalogCheckpoint } from '@/src/lib/checkpoints';
import { runCheckpointUse } from '@/src/lib/checkpointUse';
import { changeContainerGroup, liveContainerGroup } from '@/src/lib/cloudActions';
import { deploymentForEndpoint } from '@/src/lib/cloudSteps';
import { readCloudReady } from '@/src/lib/cloudReady';
import { confirmAction } from '@/src/lib/confirm';
import { CLOUD_OFF_INSTALL, canUseAsDefault, installAction, isServerInstalled, needsCloudStart } from '@/src/lib/installGate';
import { startDownload } from '@/src/lib/downloadClient';
import { ensureSelectedLoras } from '@/src/lib/ensureLoras';
import { queueInstall } from '@/src/lib/queuestore';
import { sendClientReport } from '@/src/lib/clientReport';
import { rememberFault } from '@/src/lib/reportText';
import { readCivitaiToken, readCloudDeployment, readSaladKey } from '@/src/lib/storage';
import { normalizeEndpoint } from '@/src/lib/salad';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

export default function ModelScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const studio = useStudio();
  const [model, setModel] = useState<CivitaiModel | null>(null);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [serverIds, setServerIds] = useState<number[]>([]);
  const [cloudOff, setCloudOff] = useState(true);

  const refreshServer = useCallback(async () => {
    const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
    const key = await readSaladKey();
    if (!endpoint || !key) {
      setServerIds([]);
      setCloudOff(true);
      return;
    }
    const ready = await readCloudReady(endpoint, key);
    setServerIds(ready.versionIds);
    setCloudOff(ready.off);
    if (!ready.off && ready.versionIds.length) {
      const listed = await fetch(`${endpoint}/models`, {
        headers: { Authorization: `Bearer ${key}`, 'Salad-Api-Key': key, 'X-Api-Key': key },
      });
      if (listed.ok) {
        const body = (await listed.json()) as { models?: CatalogCheckpoint[] };
        rememberServerModels((body.models ?? []).filter((item) => item.type === 'Checkpoint').map(toInstalled));
      }
    }
  }, [studio.settings.saladEndpoint]);

  useFocusEffect(
    useCallback(() => {
      void refreshServer();
    }, [refreshServer]),
  );

  useEffect(() => {
    if (!id) return;
    void getCivitaiModel(id)
      .then((next) => {
        setModel(next);
        setVersionId(next.modelVersions?.[0]?.id ?? null);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load that model.'));
  }, [id]);

  const version = model?.modelVersions?.find((item) => item.id === versionId) ?? model?.modelVersions?.[0];
  const file = version ? versionFile(version) : undefined;
  const sample = (version?.images?.[0]?.meta ?? {}) as Record<string, unknown>;
  const serverInstalled = version ? isServerInstalled(serverIds, [], version.id) : false;
  const action = installAction({ cloudReady: !cloudOff, serverInstalled });

  async function install(item: CivitaiVersion) {
    if (!model || busy) return;
    setBusy(true);
    setError(null);
    try {
      const primary = versionFile(item);
      const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
      const [key, token] = await Promise.all([readSaladKey(), readCivitaiToken()]);
      if (!endpoint || !key) throw new Error('Salad needs an endpoint and API key before it can download a file.');
      const ready = await readCloudReady(endpoint, key);
      setCloudOff(ready.off);
      setServerIds(ready.versionIds);
      if (isServerInstalled(ready.versionIds, [], item.id)) {
        setStatus('This version is already on the server.');
        return;
      }
      if (ready.off) {
        const agreed = await confirmAction('Start cloud and install?', 'The cloud is off. Yume will start it, then download this file when the server is ready.', 'Start cloud');
        if (!agreed) return;
        if (needsCloudStart(ready.groupStatus)) {
          const deployment = deploymentForEndpoint(endpoint, await readCloudDeployment()) ?? liveContainerGroup();
          await changeContainerGroup({ apiKey: key, deployment, action: 'start' });
        }
        queueInstall(item.id, model.name);
        setStatus('Queued. The download starts when the cloud is ready. Progress is on Downloads.');
        router.push('/downloads');
        return;
      }
      setStatus('Download queued');
      setProgress(0);
      await startDownload(
        endpoint,
        key,
        item.id,
        { type: model.type, name: model.name, filename: primary?.name, baseModel: item.baseModel, triggers: item.trainedWords },
        token,
      );
      setStatus('Downloading on the server. Progress is on Downloads.');
      router.push('/downloads');
      if (model.type === 'Checkpoint') {
        const meta = item.images?.[0]?.meta as { sampler?: string; steps?: number; cfgScale?: number } | null;
        if (meta?.sampler || meta?.steps || meta?.cfgScale) {
          patchGenerator({
            ...(meta.sampler ? { sampler: String(meta.sampler) } : {}),
            ...(Number(meta.steps) ? { steps: Number(meta.steps) } : {}),
            ...(Number(meta.cfgScale) ? { cfg: Number(meta.cfgScale) } : {}),
          });
        }
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Install failed.';
      setError(message);
      const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
      rememberFault({ time: Date.now(), source: 'install', message, endpoint, payload: { versionId: item.id } });
      const key = await readSaladKey();
      if (endpoint && key) void sendClientReport(endpoint, key).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        {!model ? <Text style={styles.body}>{error ?? 'Loading the model…'}</Text> : null}
        {model && version ? (
          <>
            <Text style={styles.kicker}>{model.type}</Text>
            <Text style={styles.title}>{model.name}</Text>
            <Text style={styles.body}>
              {version.baseModel} · version {version.name} · id {version.id}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {(version.images ?? []).slice(0, 6).map((image) => (
                <Image key={image.url} source={{ uri: image.url }} style={styles.preview} contentFit="cover" />
              ))}
            </ScrollView>
            <View style={styles.row}>
              {model.modelVersions.map((item) => (
                <Pressable key={item.id} onPress={() => setVersionId(item.id)} style={[styles.chip, item.id === version.id && styles.chipOn]}>
                  <Text style={styles.chipText}>{item.name}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Trigger words</Text>
            <Text style={styles.body}>{version.trainedWords?.length ? version.trainedWords.join(', ') : 'This version does not publish trigger words.'}</Text>
            <Text style={styles.label}>Sample settings</Text>
            <Text style={styles.body}>
              {sample.sampler ? `Sampler ${String(sample.sampler)}, ` : 'No sampler on the first sample. '}
              {sample.steps ? `${String(sample.steps)} steps, ` : ''}
              {sample.cfgScale ? `CFG ${String(sample.cfgScale)}. ` : ''}
              {sample.negativePrompt ? `Negative: ${String(sample.negativePrompt)}` : ''}
            </Text>
            <Text style={styles.body}>
              File {file?.name ?? 'unknown'}
              {file?.hashes?.AutoV2 ? ` · hash ${file.hashes.AutoV2}` : ''}
            </Text>
            <Pressable onPress={() => openLink(civitaiModelUrl(model.id, version.id))}>
              <Text style={styles.link}>Open on Civitai</Text>
            </Pressable>
            {model.type === 'LORA' || model.type === 'LoCon' ? (
              <Pressable
                onPress={() =>
                  void (async () => {
                    const picked = {
                      name: loraFileName(version, model.name),
                      weight: 0.8,
                      modelId: model.id,
                      versionId: version.id,
                      triggers: version.trainedWords,
                      baseModel: version.baseModel,
                    };
                    addLora(picked);
                    if (studio.settings.provider !== 'salad') return;
                    const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
                    const key = await readSaladKey();
                    const token = await readCivitaiToken().catch(() => null);
                    if (!endpoint || !key) return;
                    setStatus('Downloading LoRA 0%');
                    await ensureSelectedLoras({
                      loras: [picked],
                      endpoint,
                      apiKey: key,
                      civitaiToken: token,
                      onProgress: setStatus,
                    });
                  })()
                }>
                <Text style={styles.link}>Use this LoRA</Text>
              </Pressable>
            ) : null}
            {busy ? (
              <View testID="install-progress" style={styles.track}>
                <View style={[styles.bar, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
            ) : null}
            <Pressable testID="model-install" style={styles.go} disabled={busy || action === 'installed'} onPress={() => void install(version)}>
              <Text style={styles.goText}>{action === 'installed' ? 'Installed' : action === 'start-and-install' ? CLOUD_OFF_INSTALL : busy ? 'Installing…' : 'Install'}</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/downloads')}>
              <Text style={styles.link}>Downloads</Text>
            </Pressable>
            {model.type === 'Checkpoint' && serverInstalled ? (
              <Pressable
                testID="use-now"
                onPress={() => {
                  void (async () => {
                    if (!version || busy) return;
                    const resource = {
                      versionId: version.id,
                      modelId: model.id,
                      name: model.name,
                      version: version.name,
                      type: model.type,
                      baseModel: version.baseModel,
                      filename: file?.name ?? `civitai-${version.id}.safetensors`,
                      hash: (file?.hashes?.AutoV2 ?? '').toLowerCase(),
                      sha256: file?.hashes?.SHA256 ?? '',
                      triggers: version.trainedWords ?? [],
                      isDefault: true,
                    };
                    setBusy(true);
                    setError(null);
                    try {
                      if (studio.settings.provider === 'salad') {
                        const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
                        const key = await readSaladKey();
                        if (!endpoint || !key) throw new Error('Connect a Salad gateway before loading this checkpoint.');
                        setStatus('Loading checkpoint');
                        await runCheckpointUse({
                          endpoint,
                          apiKey: key,
                          versionId: version.id,
                          onProgress: (label, fraction) => {
                            setStatus(label);
                            setProgress(fraction == null ? 0 : fraction / 100);
                          },
                        });
                      }
                      applyCheckpoint(toInstalled(resource), recommendedFromMeta(sample));
                      setStatus('This checkpoint is loaded.');
                    } catch (caught) {
                      setError(caught instanceof Error ? caught.message : 'The checkpoint could not be loaded.');
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}>
                <Text style={styles.link}>Use now</Text>
              </Pressable>
            ) : null}
            {model.type === 'Checkpoint' && canUseAsDefault(serverInstalled) ? (
              <Pressable
                onPress={() => {
                  void (async () => {
                    const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
                    const key = await readSaladKey();
                    if (!endpoint || !key || !canUseAsDefault(serverInstalled)) {
                      setError('Use as default is only available after the server has this checkpoint.');
                      return;
                    }
                    const response = await fetch(`${endpoint}/models/default`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${key}`,
                        'Salad-Api-Key': key,
                        'X-Api-Key': key,
                      },
                      body: JSON.stringify({ versionId: version.id }),
                    });
                    if (!response.ok) {
                      setError('The server does not have this checkpoint yet.');
                      return;
                    }
                    setDefaultCheckpoint(version.id);
                    setStatus('This checkpoint is now the default.');
                  })();
                }}>
                <Text style={styles.link}>Use as default</Text>
              </Pressable>
            ) : null}
            {version.trainedWords?.length ? (
              <Pressable
                onPress={() => {
                  const current = getGenerator().prompt;
                  patchGenerator({ prompt: [version.trainedWords.join(', '), current].filter(Boolean).join(', ') });
                  router.navigate('/');
                }}>
                <Text style={styles.link}>Insert trigger words</Text>
              </Pressable>
            ) : null}
            {status ? <Text style={styles.ok}>{status}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 10, paddingBottom: 32 },
  kicker: { color: colors.sakura, fontFamily: font.black, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 26 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  label: { color: colors.sakura, fontFamily: font.black, fontSize: 12, textTransform: 'uppercase' },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 15 },
  row: { flexDirection: 'row', gap: 8 },
  preview: { width: 140, height: 180, borderRadius: 12, backgroundColor: colors.ink },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 6 },
  chipOn: { borderColor: colors.sakura },
  chipText: { color: colors.text, fontFamily: font.bold, fontSize: 13 },
  track: { height: 8, borderRadius: 999, backgroundColor: colors.ink, overflow: 'hidden' },
  bar: { height: 8, backgroundColor: colors.sakura },
  go: { backgroundColor: colors.sakura, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  goText: { color: colors.ink, fontFamily: font.black, fontSize: 16 },
  ok: { color: colors.ok, fontFamily: font.semibold, fontSize: 14 },
  error: { color: colors.danger, fontFamily: font.semibold, fontSize: 14 },
});
