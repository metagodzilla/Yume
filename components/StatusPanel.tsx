import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { changeContainerGroup, containerGroupUrl, readContainerGroup, readContainerInstances } from '@/src/lib/cloudActions';
import { capReached, checkLine, cloudChecklist, deploymentForEndpoint, formatCostLine, hostOf, LIVE_GATEWAY, resolveHourly, sessionUsd, type CheckLine, type ChecklistStep } from '@/src/lib/cloudSteps';
import { confirmAction } from '@/src/lib/confirm';
import { probe, type Probe } from '@/src/lib/connection';
import { readPhone, type PhoneReading } from '@/src/lib/device';
import { thermalStatusName } from '@/src/lib/phonePower';
import { counts } from '@/src/lib/queue';
import { queueAction, useQueue } from '@/src/lib/queuestore';
import { endpointDiffersFromLive, LIVE_GATEWAY_URL, normalizeEndpoint, redactSecrets } from '@/src/lib/salad';
import { groupStatusOf, instanceCounts, normalizeSaladKey } from '@/src/lib/saladCloud';
import { readCloudDeployment, readSaladKey, touchCloudActivity, writeCloudDeployment } from '@/src/lib/storage';
import { getThrottle } from '@/src/lib/thermalState';
import { emptyStats, money, type CloudStats } from '@/src/lib/usage';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

