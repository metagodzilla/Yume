import { PermissionsAndroid, Platform } from 'react-native';

import { containerGroupUrl, liveContainerGroup } from '@/src/lib/cloudActions';
import { civitaiModelUrl, filterModels, getCivitaiModel, modelPasses, pickPreview, searchCivitai, thumbnailUrl } from '@/src/lib/civitai';
import { classifyGatewayInput, normalizeEndpoint } from '@/src/lib/salad';
import { normalizeSaladKey, pullPercent } from '@/src/lib/saladCloud';
import { readPhone } from '@/src/lib/device';
import { OFFLINE_MODEL, offlineBlockedReason } from '@/src/lib/offline';
import { cancelJob, emptyQueue, enqueue, pauseJob, resumeJob } from '@/src/lib/queue';
import { rememberFault } from '@/src/lib/reportText';
import { deleteImageUri, persistPng, readCivitaiToken, readPng, readSaladKey } from '@/src/lib/storage';
import { checkGithubRelease } from '@/src/lib/updates';
import { APP_VERSION, APP_VERSION_CODE } from '@/src/lib/version';
import { type CheckRow, type CheckStatus } from '@/src/lib/checkRows';
import { modelCardPress, routeLeavesCreate } from '@/src/lib/checkpoints';

export type { CheckRow } from '@/src/lib/checkRows';
export { areaCounts } from '@/src/lib/checkRows';

const TEST_GENERATE = {
  prompt: 'yume check',
  width: 512,
  height: 512,
  steps: 8,
  count: 1,
  seed: 1,
  scheduler: 'euler_a',
};

export function settingsLine(): string {
  return `${TEST_GENERATE.width}×${TEST_GENERATE.height}, ${TEST_GENERATE.steps} steps, ${TEST_GENERATE.scheduler}, seed ${TEST_GENERATE.seed}, prompt "${TEST_GENERATE.prompt}"`;
}

