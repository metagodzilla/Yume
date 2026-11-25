import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deployYumeGroup, ensureYumeProject, listGpuClasses, readContainerGroup, validateSaladKey } from '@/src/lib/cloudActions';
import { probe } from '@/src/lib/connection';
import { addJob, finishJob, reportJob } from '@/src/lib/queuestore';
import {
  SALAD_PORTAL_API_KEYS,
  YUME_ORGANIZATION,
  YUME_PROJECT,
  normalizeSaladKey,
  choicesFromGpuClasses,
  costLine,
  describeDeploy,
  gatewayFromGroup,
  groupStatusOf,
  pickDefaultGpu,
  serverUrlFromLink,
  type GpuChoice,
  type NamedResource,
} from '@/src/lib/saladCloud';
import { mintAdminToken } from '@/src/lib/serverUpdate';
import { touchCloudActivity, writeAdminToken, writeCloudDeployment } from '@/src/lib/storage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

type Step = 'welcome' | 'mode' | 'key' | 'org' | 'gpu' | 'progress';

const SAMPLE_ORGS: NamedResource[] = [{ name: 'studio', displayName: 'Studio' }];
const SAMPLE_GPUS: GpuChoice[] = [
  { id: 'sample-4090', name: 'RTX 4090 (24 GB)', priority: 'low', hourly: 0.16 },
  { id: 'sample-3090', name: 'RTX 3090 (24 GB)', priority: 'low', hourly: 0.127 },
  { id: 'sample-4070', name: 'RTX 4070 Ti (12 GB)', priority: 'low', hourly: 0.08 },
];

function isStep(value: string): value is Step {
  return value === 'welcome' || value === 'mode' || value === 'key' || value === 'org' || value === 'gpu' || value === 'progress';
}