const CHECK_HELP = 'CHECK calls /health, /ready, and /stats on the gateway. The saved Salad key is sent, because this gateway rejects unsigned requests with 403.';

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
  const queue = useQueue();
  const [stats, setStats] = useState<CloudStats>(emptyStats());
  const [phone, setPhone] = useState<PhoneReading | null>(null);
  const [steps, setSteps] = useState<ChecklistStep[]>([]);
  const [phase, setPhase] = useState<'starting' | 'running' | 'stopped'>('stopped');
  const [pill, setPill] = useState('Stopped');
  const [liveTitle, setLiveTitle] = useState('Cloud is stopped');
  const [checkNote, setCheckNote] = useState(CHECK_HELP);
  const [checks, setChecks] = useState<CheckLine[]>([]);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [upSec, setUpSec] = useState(0);
  const [quote, setQuote] = useState({ priority: '', gpu: '', live: false });
  const [now, setNow] = useState(Date.now());
  const stepSince = useRef(Date.now());
  const stepLabel = useRef('');
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
      const groupUrl = deployment ? containerGroupUrl(deployment) : '';
      if (key && deployment) {
        try {
          const group = await readContainerGroup(key, deployment);
          const status = groupStatusOf(group);
          groupStatus = status.status;
          allocating = status.allocating;
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
          if (running === 0 && groupStatus !== 'stopped' && groupStatus !== 'succeeded') {
            try {
              const extra = instanceCounts(await readContainerInstances(key, deployment));
              allocating = Math.max(allocating, extra.allocating);
              creating = Math.max(creating, extra.creating);
              running = Math.max(running, extra.running);
            } catch {
              // The group GET already has the counts when Salad returns them.
            }
          }
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
      const probeError = [groupError, health?.error, ready?.error].filter(Boolean).join(' ');
      const view = cloudChecklist({
        hasEndpoint: Boolean(saved),
        groupStatus,
        allocating,
        creating,
        running,
        healthStatus: health?.status,
        readyStatus: ready?.status,
        healthReady: health?.body?.ready,
        readyDetail: textOf(ready) || textOf(health),
        probeError: probeError || undefined,
      });
      setPhase(view.phase);
      setPill(view.pill);
      setLiveTitle(view.liveTitle);
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
      if (view.phase === 'stopped') setUpSec(0);
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
  }, [studio.settings.saladEndpoint]);

  function onCheck() {
    setChecking(true);
    setCheckNote('Checking...');
    void refresh(true).finally(() => setChecking(false));
  }

  useFocusEffect(
    useCallback(() => {
      if (preview === 'model') return undefined;
      void refresh();
      const timer = setInterval(() => void refresh(), 10_000);
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
    if (preview === 'model' || !capReached(spent, cap) || capped.current) return;
    capped.current = true;
    void (async () => {
      const endpoint = studio.settings.saladEndpoint.trim();
      const deployment = deploymentForEndpoint(endpoint, await readCloudDeployment());
      const key = await readSaladKey();
      if (!deployment || !key) {
        setNote(`Session cap ${money(cap)} was reached. Save the Salad key to stop yume-server automatically.`);
        return;
      }
      try {
        await changeContainerGroup({ apiKey: key, deployment, action: 'stop' });
        setNote(`Stopped the cloud at the ${money(cap)} session cap.`);
      } catch (caught) {
        setNote(caught instanceof Error ? caught.message : 'The session cap was reached, and the stop call failed.');
      }
    })();
  }, [cap, preview, spent, studio.settings.saladEndpoint]);

  async function startCloud() {
    const endpoint = studio.settings.saladEndpoint.trim();
    const deployment = deploymentForEndpoint(endpoint, await readCloudDeployment());
    const key = await readSaladKey();
    if (!deployment || !key) {
      setNote('Save the Salad API key in Connect. This server is yume-server in project default.');
      router.push('/connect');
      return;
    }
    const ok = await confirmAction('Start cloud?', `Starting bills about ${money(rate)} per hour once the instance is running.`, 'Start');
    if (!ok) return;
    try {
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
            <Text style={styles.sub}>Cloud · {phase}</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{pill}</Text>
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
          <Pressable testID="start-server" style={styles.white} onPress={() => void startCloud()}>
            <Text style={styles.whiteText}>Start cloud</Text>
          </Pressable>
          <Pressable
            testID="check-cloud"
            accessibilityRole="button"
            style={styles.white}
            onPressIn={() => {
              setChecking(true);
              setCheckNote('Checking...');
            }}
            onPress={onCheck}
          >
            {checking ? <ActivityIndicator testID="check-spinner" color="#161616" /> : null}
            <Text style={styles.whiteText}>{checking ? 'Checking...' : 'CHECK'}</Text>
          </Pressable>
        </View>
        <Text testID="check-help" style={styles.help}>{redactSecrets(checkNote)}</Text>
        {checks.map((row) => (
          <Text key={row.name} testID={`check-row-${row.name.replace(/\s+/g, '-')}`} style={styles.help}>
            {row.pass ? 'PASS' : 'FAIL'} {row.name}
            {row.status ? ` HTTP ${row.status}` : ''} — {redactSecrets(row.message)}
            {row.url ? ` ${redactSecrets(row.url)}` : ''}
          </Text>
        ))}
        {studio.cloudNotice ? (
          <Text testID="cloud-notice" style={styles.notice}>{studio.cloudNotice}</Text>
        ) : null}
        {wrongServer ? (
          <Pressable testID="use-live-server" onPress={() => void studio.saveSaladEndpoint(LIVE_GATEWAY_URL)}>
            <Text style={styles.link}>Use live server</Text>
          </Pressable>
        ) : null}
        <Text testID="cost-line" style={styles.cost}>{formatCostLine({ sessionUsd: spent, hourly: rate, upMin: upSec / 60, cap })}</Text>
        <View testID="live-card" style={styles.live}>
          <Text style={styles.kicker}>LIVE</Text>
          <Text style={styles.liveTitle}>{liveTitle}</Text>
          <Text style={styles.help}>Elapsed {clock(phase === 'stopped' ? 0 : cloudStart.current ? now - cloudStart.current : now - stepSince.current)}</Text>
          {steps.map((step) => (
            <View key={step.label} style={styles.step}>
              <Text style={[styles.stepMark, step.state === 'done' && styles.done, step.state === 'current' && styles.current]}>
                {step.state === 'done' ? '✓' : step.state === 'current' ? '●' : '○'}
              </Text>
              <Text style={[styles.stepLabel, step.state === 'current' && styles.current]}>{step.label}</Text>
              {step.state === 'current' ? <Text style={styles.stepTime}>{clock(now - stepSince.current)}</Text> : null}
            </View>
          ))}
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
          Cloud {stats.gpu && stats.gpu !== 'Unknown' ? stats.gpu : 'n/a'} · {phase} · Up {Math.round(upSec / 60)} min · {money(rate)}/h · {money(spent)} session · GPU power {gpuPower} · util{' '}
          {stats.utilPercent ?? 'n/a'}% · VRAM {stats.vramUsedMb ?? 'n/a'}/{stats.vramTotalMb ?? 'n/a'} MB
        </Text>
        <Text style={styles.help}>GPU power stays n/a until a rebuilt server image reports powerWatts from nvidia-smi. Phone watts are an estimate from current and voltage.</Text>
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
        </View>
        <View style={styles.row}>
          <Pressable onPress={() => router.push('/connect')}>
            <Text style={styles.link}>Connect</Text>
          </Pressable>
          <Pressable testID="stop-server" onPress={() => void stopCloud('stop')}>
            <Text style={styles.link}>Stop</Text>
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
    const deployment = deploymentForEndpoint(endpoint, await readCloudDeployment());
    const key = await readSaladKey();
    if (!deployment || !key) {
      setNote('Cloud setup has no Salad key yet.');
      return;
    }
    const warning =
      action === 'stop'
        ? `A running server costs about ${money(rate)} per hour until it stops.`
        : `Delete removes yume-server. A running GPU is billed until it stops.`;
    const ok = await confirmAction(action === 'stop' ? 'Stop the server?' : 'Delete the server?', warning, action === 'stop' ? 'Stop' : 'Delete');
    if (!ok) return;
    try {
      await changeContainerGroup({ apiKey: key, deployment, action });
      if (action === 'delete') {
        await writeCloudDeployment(null);
        await studio.saveSaladEndpoint('');
      }
      setNote(action === 'stop' ? 'Stop requested.' : 'Server deleted.');
      void refresh();
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : 'Salad did not accept that.');
    }
  }
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
  whiteText: { color: '#161616', fontFamily: font.black, fontSize: 16 },
  help: { color: colors.muted, fontFamily: font.semibold, fontSize: 13, lineHeight: 18 },
  cost: { color: colors.text, fontFamily: font.bold, fontSize: 14, lineHeight: 20 },
  live: { backgroundColor: colors.ink, borderRadius: 16, padding: 12, gap: 6 },
  kicker: { color: colors.sakura, fontFamily: font.black, fontSize: 11, letterSpacing: 1 },
  liveTitle: { color: colors.text, fontFamily: font.black, fontSize: 16, lineHeight: 22 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