export async function runCloudCheck(input: { endpoint: string; apiKey: string }): Promise<CheckRow[]> {
  const endpoint = normalizeEndpoint(input.endpoint);
  const key = normalizeSaladKey(input.apiKey);
  const rows: CheckRow[] = [];
  const deployment = liveContainerGroup();
  const groupUrl = containerGroupUrl(deployment);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key) {
    headers.Authorization = `Bearer ${key}`;
    headers['Salad-Api-Key'] = key;
    headers['X-Api-Key'] = key;
  }

  const group = await callJson(groupUrl, { headers });
  if (!key) {
    rows.push(row('Cloud', 'Salad key', 'skip', group.ms, 'No Salad API key is saved.', { url: groupUrl }));
  } else if (group.status === 200) {
    rows.push(row('Cloud', 'Salad key', 'pass', group.ms, 'The Salad API key was accepted.', { http: 200, url: groupUrl }));
  } else if (group.status === 401 || group.status === 403) {
    rows.push(row('Cloud', 'Salad key', 'fail', group.ms, `HTTP ${group.status}. Salad rejected the saved key.`, { http: group.status, detail: group.message, url: groupUrl }));
  } else {
    rows.push(row('Cloud', 'Salad key', 'fail', group.ms, group.message || `HTTP ${group.status || 0}.`, { http: group.status, detail: group.detail, url: groupUrl }));
  }

  const pulled = pullPercent(group.json);
  const statusName = groupStatusText(group.json);
  if (!key) {
    rows.push(row('Cloud', 'Group state', 'skip', group.ms, 'No Salad API key is saved, so the group was not read.'));
  } else if (group.status === 200) {
    const pull = pulled == null ? 'No pull percent was reported.' : `Pulling ${pulled}% complete.`;
    rows.push(row('Cloud', 'Group state', 'pass', group.ms, `Status ${statusName || 'unknown'}. ${pull}`, { http: 200, detail: group.detail, url: groupUrl }));
  } else {
    rows.push(row('Cloud', 'Group state', 'fail', group.ms, group.message || 'The container group could not be read.', { http: group.status, detail: group.detail, url: groupUrl }));
  }

  const health = endpoint ? await callJson(`${endpoint}/health`, { headers }) : null;
  const ready = endpoint ? await callJson(`${endpoint}/ready`, { headers }) : null;
  const stats = endpoint ? await callJson(`${endpoint}/stats`, { headers }) : null;
  rows.push(gatewayRow('Health', endpoint, health, '/health'));
  rows.push(gatewayRow('Ready', endpoint, ready, '/ready'));
  rows.push(gatewayRow('Stats', endpoint, stats, '/stats'));

  if (!endpoint || !key) {
    rows.push(row('Cloud', 'Generate', 'skip', 0, !endpoint ? 'No gateway URL is saved.' : 'No Salad API key is saved, so the test picture was not sent.'));
  } else if (!ready || ready.status !== 200) {
    rows.push(row('Cloud', 'Generate', 'skip', ready?.ms ?? 0, 'Server is not ready, so the test picture was not sent.', { http: ready?.status, detail: ready?.message }));
  } else {
    const generated = await callJson(
      `${endpoint}/generate`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(TEST_GENERATE),
      },
      90_000,
    );
    const image = firstImage(generated.json);
    if (generated.ok && image) {
      rows.push(
        row('Cloud', 'Generate', 'pass', generated.ms, `Test image returned in ${(generated.ms / 1000).toFixed(1)}s.`, {
          http: generated.status,
          imageUri: image,
          settings: settingsLine(),
          url: `${endpoint}/generate`,
        }),
      );
    } else {
      rows.push(row('Cloud', 'Generate', 'fail', generated.ms, generated.message || 'The test picture failed.', { http: generated.status, detail: generated.detail, settings: settingsLine(), url: `${endpoint}/generate` }));
    }
  }

  if (!endpoint || !key) {
    rows.push(row('Cloud', 'Errors', 'skip', 0, 'No gateway URL or Salad key, so /errors was not called.'));
  } else {
    const errors = await callJson(`${endpoint}/errors`, { headers });
    const latest = latestError(errors.json);
    if (errors.ok) {
      rows.push(row('Cloud', 'Errors', 'pass', errors.ms, latest || 'No server errors are stored.', { http: errors.status, detail: errors.detail, url: `${endpoint}/errors` }));
    } else {
      rows.push(row('Cloud', 'Errors', 'fail', errors.ms, errors.message || 'GET /errors failed.', { http: errors.status, detail: errors.detail, url: `${endpoint}/errors` }));
    }
  }

  if (!endpoint || !key) {
    rows.push(row('Cloud', 'Install endpoint', 'skip', 0, 'No gateway URL or Salad key, so the install route was not called.'));
  } else {
    const install = await callJson(`${endpoint}/models/install/self-test`, { headers });
    const reachable = install.status === 404 || install.status === 200;
    rows.push(
      row(
        'Cloud',
        'Install endpoint',
        reachable ? 'pass' : 'fail',
        install.ms,
        reachable ? 'The install route answered. No download was started.' : install.message || 'The install route did not answer.',
        { http: install.status, detail: install.detail, url: `${endpoint}/models/install/self-test` },
      ),
    );
  }

  rememberFailures('check', rows);
  return rows;
}

