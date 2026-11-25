import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { clientReportBody, fetchServerErrors, sendClientReport } from '@/src/lib/clientReport';
import { rememberFault, reportDocument, type ServerFault } from '@/src/lib/reportText';
import { changeContainerGroup, containerGroupUrl, liveContainerGroup, readContainerGroup, readContainerInstances, reallocateInstance } from '@/src/lib/cloudActions';
import { beginCloudStart, beginCloudStop, cloudRunState, finishCloudStop, noteLiveSession, subscribeCloudRun } from '@/src/lib/cloudRun';
import { capReached, checkLine, cloudChecklist, deploymentForEndpoint, formatCostLine, hostOf, LIVE_GATEWAY, resolveHourly, sessionUsd, type CheckLine, type ChecklistStep } from '@/src/lib/cloudSteps';
import { DISK_RESET_NOTE, restoreSummary } from '@/src/lib/keptModels';
import { fetchInstalls } from '@/src/lib/downloadClient';
import { restoreMissingModels } from '@/src/lib/restoreModels';
import { confirmAction } from '@/src/lib/confirm';
import { probe, type Probe } from '@/src/lib/connection';
import { readPhone, type PhoneReading } from '@/src/lib/device';
import { thermalStatusName } from '@/src/lib/phonePower';
import { counts } from '@/src/lib/queue';
import { queueAction, useQueue } from '@/src/lib/queuestore';
import { endpointDiffersFromLive, LIVE_GATEWAY_URL, normalizeEndpoint, redactSecrets } from '@/src/lib/salad';
import { groupStatusOf, instanceCounts, normalizeSaladKey, pickActiveInstance, pullPercent, readSaladInstances, reallocateTarget } from '@/src/lib/saladCloud';
import { setCloudGate, useCloudGate } from '@/src/lib/cloudGate';
import { requestPhoneGenerate } from '@/src/lib/cloudRedo';
import { cloudIsWaiting } from '@/src/lib/phoneFallback';
import { emptyCloudWatch, noteCloudMove, observeCloud, type CloudWatchView } from '@/src/lib/stuckCloud';
import { fileLine, filesForPhase, formatReadyIn, overallEtaSeconds, parseProgressFiles, phaseDetail, softwareDetail, type WeightFile } from '@/src/lib/startupEta';
import { areaCounts, type CheckRow } from '@/src/lib/checkRows';
import { runAppCheck, runCloudCheck } from '@/src/lib/selfTest';
import { loadFeatures, readAdminToken, readCivitaiToken, readCloudDeployment, readSaladKey, saveFeatures, touchCloudActivity, writeCloudDeployment } from '@/src/lib/storage';
import { getThrottle } from '@/src/lib/thermalState';
import { formatBytes, formatEta, formatSpeed } from '@/src/lib/downloads';
import { emptyStats, money, type CloudStats } from '@/src/lib/usage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

const CHECK_HELP = 'CHECK tests the cloud. Test app checks this phone without calling the GPU.';

const saladHeaders = (key: string) => ({
  Authorization: `Bearer ${key}`,
  'X-Api-Key': key,
  'Salad-Api-Key': key,
});

