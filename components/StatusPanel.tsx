import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { changeContainerGroup } from '@/src/lib/cloudActions';
import { confirmAction } from '@/src/lib/confirm';
import { interpretConnection, probe, type ConnectionState } from '@/src/lib/connection';
import { readCloudDeployment, readSaladKey, touchCloudActivity, writeCloudDeployment } from '@/src/lib/storage';
import { counts } from '@/src/lib/queue';
import { useQueue } from '@/src/lib/queuestore';
import { capWarning, emptyStats, money, sessionCost, type CloudStats } from '@/src/lib/usage';
import { parseManifest, updateAvailable } from '@/src/lib/updates';
import { APP_VERSION_CODE } from '@/src/lib/version';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

function downloadUpdate(url: string | null, setProgress: (value: number) => void) {
  if (!url || typeof XMLHttpRequest === 'undefined') return;
  const request = new XMLHttpRequest();
  request.open('GET', url);
  request.responseType = 'blob';
  request.onprogress = (event) => {
    if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
  };
  request.onload = () => setProgress(100);
  request.send();
}

const saladHeaders = (key: string) => ({
  Authorization: `Bearer ${key}`,
  'X-Api-Key': key,
  'Salad-Api-Key': key,
});

export function StatusPanel() {
  const studio = useStudio();
  const queue = useQueue();
  const [open, setOpen] = useState(false);
  const [conn, setConn] = useState<ConnectionState>({ kind: 'demo', title: 'Demo mode', detail: 'Checking…' });
  const [mesh, setMesh] = useState<ConnectionState | null>(null);
  const [stats, setStats] = useState<CloudStats>(emptyStats());
  const [connectedMs, setConnectedMs] = useState(0);
  const [updateLabel, setUpdateLabel] = useState<string | null>(null);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const tally = counts(queue);

  const refresh = useCallback(async () => {
    const endpoint = studio.settings.saladEndpoint.trim().replace(/\/+$/, '');
    const stored = (await readSaladKey()) ?? '';
    const webKey = Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage.getItem('yume.webSaladKey') || '' : '';
    const key = stored || webKey;
    const health = endpoint ? await probe(`${endpoint}/health`, {}, 8000) : undefined;
    const ready = endpoint ? await probe(`${endpoint}/ready`, {}, 8000) : undefined;
    const auth = endpoint && key ? await probe(`${endpoint}/models`, { headers: saladHeaders(key) }, 8000) : undefined;
    const next = interpretConnection({
      provider: studio.settings.provider,
      endpoint,
      hasKey: Boolean(key),
      health,
      ready,
      auth,
    });
    setConn(next);
    if (next.kind === 'connected') setConnectedMs((value) => value + 5000);
    if (studio.settings.meshEndpoint.trim()) {
      const meshEndpoint = studio.settings.meshEndpoint.trim().replace(/\/+$/, '');
      const meshHealth = await probe(`${meshEndpoint}/health`, {}, 8000);
      const meshReady = await probe(`${meshEndpoint}/ready`, {}, 8000);
      setMesh(
        interpretConnection({
          provider: 'salad',
          endpoint: meshEndpoint,
          hasKey: Boolean(key),
          health: meshHealth,
          ready: meshReady,
          auth: key ? await probe(`${meshEndpoint}/health`, { headers: saladHeaders(key) }, 8000) : undefined,
        }),
      );
    } else {
      setMesh(null);
    }
    if (next.kind === 'connected' && key) {
      const cloud = await probe(`${endpoint}/stats`, { headers: saladHeaders(key) }, 8000);
      if (cloud.ok && cloud.body) setStats({ ...emptyStats(), ...(cloud.body as CloudStats) });
    }
    const manifestUrl = studio.settings.updateManifestUrl.trim();
    if (manifestUrl) {
      const file = await probe(manifestUrl, {}, 8000);
      if (file.ok && file.body) {
        try {
          const manifest = parseManifest(JSON.stringify(file.body));
          if (updateAvailable(APP_VERSION_CODE, manifest)) {
            setUpdateLabel(`Update ${manifest.version} is ready`);
            setApkUrl(manifest.apkUrl);
          } else {
            setUpdateLabel(null);
          }
        } catch {
          setUpdateLabel(null);
        }
      }
    }
  }, [studio.settings]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const connectionTimer = setInterval(() => void refresh(), 30_000);
      const statsTimer = setInterval(() => {
        if (open) void refresh();
      }, 5_000);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
      });
      return () => {
        clearInterval(connectionTimer);
        clearInterval(statsTimer);
        sub.remove();
      };
    }, [open, refresh]),
  );

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, [open, refresh]);

  const tone = conn.kind === 'connected' ? colors.ok : conn.kind === 'starting' ? colors.amber : conn.kind === 'demo' ? colors.faint : colors.danger;
  const rate = studio.settings.hourlyRate || 0.13;
  const spent = sessionCost(connectedMs, rate);
  const warn = capWarning(spent, studio.settings.spendCap || 0);

  async function control(action: 'start' | 'stop' | 'delete') {
    const deployment = await readCloudDeployment();
    const key = await readSaladKey();
    if (!deployment || !key) {
      setNote('Open Cloud setup before starting or stopping a Salad server.');
      return;
    }
    const hourly = deployment.hourlyUsd || rate;
    const warning =
      action === 'start'
        ? `Starting bills about ${money(hourly)} per hour once the instance is running.`
        : action === 'stop'
          ? `A running server costs about ${money(hourly)} per hour until it stops. Stopped time is not billed.`
          : `Delete removes the Salad server. A running GPU is billed until it stops, about ${money(hourly)} per hour. Pictures on this phone stay.`;
    const ok = await confirmAction(action === 'delete' ? 'Delete the server?' : action === 'stop' ? 'Stop the server?' : 'Start the server?', warning, action === 'delete' ? 'Delete' : action === 'stop' ? 'Stop' : 'Start');
    if (!ok) return;
    try {
      await changeContainerGroup({ apiKey: key, deployment, action });
      if (action === 'delete') {
        await writeCloudDeployment(null);
        await studio.saveSaladEndpoint('');
      }
      await touchCloudActivity();
      setNote(action === 'delete' ? 'Server deleted.' : action === 'stop' ? 'Stop requested.' : 'Start requested.');
      void refresh();
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : 'Salad did not accept that.');
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable testID="connection-card" style={styles.card} onPress={() => router.push('/(tabs)/settings')}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {conn.title}
            {conn.latencyMs != null ? ` · ${conn.latencyMs} ms` : ''}
          </Text>
          <Text style={styles.detail}>{conn.detail}</Text>
        </View>
        <Pressable testID="connection-refresh" onPress={() => void refresh()} hitSlop={8}>
          <Text style={styles.link}>Test</Text>
        </Pressable>
      </Pressable>
      {mesh ? (
        <Pressable testID="mesh-connection" style={styles.mesh} onPress={() => router.push('/(tabs)/settings')}>
          <View style={[styles.dot, { backgroundColor: mesh.kind === 'connected' ? colors.ok : colors.amber }]} />
          <Text style={styles.detail}>3D server · {mesh.title}. {mesh.detail}</Text>
        </Pressable>
      ) : null}
      <View style={styles.tools}>
        <Pressable testID="status-expand" onPress={() => setOpen((value) => !value)}>
          <Text style={styles.link}>{open ? 'Hide status' : 'Status'}</Text>
        </Pressable>
        <Pressable testID="open-cloud-check" onPress={() => router.push('/cloud-check')}>
          <Text style={styles.link}>Check cloud</Text>
        </Pressable>
        <Pressable testID="open-queue" onPress={() => router.push('/(tabs)/queue')}>
          <Text style={styles.link}>Queue {tally.running + tally.waiting + tally.paused}</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/report')}>
          <Text style={styles.link}>Report</Text>
        </Pressable>
      </View>
      {updateLabel ? (
        <Pressable testID="update-banner" style={styles.banner} onPress={() => void downloadUpdate(apkUrl, setProgress)}>
          <Text style={styles.bannerText}>{progress == null ? `${updateLabel}. Tap to download.` : `Downloading update… ${progress}%`}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.detail}>Running costs {money(rate)} per hour. Stopped time is not billed.</Text>
      <View style={styles.tools}>
        <Pressable testID="stop-server" style={styles.server} onPress={() => void control('stop')}>
          <Text style={styles.serverText}>Stop server</Text>
        </Pressable>
        <Pressable testID="start-server" style={styles.server} onPress={() => void control('start')}>
          <Text style={styles.serverText}>Start server</Text>
        </Pressable>
        <Pressable testID="delete-server" style={styles.server} onPress={() => void control('delete')}>
          <Text style={styles.serverText}>Delete server</Text>
        </Pressable>
      </View>
      <View style={styles.tools}>
        {[0, 15, 30, 60].map((minutes) => (
          <Pressable key={minutes} testID={`idle-${minutes}`} onPress={() => void studio.updateSettings({ idleStopMinutes: minutes })}>
            <Text style={[styles.link, studio.settings.idleStopMinutes === minutes && styles.idleOn]}>
              {minutes === 0 ? 'Auto-stop off' : `Auto-stop ${minutes}m`}
            </Text>
          </Pressable>
        ))}
      </View>
      {note ? <Text style={styles.detail}>{note}</Text> : null}
      {open ? (
        <View testID="status-panel" style={styles.panel}>
          <Text style={styles.heading}>Running</Text>
          <Text style={styles.detail}>
            {tally.running} running · {tally.waiting} waiting · {tally.paused} paused. A GPU picture cannot pause halfway; Resume starts that picture again.
          </Text>
          <Text style={styles.heading}>This phone</Text>
          <Text style={styles.detail}>
            Source {studio.settings.sourceMode}. Memory and battery are read on the phone. This preview shows the panel without a Galaxy S25 Ultra attached.
          </Text>
          <Text style={styles.heading}>Cloud</Text>
          <Text style={styles.detail}>
            {stats.gpu} · VRAM {stats.vramUsedMb ?? '—'}/{stats.vramTotalMb ?? '—'} MB · util {stats.utilPercent ?? '—'}% · disk free {stats.diskFreeMb ?? '—'} MB · up {stats.uptimeSec}s
          </Text>
          <Text style={styles.detail}>
            Session {money(spent)} at {money(rate)}/hour. {warn ?? 'No spending cap set.'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 12 },
  mesh: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { color: colors.text, fontFamily: font.black, fontSize: 15 },
  detail: { color: colors.muted, fontFamily: font.semibold, fontSize: 13, lineHeight: 18 },
  link: { color: colors.cyan, fontFamily: font.black, fontSize: 13 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  banner: { backgroundColor: colors.accent, borderRadius: 10, padding: 10 },
  bannerText: { color: '#fff', fontFamily: font.black, fontSize: 14 },
  server: { backgroundColor: colors.cardAlt, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  serverText: { color: colors.text, fontFamily: font.black, fontSize: 13 },
  idleOn: { color: colors.gold },
  panel: { backgroundColor: colors.card, borderRadius: 12, padding: 12, gap: 6 },
  heading: { color: colors.text, fontFamily: font.black, fontSize: 13, textTransform: 'uppercase' },
});