export async function runAppCheck(input: { endpoint: string }): Promise<CheckRow[]> {
  const rows: CheckRow[] = [];
  const token = await readCivitaiToken().catch(() => null);

  const search = await timed(() =>
    searchCivitai({ query: 'anime', type: 'Checkpoint', baseModel: 'SDXL 1.0', sort: 'Most Downloaded', contentFilter: 'all', token }),
  );
  if (search.error) {
    rows.push(row('Civitai', 'Search', 'fail', search.ms, search.error));
  } else if (!search.value || search.value.items.length === 0) {
    rows.push(row('Civitai', 'Search', 'fail', search.ms, 'Civitai search returned no models.'));
  } else {
    rows.push(row('Civitai', 'Search', 'pass', search.ms, `${search.value.items.length} models returned.`));
    const preview = pickPreview(search.value.items[0], 'all');
    const thumb = preview ? thumbnailUrl(preview.url) : '';
    if (!thumb) {
      rows.push(row('Civitai', 'Thumbnail', 'fail', 0, 'The first model had no image URL.'));
    } else {
      const image = await callJson(thumb, {}, 12_000);
      rows.push(
        row('Civitai', 'Thumbnail', image.ok ? 'pass' : 'fail', image.ms, image.ok ? 'The first preview image loaded.' : image.message || 'The preview image did not load.', {
          http: image.status,
          detail: thumb,
        }),
      );
    }
  }

  for (const filter of ['sfw', 'nsfw'] as const) {
    const filtered = await timed(() =>
      searchCivitai({ query: 'anime', type: 'Checkpoint', baseModel: 'SDXL 1.0', sort: 'Most Downloaded', contentFilter: filter, token }),
    );
    if (filtered.error) {
      rows.push(row('Civitai', filter === 'sfw' ? 'SFW only' : 'NSFW only', 'fail', filtered.ms, filtered.error));
      continue;
    }
    const items = filtered.value?.items ?? [];
    const client = filterModels(items, filter);
    const wrong = items.filter((item) => !modelPasses(item, filter));
    if (items.length === 0) {
      rows.push(row('Civitai', filter === 'sfw' ? 'SFW only' : 'NSFW only', 'fail', filtered.ms, `${filter.toUpperCase()} search returned no models.`));
    } else if (wrong.length > 0 || client.length !== items.length) {
      rows.push(row('Civitai', filter === 'sfw' ? 'SFW only' : 'NSFW only', 'fail', filtered.ms, `${wrong.length} of ${items.length} models did not match the ${filter} filter.`));
    } else {
      rows.push(row('Civitai', filter === 'sfw' ? 'SFW only' : 'NSFW only', 'pass', filtered.ms, `${items.length} models matched ${filter}.`));
    }
  }

  const detail = await timed(async () => {
    const found = await searchCivitai({ query: 'anime', type: 'LORA', baseModel: 'SDXL 1.0', sort: 'Most Downloaded', contentFilter: 'all', token });
    const first = found.items[0];
    if (!first) throw new Error('No LoRA came back to open.');
    const full = await getCivitaiModel(first.id, token);
    const versionId = full.modelVersions?.[0]?.id;
    const url = civitaiModelUrl(full.id, versionId);
    if (!url.startsWith('https://civitai.com/models/')) throw new Error(`Bad Civitai URL ${url}`);
    return `${full.name} · ${url}`;
  });
  rows.push(
    detail.error
      ? row('Civitai', 'Model detail', 'fail', detail.ms, detail.error)
      : row('Civitai', 'Model detail', 'pass', detail.ms, detail.value || 'Detail loaded.'),
  );

  if (!token) {
    rows.push(row('Civitai', 'Civitai key', 'skip', 0, 'No Civitai API key is saved.'));
  } else {
    const authed = await callJson('https://civitai.com/api/v1/models?limit=1', { headers: { Authorization: `Bearer ${token}` } });
    const ok = authed.status === 200;
    rows.push(row('Civitai', 'Civitai key', ok ? 'pass' : 'fail', authed.ms, ok ? 'Civitai accepted the saved key.' : authed.status === 401 || authed.status === 403 ? 'Civitai rejected the saved key.' : authed.message, { http: authed.status, detail: authed.detail }));
  }

  const queue = await timed(async () => {
    let state = enqueue(emptyQueue(), { id: 'self-test', kind: 'generate', title: 'CHECK dry run', createdAt: 1 });
    state = pauseJob(state, 'self-test');
    if (state.jobs[0]?.status !== 'paused') throw new Error(`Pause left the job ${state.jobs[0]?.status}.`);
    state = resumeJob(state, 'self-test');
    if (state.jobs[0]?.status !== 'waiting') throw new Error(`Resume left the job ${state.jobs[0]?.status}.`);
    state = cancelJob(state, 'self-test');
    if (state.jobs[0]?.status !== 'cancelled') throw new Error(`Cancel left the job ${state.jobs[0]?.status}.`);
    return 'Enqueue, pause, resume, and cancel all matched.';
  });
  rows.push(queue.error ? row('Queue', 'Dry run', 'fail', queue.ms, queue.error) : row('Queue', 'Dry run', 'pass', queue.ms, queue.value || 'Queue dry run passed.'));

  const library = await timed(async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
    const uri = await persistPng('yume-self-test.png', bytes);
    const back = await readPng(uri);
    if (back.length !== bytes.length) throw new Error(`Read ${back.length} bytes, wrote ${bytes.length}.`);
    await deleteImageUri(uri);
    return 'Saved, read, and deleted the test file.';
  });
  rows.push(library.error ? row('Library', 'Save and delete', 'fail', library.ms, library.error) : row('Library', 'Save and delete', 'pass', library.ms, library.value || 'Library round trip passed.'));

  const storedKey = await readSaladKey().catch((error: unknown) => {
    throw error;
  }).catch(() => '__read_failed__');
  const endpoint = normalizeEndpoint(input.endpoint);
  const classified = classifyGatewayInput(input.endpoint);
  if (storedKey === '__read_failed__') {
    rows.push(row('Connect', 'Secure store', 'fail', 0, 'The Salad key could not be read from Secure Store.'));
  } else if (!endpoint && !storedKey) {
    rows.push(row('Connect', 'Settings', 'skip', 0, 'No gateway URL or Salad key is saved.'));
  } else if (endpoint && classified.kind !== 'url') {
    rows.push(row('Connect', 'Settings', 'fail', 0, 'The saved server address is not an http(s) gateway URL.'));
  } else {
    rows.push(row('Connect', 'Settings', 'pass', 0, `${endpoint ? 'Gateway URL is valid.' : 'No URL saved.'} ${storedKey ? 'Salad key is stored.' : 'No Salad key stored.'}`));
  }

  const update = await timed(() => checkGithubRelease(APP_VERSION, APP_VERSION_CODE));
  if (update.error || !update.value) {
    rows.push(row('Updates', 'GitHub release', 'fail', update.ms, update.error || 'The update check failed.'));
  } else if (update.value.bad) {
    rows.push(row('Updates', 'GitHub release', 'fail', update.ms, update.value.label));
  } else {
    rows.push(row('Updates', 'GitHub release', 'pass', update.ms, `Installed versionCode ${APP_VERSION_CODE}. ${update.value.label}.`));
  }

  const phone = await timed(() => readPhone());
  if (phone.error) {
    rows.push(row('Phone', 'Sensors', 'fail', phone.ms, phone.error));
  } else if (phone.value && phone.value.batteryPercent == null && phone.value.tempC == null && phone.value.powerWatts == null && phone.value.source === 'none') {
    rows.push(row('Phone', 'Sensors', 'skip', phone.ms, 'This preview has no battery, thermal, or power sensors.'));
  } else {
    const reading = phone.value!;
    rows.push(row('Phone', 'Sensors', 'pass', phone.ms, `Battery ${reading.batteryPercent ?? 'n/a'}%, temp ${reading.tempC ?? 'n/a'}, power ${reading.powerWatts ?? 'n/a'} W, thermal ${reading.thermalStatus ?? 'n/a'}.`));
  }

  const offline = offlineBlockedReason({ modelReady: false, runtime: 'missing' });
  rows.push(
    offline
      ? row('Offline', 'Availability', 'pass', 0, `${OFFLINE_MODEL.name} is not bundled. ${offline}`)
      : row('Offline', 'Availability', 'fail', 0, 'Offline mode did not explain that the model is missing.'),
  );

  const live = liveContainerGroup();
  const expected = 'https://api.salad.com/api/public/organizations/seeyeevang707/projects/default/containers/yume-server';
  rows.push(
    live.organization === 'seeyeevang707' && live.project === 'default' && live.group === 'yume-server' && containerGroupUrl(live) === expected
      ? row('Setup', 'Wizard group', 'pass', 0, expected)
      : row('Setup', 'Wizard group', 'fail', 0, `Wizard points at ${containerGroupUrl(live)}.`),
  );

  const card = modelCardPress();
  const cardOpensSheet = card.action === 'open-sheet' && card.browse === '/(tabs)/explore' && routeLeavesCreate('/models') && !routeLeavesCreate(card.browse);
  rows.push(
    cardOpensSheet
      ? row('Navigation', 'Model card', 'pass', 0, 'The model card opens the checkpoint sheet. Browse Civitai opens Explore.')
      : row('Navigation', 'Model card', 'fail', 0, `The model card action is ${card.action}. Browse goes to ${card.browse}.`),
  );

  rows.push(await notificationRow());
  rememberFailures('app', rows);
  return rows;
}