export default function SetupScreen() {
  const studio = useStudio();
  const params = useLocalSearchParams<{ url?: string; shot?: string }>();
  const shot = typeof params.shot === 'string' && isStep(params.shot) ? params.shot : '';
  const [step, setStep] = useState<Step>(shot || 'welcome');
  const [apiKey, setApiKey] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [orgs, setOrgs] = useState<NamedResource[]>(shot === 'org' || shot === 'gpu' || shot === 'progress' ? SAMPLE_ORGS : []);
  const [organization, setOrganization] = useState(shot ? SAMPLE_ORGS[0].name : '');
  const [gpus, setGpus] = useState<GpuChoice[]>(shot === 'gpu' || shot === 'progress' ? SAMPLE_GPUS : []);
  const [gpu, setGpu] = useState<GpuChoice | null>(shot === 'gpu' || shot === 'progress' ? pickDefaultGpu(SAMPLE_GPUS) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState(shot === 'progress' ? 'Pulling the image' : 'Starting');
  const [progress, setProgress] = useState(shot === 'progress' ? 0.45 : 0.1);

  useEffect(() => {
    if (shot) return;
    const raw = typeof params.url === 'string' ? params.url : '';
    const parsed = raw ? serverUrlFromLink(raw) : null;
    if (parsed) router.replace({ pathname: '/connect', params: { url: parsed } });
  }, [params.url, shot]);

  async function finishLocal(sourceMode: 'phone' | 'auto') {
    await studio.updateSettings({ provider: 'demo', sourceMode, setupComplete: true });
    router.replace('/');
  }

  async function continueKey() {
    if (shot) {
      setStep('org');
      return;
    }
    const key = normalizeSaladKey(apiKey);
    setApiKey(key);
    if (!key) {
      setError('Paste the Salad API key first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await studio.saveSaladKey(key);
      await validateSaladKey(key);
      setOrganization(YUME_ORGANIZATION);
      setOrgs([{ name: YUME_ORGANIZATION, displayName: YUME_ORGANIZATION }]);
      setStep('org');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Salad did not accept that key.');
    } finally {
      setBusy(false);
    }
  }

  async function chooseOrg(next: NamedResource) {
    if (shot) {
      setOrganization(next.name);
      setGpus(SAMPLE_GPUS);
      setGpu(pickDefaultGpu(SAMPLE_GPUS));
      setStep('gpu');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const key = normalizeSaladKey(apiKey);
      if (next.name !== YUME_ORGANIZATION) await ensureYumeProject(key, next.name);
      const choices = choicesFromGpuClasses(await listGpuClasses(key, next.name));
      if (choices.length === 0) {
        setError('Salad did not return any GPU classes for that organization.');
        return;
      }
      setOrganization(next.name);
      setGpus(choices);
      setGpu(pickDefaultGpu(choices));
      setStep('gpu');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not prepare the yume project.');
    } finally {
      setBusy(false);
    }
  }

  async function deploy() {
    if (!gpu) return;
    if (shot) {
      setStep('progress');
      setPhase('Pulling the image');
      return;
    }
    const key = normalizeSaladKey(apiKey);
    setBusy(true);
    setError(null);
    setStep('progress');
    setPhase('Starting');
    setProgress(0.1);
    const job = addJob('deploy', 'Salad server');
    reportJob(job.id, 0.1, 'Starting');
    try {
      const token = adminToken.trim() || mintAdminToken();
      await writeAdminToken(token);
      const deployment = await deployYumeGroup({ apiKey: key, organization, gpu, adminToken: token });
      await writeCloudDeployment(deployment);
      let gateway = '';
      for (let attempt = 0; attempt < 160; attempt += 1) {
        const group = await readContainerGroup(key, deployment);
        const status = groupStatusOf(group);
        gateway = gatewayFromGroup(group) || gateway;
        let ready = false;
        if (gateway && (status.running > 0 || status.status === 'running')) {
          ready = (await probe(`${gateway}/ready`, {}, 8000)).ok;
        }
        const described = describeDeploy({ groupStatus: status.status, allocating: status.allocating, downloading: status.downloading, creating: status.creating, running: status.running, ready });
        setPhase(described.title);
        setProgress(described.progress);
        reportJob(job.id, described.progress, described.title);
        if (described.phase === 'failed') throw new Error('Salad reported that the server failed. Check the portal, then try Deploy again.');
        if (described.phase === 'ready' && gateway) break;
        await wait(8000);
      }
      if (!gateway) throw new Error('The server started, but Salad has not published a gateway URL yet.');
      await studio.saveSaladEndpoint(gateway);
      await studio.updateSettings({
        provider: 'salad',
        sourceMode: 'cloud',
        setupComplete: true,
        hourlyRate: gpu.hourly,
        saladEndpoint: gateway,
      });
      await touchCloudActivity();
      finishJob(job.id);
      router.replace({ pathname: '/cloud-check', params: { auto: '1' } });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Deploy did not finish.';
      setError(message);
      reportJob(job.id, progress, message, 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {shot ? <Text style={styles.body}>Preview of this step. A real Salad key loads your organizations and live GPU prices.</Text> : null}
        {step === 'welcome' ? (
          <View testID="setup-welcome" style={styles.step}>
            <Text style={styles.kicker}>Yume</Text>
            <Text style={styles.title}>Welcome</Text>
            <Text style={styles.body}>Set up a cloud GPU, stay on this phone, or try the demo. You can change this later in Settings.</Text>
            <Pressable testID="setup-next" style={styles.big} onPress={() => setStep('mode')}>
              <Text style={styles.bigText}>Continue</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'mode' ? (
          <View testID="setup-mode" style={styles.step}>
            <Text style={styles.title}>How should Yume draw?</Text>
            <Pressable testID="setup-cloud" style={styles.big} onPress={() => setStep('key')}>
              <Text style={styles.bigText}>Use cloud (Salad)</Text>
            </Pressable>
            <Pressable testID="setup-phone" style={styles.secondary} onPress={() => void finishLocal('phone')}>
              <Text style={styles.secondaryText}>Phone only</Text>
            </Pressable>
            <Pressable testID="setup-demo" style={styles.secondary} onPress={() => void finishLocal('auto')}>
              <Text style={styles.secondaryText}>Demo</Text>
            </Pressable>
            <Text style={styles.body}>Cloud rents a GPU by the hour. Phone only and Demo do not start a server.</Text>
          </View>
        ) : null}

        {step === 'key' ? (
          <View testID="setup-key" style={styles.step}>
            <Text style={styles.title}>Salad API key</Text>
            <Text style={styles.body}>Paste the key from the Salad portal. It is stored in Secure Store on this phone and sent only to Salad.</Text>
            <TextInput
              testID="setup-key-input"
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="Salad API key"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
            />
            <Text style={styles.body}>
              Server update token. Leave this blank and Yume makes one for a new container. If the Salad group already exists, add that token as YUME_ADMIN_TOKEN in the Salad portal. This wizard does not change a running group.
            </Text>
            <TextInput
              testID="setup-admin-token"
              value={adminToken}
              onChangeText={setAdminToken}
              placeholder="Optional server update token"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
            />
            <Pressable onPress={() => void Linking.openURL(SALAD_PORTAL_API_KEYS)}>
              <Text style={styles.link}>Open portal.salad.com API keys</Text>
            </Pressable>
            <Pressable testID="setup-key-continue" style={styles.big} disabled={busy} onPress={() => void continueKey()}>
              <Text style={styles.bigText}>{busy ? 'Checking…' : 'Continue'}</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'org' ? (
          <View testID="setup-org" style={styles.step}>
            <Text style={styles.title}>Choose an organization</Text>
            <Text style={styles.body}>Yume creates a project named {YUME_PROJECT} if it is not there yet.</Text>
            {orgs.map((item) => (
              <Pressable key={item.name} testID={`setup-org-${item.name}`} style={styles.big} disabled={busy} onPress={() => void chooseOrg(item)}>
                <Text style={styles.bigText}>{item.displayName}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {step === 'gpu' ? (
          <View testID="setup-gpu" style={styles.step}>
            <Text style={styles.title}>Choose a GPU</Text>
            <Text style={styles.body}>Prices come from Salad for this organization. RTX 4090 at low priority is the default when it is listed.</Text>
            {gpus.map((choice) => {
              const on = gpu?.id === choice.id;
              return (
                <Pressable key={choice.id} testID={`setup-gpu-${choice.id}`} style={[styles.choice, on && styles.choiceOn]} onPress={() => setGpu(choice)}>
                  <Text style={styles.choiceTitle}>{choice.name}</Text>
                  <Text style={styles.body}>
                    {choice.priority} · ${choice.hourly.toFixed(3)} per hour
                  </Text>
                </Pressable>
              );
            })}
            {gpu ? <Text testID="setup-cost" style={styles.cost}>{costLine(gpu.hourly, gpu.name)}</Text> : null}
            <Pressable testID="setup-deploy" style={styles.big} disabled={!gpu || busy} onPress={() => void deploy()}>
              <Text style={styles.bigText}>Deploy</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'progress' ? (
          <View testID="setup-progress" style={styles.step}>
            <Text style={styles.kicker}>Salad</Text>
            <Text style={styles.title}>{phase}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <Text style={styles.body}>
              Pulling the image and downloading the model can take several minutes. You are billed while an instance is running. When it is ready, Yume saves the gateway URL and key, then runs Check cloud.
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {step !== 'welcome' && step !== 'progress' ? (
          <Pressable onPress={() => setStep(step === 'mode' ? 'welcome' : step === 'key' ? 'mode' : step === 'org' ? 'key' : 'org')}>
            <Text style={styles.link}>Back</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, gap: 16, paddingBottom: 40 },
  step: { gap: 14 },
  kicker: { color: colors.sakura, fontFamily: font.black, fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.logo, fontSize: 32, lineHeight: 40 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 16, lineHeight: 23 },
  cost: { color: colors.gold, fontFamily: font.bold, fontSize: 16, lineHeight: 23 },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: font.semibold,
    fontSize: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  big: { backgroundColor: colors.sakura, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 16, alignItems: 'center' },
  bigText: { color: '#fff', fontFamily: font.black, fontSize: 18, textAlign: 'center' },
  secondary: { borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingVertical: 18, alignItems: 'center' },
  secondaryText: { color: colors.text, fontFamily: font.black, fontSize: 18 },
  choice: { borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, padding: 16, gap: 4 },
  choiceOn: { borderColor: colors.sakura },
  choiceTitle: { color: colors.text, fontFamily: font.black, fontSize: 18 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 16 },
  error: { color: colors.danger, fontFamily: font.bold, fontSize: 15, lineHeight: 21 },
  track: { height: 14, borderRadius: 7, backgroundColor: colors.cardAlt, overflow: 'hidden' },
  fill: { height: 14, backgroundColor: colors.sakura },
});