function textOf(probeResult?: Probe): string {
  const detail = probeResult?.body?.detail;
  return typeof detail === 'string' ? detail : '';
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function StatusPanel({ preview = '' }: { preview?: string }) {
  const studio = useStudio();
  const cloud = useCloudGate();
  const queue = useQueue();
  const [stats, setStats] = useState<CloudStats>(emptyStats());
  const [phone, setPhone] = useState<PhoneReading | null>(null);
  const [steps, setSteps] = useState<ChecklistStep[]>([]);
  const [restoreLines, setRestoreLines] = useState<string[]>([]);
  const [phase, setPhase] = useState<'starting' | 'running' | 'stopping' | 'stopped'>('stopped');
  const run = useSyncExternalStore(subscribeCloudRun, cloudRunState, cloudRunState);
  const [pill, setPill] = useState('Stopped');
  const [liveTitle, setLiveTitle] = useState('Cloud is stopped');
  const [checkNote, setCheckNote] = useState(CHECK_HELP);
  const [checks, setChecks] = useState<CheckLine[]>([]);
  const [cloudRows, setCloudRows] = useState<CheckRow[]>([]);
  const [appRows, setAppRows] = useState<CheckRow[]>([]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [overall, setOverall] = useState<number | null>(null);
  const [serverErrors, setServerErrors] = useState<ServerFault[]>([]);
  const [openError, setOpenError] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [appTesting, setAppTesting] = useState(false);
  const [appNote, setAppNote] = useState('Test app stays on this phone, then uploads the report only if the server answers.');
  const [note, setNote] = useState<string | null>(null);
  const [upSec, setUpSec] = useState(0);
  const [quote, setQuote] = useState({ priority: '', gpu: '', live: false });
  const [now, setNow] = useState(Date.now());
  const stepSince = useRef(Date.now());
  const stepLabel = useRef('');
  const watchRef = useRef(emptyCloudWatch());
  const movingCloud = useRef(false);
  const cloudHandle = useRef<{ key: string; deployment: ReturnType<typeof deploymentForEndpoint>; instanceId: string }>({ key: '', deployment: null, instanceId: '' });
  const [files, setFiles] = useState<WeightFile[]>([]);
  const [modelStats, setModelStats] = useState({ done: 0, total: 0, speed: 0, eta: null as number | null });
  const [watchView, setWatchView] = useState<CloudWatchView | null>(null);
  const [pullSamples, setPullSamples] = useState<{ at: number; percent: number }[]>([]);
  const cloudStart = useRef<number | null>(null);
  const capped = useRef(false);
  const tally = counts(queue);
  const job = queue.jobs.find((item) => item.status === 'running' || item.status === 'paused' || item.status === 'waiting');
  const throttle = getThrottle();
  const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
  const rate = resolveHourly({
    userRate: Number(studio.settings.hourlyRate) || 0,
    touched: studio.settings.hourlyRateTouched,
    gpuName: quote.gpu || (stats.gpu && stats.gpu !== 'Unknown' ? stats.gpu : ''),
    priority: quote.priority,
    liveGateway: quote.live || hostOf(endpoint) === LIVE_GATEWAY.host,
  });
  const cap = Number(studio.settings.spendCap) || 0;
  const spent = sessionUsd(upSec, rate);
  const shownPhase = run.mode === 'stopping' ? 'stopping' : phase;
  const frozen = run.mode !== 'live';
  const shownSpent = frozen && run.frozenUsd != null ? run.frozenUsd : spent;
  const shownUpSec = frozen && run.frozenUpSec != null ? run.frozenUpSec : shownPhase === 'stopped' ? 0 : upSec;
  const software = softwareDetail(pullSamples, pullSamples[pullSamples.length - 1]?.percent ?? null);
  const modelLine = modelStats.total > 0 ? [formatBytes(modelStats.done) + (modelStats.total ? ` / ${formatBytes(modelStats.total)}` : ''), formatSpeed(modelStats.speed), formatEta(modelStats.eta)].filter(Boolean).join(' · ') : '';
  const currentIndex = steps.findIndex((step) => step.state === 'current');
  const restoreEta = files.filter((file) => !/checkpoint/i.test(file.type)).reduce((sum, file) => sum + (file.etaSeconds || 0), 0);
  const currentEta = currentIndex === 2 ? software.etaSeconds : currentIndex === 4 ? modelStats.eta : currentIndex === 5 ? restoreEta : null;
  const overallLabel = shownPhase === 'starting' ? formatReadyIn(overallEtaSeconds(currentIndex, currentEta, currentIndex === 5 ? 0 : restoreEta)) : '';
  const startEnabled = shownPhase === 'stopped' || pill === 'Failed';
  const stopEnabled = shownPhase === 'running' || shownPhase === 'starting';
  const wrongServer = endpointDiffersFromLive(studio.settings.saladEndpoint);

  const refresh = useCallback(async (report = false) => {
    const saved = normalizeEndpoint(studio.settings.saladEndpoint);
    try {
      const stored = (await readSaladKey()) ?? '';
      const webKey = Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage.getItem('yume.webSaladKey') || '' : '';
      const key = normalizeSaladKey(stored || webKey);
      const headers = key ? saladHeaders(key) : undefined;
      const deployment = deploymentForEndpoint(saved, await readCloudDeployment());
      let groupStatus = '';
      let allocating = 0;
      let creating = 0;
      let running = 0;
      let saladUp = 0;
      let priority = '';
      let groupGpu = deployment?.gpuName || '';
      let groupError = '';
      let downloading = 0;
      let groupPull: number | null = null;
      let activeState = '';
      let updateTime: string | null = null;
      const groupUrl = deployment ? containerGroupUrl(deployment) : '';
      if (key && deployment) {
        try {
          const group = await readContainerGroup(key, deployment);
          const status = groupStatusOf(group);
          groupStatus = status.status;
          allocating = status.allocating;
          downloading = status.downloading;
          creating = status.creating;
          running = status.running;
          priority = status.priority;
          if (status.startTime) {
            const parsed = Date.parse(status.startTime);
            if (Number.isFinite(parsed) && parsed > Date.parse('2020-01-01')) {
              cloudStart.current = parsed;
              saladUp = Math.max(0, (Date.now() - parsed) / 1000);
            }
          }
          let pull = pullPercent(group);
          if (groupStatus !== 'stopped' && groupStatus !== 'succeeded') {
            try {
              const listed = await readContainerInstances(key, deployment);
              const extra = instanceCounts(listed);
              allocating = Math.max(allocating, extra.allocating);
              downloading = Math.max(downloading, extra.downloading);
              creating = Math.max(creating, extra.creating);
              running = Math.max(running, extra.running);
              pull = pullPercent(listed) ?? pull;
              const active = pickActiveInstance(readSaladInstances(listed));
              activeState = active?.state || '';
              updateTime = active?.updateTime || null;
              cloudHandle.current = { key, deployment, instanceId: reallocateTarget(active) };
            } catch {
              cloudHandle.current = { key, deployment, instanceId: '' };
            }
          }
          groupPull = pull;
        } catch (error) {
          groupError = error instanceof Error ? error.message : 'Salad container-group GET failed.';
        }
      } else if (!key) {
        groupError = 'No Salad API key is saved.';
      } else {
        groupError = 'No organization, project, or group is saved for this URL.';
      }
      const healthUrl = saved ? `${saved}/health` : '';
      const readyUrl = saved ? `${saved}/ready` : '';
      const statsUrl = saved ? `${saved}/stats` : '';
      const health = saved ? await probe(healthUrl, { headers }, 8000) : undefined;
      const ready = saved ? await probe(readyUrl, { headers }, 8000) : undefined;
      const startup = saved ? await probe(`${saved}/startup`, { headers }, 8000) : undefined;
      const startupBody = startup?.body as { bytesDone?: number; bytesTotal?: number; bytesPerSecond?: number; etaSeconds?: number | null; message?: string } | undefined;
      const probeError = [groupError, health?.error, ready?.error].filter(Boolean).join(' ');
      let restoreTotal = 0;
      let restorePercent: number | null = null;
      if (saved && key && health?.ok) {
        const token = await readCivitaiToken().catch(() => null);
        const restored = await restoreMissingModels({ endpoint: saved, apiKey: key, civitaiToken: token }).catch(() => null);
        const jobs = await fetchInstalls(saved, key).catch(() => []);
        const lines = (restored?.restoring ?? []).map((model) => {
          const job = jobs.find((item) => item.versionId === model.versionId);
          const percent = job?.bytesTotal ? Math.round((job.bytesDone / job.bytesTotal) * 100) : job?.state === 'done' ? 100 : 0;
          return { versionId: model.versionId, name: model.name, percent, state: job?.state || 'queued' };
        });
        const summary = restoreSummary(lines);
        restoreTotal = summary.total;
        restorePercent = summary.percent;
        setRestoreLines(lines.map((item) => `${item.name} ${item.percent ?? 0}%`));
      } else {
        setRestoreLines([]);
      }
      const view = cloudChecklist({
        hasEndpoint: Boolean(saved),
        groupStatus,
        allocating,
        downloading,
        creating,
        running,
        healthStatus: health?.status,
        readyStatus: ready?.status,
        healthReady: health?.body?.ready,
        readyDetail: textOf(ready) || textOf(health),
        startupMessage: typeof startupBody?.message === 'string' ? startupBody.message : '',
        probeError: probeError || undefined,
        pullPercent: groupPull,
        modelDone: typeof startupBody?.bytesDone === 'number' ? startupBody.bytesDone : null,
        modelTotal: typeof startupBody?.bytesTotal === 'number' ? startupBody.bytesTotal : null,
        restoreTotal,
        restorePercent,
      });
      setOverall(view.overall);
      setPhase(view.phase);
      setPill(view.pill);
      setLiveTitle(view.liveTitle);
      const progress = saved ? await probe(`${saved}/progress`, { headers }, 8000) : undefined;
      const listedFiles = parseProgressFiles(progress?.body);
      setFiles(listedFiles);
      const seen = listedFiles.map((item) => item.feature || '').filter(Boolean);
      if (seen.length) {
        const prior = await loadFeatures();
        const next = [...new Set([...prior, ...seen])];
        if (next.length !== prior.length) await saveFeatures(next);
      }
      setModelStats({
        done: typeof startupBody?.bytesDone === 'number' ? startupBody.bytesDone : 0,
        total: typeof startupBody?.bytesTotal === 'number' ? startupBody.bytesTotal : 0,
        speed: typeof startupBody?.bytesPerSecond === 'number' ? startupBody.bytesPerSecond : 0,
        eta: typeof startupBody?.etaSeconds === 'number' ? startupBody.etaSeconds : null,
      });
      const observed = observeCloud(
        watchRef.current,
        {
          now: Date.now(),
          instanceState: activeState || (downloading > 0 ? 'downloading' : creating > 0 ? 'creating' : running > 0 ? 'running' : allocating > 0 ? 'allocating' : ''),
          pullingPercent: groupPull,
          updateTime,
          readyStatus: ready?.status ?? null,
          healthStatus: health?.status ?? null,
          modelDone: typeof startupBody?.bytesDone === 'number' ? startupBody.bytesDone : null,
          startupMessage: typeof startupBody?.message === 'string' ? startupBody.message : '',
          active: view.phase === 'starting',
        },
        studio.settings.autoFixStuckCloud !== false,
      );
      watchRef.current = observed.watch;
      setWatchView(observed);
      setPullSamples(observed.watch.samples);
      if (observed.autoMove) void moveMachine(true, observed.banner);
      const readyNow = view.phase === 'running' && ready?.status === 200;
      setCloudGate(readyNow ? 'ready' : observed.kind === 'stuck' ? 'stuck' : observed.kind === 'slow' ? 'slow' : view.phase === 'stopped' ? 'stopped' : view.phase === 'starting' ? 'starting' : 'unknown');
      setSteps(view.steps);
      if (view.liveTitle !== stepLabel.current) {
        stepLabel.current = view.liveTitle;
        stepSince.current = Date.now();
      }
      let nextStats = emptyStats();
      let statsProbe: Awaited<ReturnType<typeof probe>> | undefined;
      if (saved) {
        statsProbe = await probe(statsUrl, { headers }, 8000);
        if (statsProbe.ok && statsProbe.body) nextStats = { ...emptyStats(), ...(statsProbe.body as CloudStats) };
      }
      setStats(nextStats);
      setQuote({ priority, gpu: groupGpu, live: hostOf(saved) === LIVE_GATEWAY.host });
      const measured = typeof nextStats.uptimeSec === 'number' && nextStats.uptimeSec > 0 ? nextStats.uptimeSec : saladUp;
      if (view.phase === 'stopped') {
        if (cloudRunState().mode === 'stopping') {
          finishCloudStop();
          setNote(`Stopped. Final session cost ${money(cloudRunState().frozenUsd ?? 0)}.`);
        }
        setUpSec(0);
      }
      else if (measured > 0) setUpSec(measured);
      setPhone(await readPhone());
      if (report) {
        setChecks([
          checkLine('health', healthUrl, health ? { ok: health.ok, status: health.status, error: health.error, detail: textOf(health) } : undefined),
          checkLine('ready', readyUrl, ready ? { ok: ready.ok, status: ready.status, error: ready.error, detail: textOf(ready) } : undefined),
          checkLine('stats', statsUrl, statsProbe ? { ok: statsProbe.ok, status: statsProbe.status, error: statsProbe.error, detail: textOf(statsProbe) } : undefined),
          checkLine('container group', groupUrl, groupError ? { ok: false, error: groupError } : { ok: true, status: 200, detail: groupStatus || 'OK' }),
        ]);
        setCheckNote(view.authBlocked && !key ? 'The gateway returned 403 without a key. Save the Salad API key, then CHECK again.' : 'Check finished.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCheckNote(message);
      setLiveTitle(message);
      if (report) setChecks([{ name: 'check', url: saved, pass: false, message }]);
    }
  }, [studio.settings.autoFixStuckCloud, studio.settings.saladEndpoint]);

  async function moveMachine(auto: boolean, reason: string) {
    if (movingCloud.current) return;
    const handle = cloudHandle.current;
    if (!handle.key || !handle.deployment || !handle.instanceId) return;
    movingCloud.current = true;
    watchRef.current = noteCloudMove(watchRef.current, Date.now(), auto);
    try {
      await reallocateInstance(handle.key, handle.deployment, handle.instanceId);
      rememberFault({ time: Date.now(), source: 'cloud', message: `${auto ? 'Auto-move' : 'Move to a new machine'}: instance ${handle.instanceId} was ${reason || 'stuck'}.` });
      setNote(auto ? 'Moving this cloud to a new machine.' : 'Asked Salad to move this cloud to a new machine.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Salad did not move the machine.';
      rememberFault({ time: Date.now(), source: 'cloud', message: `Move failed for instance ${handle.instanceId}. ${message}` });
      setNote(message);
    } finally {
      movingCloud.current = false;
    }
  }

  function onCheck() {
    setChecking(true);
    setCheckNote('Checking the cloud...');
    setCloudRows([]);
    setOpenRow(null);
    void (async () => {
      const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
      const key = normalizeSaladKey((await readSaladKey()) || '');
      try {
        const rows = await runCloudCheck({ endpoint, apiKey: key });
        setCloudRows(rows);
        setCheckNote('Cloud check finished.');
        await refresh(false);
        if (endpoint && key) await sendClientReport(endpoint, key).catch(() => undefined);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'The cloud check failed.';
        setCheckNote(message);
        setCloudRows([{ area: 'Cloud', name: 'CHECK', status: 'fail', message, ms: 0 }]);
      } finally {
        setChecking(false);
      }
    })();
  }

  function onAppTest() {
    setAppTesting(true);
    setAppNote('Testing this phone...');
    setAppRows([]);
    setOpenRow(null);
    void (async () => {
      const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
      const key = normalizeSaladKey((await readSaladKey()) || '');
      try {
        const rows = await runAppCheck({ endpoint: studio.settings.saladEndpoint });
        setAppRows(rows);
        setAppNote('App test finished.');
        if (endpoint && key) {
          const health = await probe(`${endpoint}/health`, { headers: saladHeaders(key) }, 8000);
          if (health.ok) await sendClientReport(endpoint, key).catch(() => undefined);
          else setAppNote('App test finished. The report stayed on the phone because the server did not answer.');
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'The app test failed.';
        setAppNote(message);
        setAppRows([{ area: 'App', name: 'Test', status: 'fail', message, ms: 0 }]);
      } finally {
        setAppTesting(false);
      }
    })();
  }

  useFocusEffect(
    useCallback(() => {
      if (preview === 'model') return undefined;
      void refresh();
      const timer = setInterval(() => void refresh(), 5_000);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, [preview, refresh, studio.loading, throttle.refreshMs]),
  );

  useEffect(() => {
    if (preview !== 'model') return;
    const view = cloudChecklist({
      hasEndpoint: true,
      groupStatus: 'running',
      running: 1,
      healthStatus: 200,
      readyStatus: 503,
      healthReady: false,
      readyDetail: 'Model is still downloading.',
    });
    setPhase(view.phase);
    setPill(view.pill);
    setLiveTitle(view.liveTitle);
    setSteps(view.steps);
    setUpSec(0);
    stepSince.current = Date.now();
    setCheckNote('Layout preview for persimmon-potato while the model downloads. This browser has no Salad key, so it cannot read that gateway.');
  }, [preview]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), studio.loading || throttle.heat !== 'cool' ? throttle.refreshMs : 1000);
    return () => clearInterval(timer);
  }, [studio.loading, throttle.heat, throttle.refreshMs]);

  useEffect(() => {
    if (run.mode === 'live') noteLiveSession(spent, upSec);
  }, [run.mode, spent, upSec]);

  useEffect(() => {
    if (preview === 'model' || !capReached(spent, cap) || capped.current || run.mode !== 'live') return;
    capped.current = true;
    void (async () => {
      const endpoint = studio.settings.saladEndpoint.trim();
      const deployment = deploymentForEndpoint(endpoint, await readCloudDeployment()) ?? liveContainerGroup();
      const key = await readSaladKey();
      if (!key) {
        capped.current = false;
        setNote(`Session cap ${money(cap)} was reached. Save the Salad key to stop yume-server automatically.`);
        return;
      }
      beginCloudStop(spent, upSec);
      try {
        await changeContainerGroup({ apiKey: key, deployment, action: 'stop' });
        setNote(`Stopping at the ${money(cap)} session cap. Final session cost ${money(spent)}.`);
        void refresh();
      } catch (caught) {
        beginCloudStart();
        capped.current = false;
        setNote(caught instanceof Error ? caught.message : 'The session cap was reached, and the stop call failed.');
      }
    })();
  }, [cap, preview, refresh, run.mode, spent, studio.settings.saladEndpoint, upSec]);

  async function startCloud() {
    const endpoint = studio.settings.saladEndpoint.trim();
    const deployment = deploymentForEndpoint(endpoint, await readCloudDeployment()) ?? liveContainerGroup();
    const key = await readSaladKey();
    if (!key) {
      setNote('Save the Salad API key in Connect. This server is yume-server in project default.');
      router.push('/connect');
      return;
    }
    const ok = await confirmAction('Start cloud?', `Starting bills about ${money(rate)} per hour once the instance is running.`, 'Start');
    if (!ok) return;
    try {
      beginCloudStart();
      capped.current = false;
      await changeContainerGroup({ apiKey: key, deployment, action: 'start' });
      await writeCloudDeployment({ ...deployment, hourlyUsd: rate });
      await touchCloudActivity();
      setNote('Start requested.');
      void refresh();
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : 'Salad did not start the server.');
    }
  }

  const current = steps.find((step) => step.state === 'current');
  const gpuPower = stats.powerWatts == null ? 'n/a' : `${stats.powerWatts} W`;
  const temp = phone?.tempC == null ? 'n/a' : `${phone.tempC.toFixed(1)}°C`;
  const battery = phone?.batteryPercent == null ? 'n/a' : `${Math.round(phone.batteryPercent)}%`;
  const draw = phone?.powerWatts == null ? 'n/a' : `${phone.powerWatts.toFixed(1)} W estimate`;

  return (
    <View style={styles.wrap}>
      <View testID="connection-card" style={styles.card}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>Yume</Text>
            <Text style={styles.sub}>Cloud · {shownPhase}</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{shownPhase === 'stopping' ? 'Stopping' : pill}</Text>
          </View>
        </View>
        {job ? (
          <View testID="job-banner" style={styles.banner}>
            <Text style={styles.bannerTitle}>{job.title}</Text>
            <View style={styles.row}>
              <Pressable testID="job-resume" onPress={() => queueAction('resume', job.id)}>
                <Text style={styles.bannerAction}>Resume</Text>
              </Pressable>
              <Pressable testID="job-cancel" onPress={() => queueAction('cancel', job.id)}>
                <Text style={styles.bannerAction}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <View style={[styles.row, styles.actions]}>
          <Pressable testID="start-server" disabled={!startEnabled} style={[styles.white, !startEnabled && styles.disabled]} onPress={() => void startCloud()}>
            <Text style={styles.whiteText}>Start cloud</Text>
          </Pressable>
          <Pressable testID="stop-server" disabled={!stopEnabled} style={[styles.white, !stopEnabled && styles.disabled]} onPress={() => void stopCloud('stop')}>
            <Text style={styles.whiteText}>{shownPhase === 'stopping' ? 'Stopping...' : 'Stop cloud'}</Text>
          </Pressable>
          <Pressable
            testID="check-cloud"
            accessibilityRole="button"
            style={styles.white}
            onPressIn={() => {
              if (checking) return;
              setChecking(true);
              setCheckNote('Checking the cloud...');
              setCloudRows([]);
            }}
            onPress={onCheck}
          >
            {checking ? <ActivityIndicator testID="check-spinner" color="#161616" /> : null}
            <Text style={styles.whiteText}>{checking ? 'Checking...' : 'CHECK'}</Text>
          </Pressable>
          <Pressable testID="test-app" accessibilityRole="button" style={styles.white} onPress={onAppTest}>
            {appTesting ? <ActivityIndicator color="#161616" /> : null}
            <Text style={styles.whiteText}>{appTesting ? 'Testing...' : 'Test app'}</Text>
          </Pressable>
        </View>
        <Text testID="check-help" style={styles.help}>{redactSecrets(checkNote)}</Text>
        <ResultList rows={cloudRows} openRow={openRow} setOpenRow={setOpenRow} onOpenImage={(uri, settings) => studio.openViewer({ images: [uri], index: 0, prompt: settings || 'yume check', title: 'CHECK test', filename: 'check-test.png' })} />
        <Text testID="app-help" style={styles.help}>{appNote}</Text>
        <ResultList rows={appRows} openRow={openRow} setOpenRow={setOpenRow} onOpenImage={() => undefined} />
        {studio.cloudNotice ? (
          <Text testID="cloud-notice" style={styles.notice}>{studio.cloudNotice}</Text>
        ) : null}
        {serverErrors.slice(0, 3).map((item, index) => (
          <View key={`${item.time ?? index}-${item.endpoint ?? ''}`}>
            <Text style={styles.help}>
              {item.endpoint || 'server'} {item.status ? `HTTP ${item.status}` : ''} — {item.message || 'Error'}
            </Text>
            <Pressable onPress={() => setOpenError(openError === index ? null : index)}>
              <Text style={styles.link}>Show details</Text>
            </Pressable>
            {openError === index ? <Text selectable style={styles.help}>{item.traceback || item.message}</Text> : null}
          </View>
        ))}
        <Pressable
          testID="copy-report"
          onPress={() => {
            void (async () => {
              const [salad, admin, civitai] = await Promise.all([readSaladKey(), readAdminToken(), readCivitaiToken()]);
              const secrets = [salad, admin, civitai].filter((item): item is string => Boolean(item && item.trim().length >= 8));
              const rows = [...cloudRows, ...appRows].map((item) => ({
                message: `${item.status.toUpperCase()} ${item.area} ${item.name}: ${item.message}`,
                endpoint: item.detail,
                status: item.http,
              }));
              await Clipboard.setStringAsync(reportDocument(rows, clientReportBody(), secrets));
            })();
          }}>
          <Text style={styles.link}>Copy report</Text>
        </Pressable>
        {wrongServer ? (
          <Pressable testID="use-live-server" onPress={() => void studio.saveSaladEndpoint(LIVE_GATEWAY_URL)}>
            <Text style={styles.link}>Use live server</Text>
          </Pressable>
        ) : null}
        <Text testID="cost-line" style={styles.cost}>{formatCostLine({ sessionUsd: shownSpent, hourly: rate, upMin: shownUpSec / 60, cap, final: frozen })}</Text>
        <View testID="live-card" style={styles.live}>
          <Text style={styles.kicker}>LIVE</Text>
          <Text style={styles.liveTitle}>{liveTitle}</Text>
          {cloud.toast ? <Text testID="cloud-toast" style={styles.detail}>{cloud.toast}</Text> : null}
          {studio.settings.provider === 'salad' && cloudIsWaiting(cloud.gate) ? (
            <Pressable
              testID="generate-on-phone-card"
              onPress={() => {
                requestPhoneGenerate();
                router.push('/(tabs)/create');
              }}>
              <Text style={styles.link}>Generate on my phone now</Text>
            </Pressable>
          ) : null}
          <Text style={styles.help}>{DISK_RESET_NOTE}</Text>
          {steps.map((step, index) => {
            const current = step.state === 'current';
            const detail = current ? phaseDetail(index, { elapsedMs: now - stepSince.current, pullLine: software.line, modelLine, note: watchView?.banner || '' }) : '';
            const phaseFiles = step.state === 'todo' ? [] : filesForPhase(index, files);
            return (
              <View key={step.label} style={styles.step}>
                <Text style={[styles.stepMark, step.state === 'done' && styles.done, step.state === 'current' && styles.current]}>
                  {step.state === 'done' ? '✓' : step.state === 'current' ? '●' : '○'}
                </Text>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.stepLabel, step.state === 'current' && styles.current]}>{step.label}</Text>
                  <ProgressBar percent={step.state === 'todo' ? null : step.percent} idle={step.state === 'todo'} />
                  {detail ? <Text style={[styles.detail, watchView?.kind === 'stuck' && styles.stuck]}>{detail}</Text> : null}
                  {phaseFiles.map((file) => {
                    const percent = file.bytesTotal > 0 ? Math.round((file.bytesDone / file.bytesTotal) * 100) : file.state === 'done' ? 100 : null;
                    return (
                      <View key={`${file.type}-${file.versionId ?? file.name}`} style={styles.file}>
                        <Text style={styles.detail}>{file.state === 'done' ? '✓ ' : ''}{file.name} · {file.type}</Text>
                        <ProgressBar percent={file.state === 'waiting' ? null : percent} idle={file.state === 'waiting'} />
                        <Text style={styles.detail}>{fileLine(file)}</Text>
                      </View>
                    );
                  })}
                  {current && (watchView?.kind === 'stuck' || watchView?.kind === 'slow') ? (
                    <Pressable testID="move-machine" onPress={() => void moveMachine(false, watchView.banner)}>
                      <Text style={styles.link}>Move to new machine</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
          {overallLabel ? <Text testID="overall-eta" style={styles.detail}>{overallLabel}</Text> : null}
        </View>
        <View style={styles.row}>
          <Text testID="phone-temp" style={styles.chip}>Phone temp {temp}</Text>
          {throttle.notice ? <Text style={styles.notice}>{throttle.notice}</Text> : null}
        </View>
        <Text style={styles.help}>
          Phone {battery}
          {phone?.charging == null ? '' : phone.charging ? ' · charging' : ' · on battery'} · {draw} · thermal {thermalStatusName(phone?.thermalStatus ?? null)} · CPU{' '}
          {phone?.appCpuPercent == null ? 'n/a' : `${phone.appCpuPercent.toFixed(0)}% estimate`} · RAM {phone?.appRssMb == null ? 'n/a' : `${phone.appRssMb} MB`}
        </Text>
        <Text style={styles.help}>
          Cloud {stats.gpu && stats.gpu !== 'Unknown' ? stats.gpu : 'n/a'} · {shownPhase} · Up {Math.round(shownUpSec / 60)} min · {money(rate)}/h · {money(shownSpent)} session · GPU power {gpuPower} · util{' '}
          {stats.utilPercent ?? 'n/a'}% · VRAM {stats.vramUsedMb ?? 'n/a'}/{stats.vramTotalMb ?? 'n/a'} MB
        </Text>
        <Text style={styles.help}>
          {stats.powerWatts == null ? 'GPU power stays n/a until a rebuilt server image reports powerWatts from nvidia-smi. ' : ''}
          Phone watts are an estimate from current and voltage.
        </Text>
        <View style={styles.fields}>
          <Text style={styles.fieldLabel}>Hourly rate (USD)</Text>
          <TextInput
            testID="hourly-rate-panel"
            value={studio.settings.hourlyRateTouched ? String(studio.settings.hourlyRate) : String(rate)}
            onChangeText={(value) => void studio.updateSettings({ hourlyRate: Number(value) || 0, hourlyRateTouched: true })}
            keyboardType="decimal-pad"
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>Session cap (USD, 0 = off)</Text>
          <TextInput
            testID="session-cap"
            value={String(studio.settings.spendCap)}
            onChangeText={(value) => void studio.updateSettings({ spendCap: Number(value) || 0 })}
            keyboardType="decimal-pad"
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>Idle auto-stop</Text>
          <View style={styles.row}>
            {[
              { minutes: 0, label: 'Off' },
              { minutes: 15, label: '15 min' },
              { minutes: 30, label: '30 min' },
              { minutes: 60, label: '60 min' },
            ].map((choice) => (
              <Pressable key={choice.minutes} onPress={() => void studio.updateSettings({ idleStopMinutes: choice.minutes })}>
                <Text style={[styles.chip, studio.settings.idleStopMinutes === choice.minutes && styles.current]}>{choice.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.row}>
          <Pressable onPress={() => router.push('/connect')}>
            <Text style={styles.link}>Connect</Text>
          </Pressable>
          <Pressable testID="delete-server" onPress={() => void stopCloud('delete')}>
            <Text style={styles.link}>Delete</Text>
          </Pressable>
          <Text style={styles.help}>Queue {tally.running + tally.waiting + tally.paused}</Text>
        </View>
        {note ? <Text style={styles.notice}>{note}</Text> : null}
        {current ? <Text style={styles.help}>Current step: {current.label}</Text> : null}
      </View>
    </View>
  );

  async function stopCloud(action: 'stop' | 'delete') {
    const endpoint = studio.settings.saladEndpoint.trim();
    const deployment = deploymentForEndpoint(endpoint, await readCloudDeployment()) ?? liveContainerGroup();
    const key = await readSaladKey();
    if (!key) {
      setNote('Cloud setup has no Salad key yet.');
      return;
    }
    const warning =
      action === 'stop'
        ? `Stop yume-server now? The session cost stays at ${money(shownSpent)} and the timer stops.`
        : `Delete removes yume-server. A running GPU is billed until it stops.`;
    const ok = await confirmAction(action === 'stop' ? 'Stop cloud?' : 'Delete the server?', warning, action === 'stop' ? 'Stop' : 'Delete');
    if (!ok) return;
    if (action === 'stop') beginCloudStop(shownSpent, shownUpSec);
    try {
      await changeContainerGroup({ apiKey: key, deployment, action });
      if (action === 'delete') {
        await writeCloudDeployment(null);
        await studio.saveSaladEndpoint('');
      }
      setNote(action === 'stop' ? 'Stopping. The cost timer is stopped.' : 'Server deleted.');
      void refresh();
    } catch (caught) {
      if (action === 'stop') beginCloudStart();
      setNote(caught instanceof Error ? caught.message : 'Salad did not accept that.');
    }
  }
}

function ProgressBar({ percent, idle = false }: { percent: number | null; idle?: boolean }) {
  if (idle) return <View style={styles.track} />;
  if (percent == null) {
    return (
      <View style={styles.track}>
        <View style={styles.indeterminate} />
      </View>
    );
  }
  return (
    <View style={styles.track}>
      <View style={[styles.bar, { width: `${percent}%` }]} />
    </View>
  );
}

function ResultList({
  rows,
  openRow,
  setOpenRow,
  onOpenImage,
}: {
  rows: CheckRow[];
  openRow: string | null;
  setOpenRow: (id: string | null) => void;
  onOpenImage: (uri: string, settings?: string) => void;
}) {
  return (
    <>
      {areaCounts(rows).map((count) => (
        <Text key={count.area} style={styles.help}>
          {count.area}: {count.pass} pass, {count.fail} fail, {count.skip} skip
        </Text>
      ))}
      {rows.map((item) => {
        const id = `${item.area}-${item.name}`;
        return (
          <View key={id}>
            <Text testID={`check-row-${item.name.replace(/\s+/g, '-')}`} style={styles.help}>
              {item.status.toUpperCase()} {item.name}
              {item.http ? ` HTTP ${item.http}` : ''} — {redactSecrets(item.message)} · {item.ms} ms
            </Text>
            {item.settings ? <Text style={styles.help}>{item.settings}</Text> : null}
            {item.imageUri ? (
              <Pressable onPress={() => onOpenImage(item.imageUri || '', item.settings)}>
                <Image source={{ uri: item.imageUri }} style={styles.thumb} contentFit="cover" />
              </Pressable>
            ) : null}
            <Pressable onPress={() => setOpenRow(openRow === id ? null : id)}>
              <Text style={styles.link}>Show details</Text>
            </Pressable>
            {openRow === id ? <Text selectable style={styles.help}>{redactSecrets(item.detail || item.message)}</Text> : null}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 14, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: colors.text, fontFamily: font.logo, fontSize: 28 },
  sub: { color: colors.muted, fontFamily: font.semibold, fontSize: 14 },
  pill: { backgroundColor: colors.cardAlt, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { color: colors.text, fontFamily: font.black, fontSize: 13 },
  banner: { backgroundColor: '#2a2418', borderRadius: 12, padding: 10, gap: 6 },
  bannerTitle: { color: colors.text, fontFamily: font.black, fontSize: 15 },
  bannerAction: { color: colors.gold, fontFamily: font.black, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  actions: { zIndex: 50, elevation: 50 },
  white: { flex: 1, backgroundColor: '#f4f4f4', borderRadius: 16, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  disabled: { opacity: 0.35 },
  whiteText: { color: '#161616', fontFamily: font.black, fontSize: 16 },
  help: { color: colors.muted, fontFamily: font.semibold, fontSize: 13, lineHeight: 18 },
  cost: { color: colors.text, fontFamily: font.bold, fontSize: 14, lineHeight: 20 },
  live: { backgroundColor: colors.ink, borderRadius: 16, padding: 12, gap: 6 },
  kicker: { color: colors.sakura, fontFamily: font.black, fontSize: 11, letterSpacing: 1 },
  liveTitle: { color: colors.text, fontFamily: font.black, fontSize: 16, lineHeight: 22 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  detail: { color: colors.faint, fontFamily: font.semibold, fontSize: 12, lineHeight: 16 },
  stuck: { color: colors.danger },
  file: { gap: 3, marginTop: 4 },
  track: { height: 6, borderRadius: 999, backgroundColor: colors.ink, overflow: 'hidden' },
  bar: { height: 6, backgroundColor: colors.sakura },
  indeterminate: { height: 6, width: '35%', backgroundColor: colors.gold },
  thumb: { width: 96, height: 96, borderRadius: 8, backgroundColor: colors.ink },
  stepMark: { width: 18, color: colors.faint, fontFamily: font.black },
  stepLabel: { flex: 1, color: colors.muted, fontFamily: font.semibold, fontSize: 14 },
  stepTime: { color: colors.gold, fontFamily: font.black, fontSize: 12 },
  done: { color: colors.ok },
  current: { color: colors.text },
  chip: { color: colors.text, fontFamily: font.black, fontSize: 12, backgroundColor: colors.cardAlt, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, overflow: 'hidden' },
  notice: { color: colors.gold, fontFamily: font.bold, fontSize: 13, lineHeight: 18, flex: 1 },
  fields: { gap: 6 },
  fieldLabel: { color: colors.faint, fontFamily: font.black, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  input: { borderRadius: 12, borderWidth: 1, borderColor: colors.line, color: colors.text, fontFamily: font.semibold, paddingHorizontal: 10, paddingVertical: 8 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 13 },
});