async function notificationRow(): Promise<CheckRow> {
  if (Platform.OS !== 'android') return row('Permissions', 'Notifications', 'skip', 0, 'Notification permission is an Android setting. This preview cannot read it.');
  const version = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
  if (!Number.isFinite(version) || version < 33) return row('Permissions', 'Notifications', 'pass', 0, 'This Android version does not require a runtime notification prompt.');
  try {
    const allowed = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return row('Permissions', 'Notifications', allowed ? 'pass' : 'fail', 0, allowed ? 'Notifications are allowed for Yume.' : 'Notifications are not allowed for Yume.');
  } catch (error) {
    return row('Permissions', 'Notifications', 'fail', 0, error instanceof Error ? error.message : 'Notification permission could not be read.');
  }
}

function rememberFailures(source: 'check' | 'app', rows: CheckRow[]) {
  for (const item of rows) {
    if (item.status !== 'fail') continue;
    rememberFault({ time: Date.now(), source: source === 'check' ? 'check' : 'search', message: `${item.area} ${item.name}: ${item.message}`, endpoint: item.detail, status: item.http });
  }
}

function gatewayRow(name: string, endpoint: string, result: Call | null, path: string): CheckRow {
  if (!endpoint || !result) return row('Cloud', name, 'skip', 0, 'No gateway URL is saved.');
  return row('Cloud', name, result.ok ? 'pass' : 'fail', result.ms, result.ok ? 'OK' : result.message || `HTTP ${result.status || 0}.`, {
    http: result.status,
    detail: result.detail,
    url: `${endpoint}${path}`,
  });
}

type Call = { ok: boolean; status?: number; ms: number; message: string; detail?: string; json: unknown };

async function callJson(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Call> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const message = messageOf(json) || text.replace(/\s+/g, ' ').trim().slice(0, 180) || `HTTP ${response.status}.`;
    return { ok: response.ok, status: response.status, ms: Date.now() - started, message, detail: text.slice(0, 800), json };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { ok: false, ms: Date.now() - started, message: aborted ? 'The request timed out.' : error instanceof Error ? error.message : 'Request failed.', json: null };
  } finally {
    clearTimeout(timer);
  }
}

function messageOf(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const record = json as { detail?: unknown; message?: unknown; error?: unknown };
  const detail = record.detail ?? record.message ?? record.error;
  return typeof detail === 'string' ? detail : '';
}

function groupStatusText(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const current = (json as { current_state?: { status?: string } }).current_state;
  return current?.status || '';
}

function latestError(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const errors = (json as { errors?: { message?: string; endpoint?: string; status?: number }[] }).errors;
  const first = errors?.[0];
  if (!first) return '';
  return [first.endpoint, first.status ? `HTTP ${first.status}` : '', first.message].filter(Boolean).join(' ');
}

function firstImage(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const images = (json as { images?: unknown }).images;
  const first = Array.isArray(images) ? images[0] : null;
  if (typeof first !== 'string' || !first) return null;
  return first.startsWith('data:') ? first : `data:image/png;base64,${first}`;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; ms: number; error?: string }> {
  const started = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - started };
  } catch (error) {
    return { ms: Date.now() - started, error: error instanceof Error ? error.message : 'The check failed.' };
  }
}

function row(area: string, name: string, status: CheckStatus, ms: number, message: string, extra?: { http?: number; detail?: string; url?: string; imageUri?: string; settings?: string }): CheckRow {
  return {
    area,
    name,
    status,
    ms,
    message,
    http: extra?.http,
    detail: extra?.detail || extra?.url,
    imageUri: extra?.imageUri,
    settings: extra?.settings,
  };
}
