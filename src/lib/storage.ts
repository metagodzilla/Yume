import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { base64ToBytes, bytesToBase64 } from '@/src/lib/base64';
import { normalizeSaladKey } from '@/src/lib/saladCloud';
import { defaultLibrary } from '@/src/lib/library';
import type { SavedMesh } from '@/src/lib/mesh';
import type { TurnaroundBook } from '@/src/lib/turnaround';
import type { Character, Generation, Library, SamplerId, Session, Settings } from '@/src/lib/types';
import { DEFAULT_SESSION, DEFAULT_SETTINGS } from '@/src/lib/types';

const API_KEY = 'yume.openai.apiKey';
const CIVITAI_KEY = 'yume.civitai.apiToken';
const SALAD_KEY = 'yume.salad.apiKey';
const SALAD_ENDPOINT = 'yume.salad.endpoint';
const ADMIN_TOKEN = 'yume.server.adminToken';
const KEYS = {
  characters: 'yume.characters.v1',
  history: 'yume.history.v1',
  session: 'yume.session.v1',
  settings: 'yume.settings.v1',
  library: 'yume.library.v1',
  turnarounds: 'yume.turnarounds.v1',
  meshes: 'yume.meshes.v1',
  taste: 'yume.taste.v1',
};

let database: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('yume', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = null;
        reject(request.error);
      };
    });
  }
  return database;
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const request = tx.objectStore('kv').get(key);
    request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key: string, value: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return idbGet(key);
  return AsyncStorage.getItem(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await idbSet(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadCharacters(): Promise<Character[]> {
  const list = await loadJson<Character[]>(KEYS.characters, []);
  return Array.isArray(list) ? list : [];
}

export async function saveCharacters(characters: Character[]): Promise<void> {
  await setItem(KEYS.characters, JSON.stringify(characters));
}

export async function loadHistory(): Promise<Generation[]> {
  const list = await loadJson<Generation[]>(KEYS.history, []);
  return Array.isArray(list) ? list : [];
}

export async function saveHistory(history: Generation[]): Promise<void> {
  await setItem(KEYS.history, JSON.stringify(history));
}

export async function loadTaste(): Promise<string | null> {
  return getItem(KEYS.taste);
}

export async function saveTaste(value: string): Promise<void> {
  await setItem(KEYS.taste, value);
}

export async function loadSession(): Promise<Session> {
  const session = await loadJson<Partial<Session>>(KEYS.session, {});
  return {
    ...DEFAULT_SESSION,
    ...session,
    count: clampCount(session.count),
    previewDirty: session.previewDirty === true,
  };
}

export async function saveSession(session: Session): Promise<void> {
  await setItem(KEYS.session, JSON.stringify(session));
}

const SAMPLERS: SamplerId[] = ['euler_a', 'euler', 'dpm_2m', 'dpm_2m_karras', 'ddim', 'lcm'];

export async function loadSettings(): Promise<Settings> {
  const raw = await getItem(KEYS.settings);
  let settings: Partial<Settings> & { demoMode?: boolean; model?: string } = {};
  if (raw) {
    try {
      settings = JSON.parse(raw) as Partial<Settings> & { demoMode?: boolean; model?: string };
    } catch {
      settings = {};
    }
  }
  const legacyModel = settings.model === 'dall-e-3' || settings.openaiModel === 'dall-e-3' ? 'dall-e-3' : 'gpt-image-1';
  let provider = settings.provider;
  if (provider !== 'demo' && provider !== 'openai' && provider !== 'salad') {
    provider = settings.demoMode === false ? 'openai' : 'demo';
  }
  const savedBefore = Boolean(raw) && settings.setupComplete == null && (settings.provider === 'demo' || settings.provider === 'openai' || settings.provider === 'salad');
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    provider,
    setupComplete: settings.setupComplete === true || savedBefore,
    idleStopMinutes: clampRange(settings.idleStopMinutes, 0, 240, 0),
    lowPower: settings.lowPower === true,
    openaiModel: legacyModel,
    enhance: settings.enhance !== false,
    expandSnippets: settings.expandSnippets !== false,
    tuneLocked: settings.tuneLocked === true,
    customSize: settings.customSize === true,
    seedMode: settings.seedMode === 'fixed' ? 'fixed' : 'random',
    sampler: SAMPLERS.includes(settings.sampler as SamplerId) ? (settings.sampler as SamplerId) : 'euler_a',
    loras: Array.isArray(settings.loras) ? settings.loras : [],
    steps: clampRange(settings.steps, 1, 50, 28),
    cfg: clampRange(settings.cfg, 1, 20, 5.5),
    width: clampRange(settings.width, 512, 1536, 832),
    height: clampRange(settings.height, 512, 1536, 1216),
    seed: clampRange(settings.seed, 0, 2_147_483_647, 1),
    hourlyRateTouched: settings.hourlyRateTouched === true,
  };
}

export async function loadLibrary(): Promise<Library> {
  const stored = await loadJson<Partial<Library> | null>(KEYS.library, null);
  if (!stored || !Array.isArray(stored.styles) || stored.styles.length === 0) return defaultLibrary();
  return {
    styles: stored.styles,
    wildcards: Array.isArray(stored.wildcards) ? stored.wildcards : defaultLibrary().wildcards,
    templates: Array.isArray(stored.templates) ? stored.templates : defaultLibrary().templates,
  };
}

export async function saveLibrary(library: Library): Promise<void> {
  await setItem(KEYS.library, JSON.stringify(library));
}

export async function saveSettings(settings: Settings): Promise<void> {
  await setItem(KEYS.settings, JSON.stringify(settings));
}

function clampCount(value: number | undefined): number {
  if (!value || value < 1) return 1;
  if (value > 4) return 4;
  return Math.round(value);
}

function clampRange(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export async function secureStoreReady(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function readApiKey(): Promise<string | null> {
  try {
    if (!(await SecureStore.isAvailableAsync())) return null;
    const value = await SecureStore.getItemAsync(API_KEY);
    return value?.trim() ? value : null;
  } catch {
    return null;
  }
}

export async function writeApiKey(value: string | null): Promise<void> {
  await writeSecure(API_KEY, value);
}

export async function readCivitaiToken(): Promise<string | null> {
  return readSecure(CIVITAI_KEY);
}

export async function writeCivitaiToken(value: string | null): Promise<void> {
  await writeSecure(CIVITAI_KEY, value);
}

export async function loadQueueBlob(): Promise<string | null> {
  return getItem('yume.queue.v1');
}

export async function saveQueueBlob(value: string): Promise<void> {
  await setItem('yume.queue.v1', value);
}

export async function loadGeneratorBlob(): Promise<string | null> {
  return getItem('yume.generator.v1');
}

export async function saveGeneratorBlob(value: string): Promise<void> {
  await setItem('yume.generator.v1', value);
}

export async function loadKeptModels(): Promise<string | null> {
  return getItem('yume.keptModels.v1');
}

export async function saveKeptModels(value: string): Promise<void> {
  await setItem('yume.keptModels.v1', value);
}

export async function readSaladKey(): Promise<string | null> {
  const raw = await readSecure(SALAD_KEY);
  const key = normalizeSaladKey(raw);
  if (!key) return null;
  if (raw && key !== raw) await writeSecure(SALAD_KEY, key);
  return key;
}

export async function readAdminToken(): Promise<string | null> {
  return readSecure(ADMIN_TOKEN);
}

export async function writeAdminToken(value: string | null): Promise<void> {
  await writeSecure(ADMIN_TOKEN, value);
}

export async function writeSaladKey(value: string | null): Promise<void> {
  const key = normalizeSaladKey(value);
  await writeSecure(SALAD_KEY, key || null);
}

export async function readSaladEndpoint(): Promise<string | null> {
  return readSecure(SALAD_ENDPOINT);
}

const CLOUD_DEPLOY = 'yume.cloudDeploy.v1';
const CLOUD_ACTIVITY = 'yume.cloudActivity.v1';

export type CloudDeployment = {
  organization: string;
  project: string;
  group: string;
  gpuName: string;
  gpuClassId: string;
  hourlyUsd: number;
  image: string;
};

export async function readCloudDeployment(): Promise<CloudDeployment | null> {
  const parsed = await loadJson<CloudDeployment | null>(CLOUD_DEPLOY, null);
  if (!parsed || typeof parsed.organization !== 'string' || typeof parsed.project !== 'string' || typeof parsed.group !== 'string') return null;
  return parsed;
}

export async function writeCloudDeployment(value: CloudDeployment | null): Promise<void> {
  if (!value) {
    await setItem(CLOUD_DEPLOY, '');
    return;
  }
  await setItem(CLOUD_DEPLOY, JSON.stringify(value));
}

export async function readCloudActivity(): Promise<number> {
  const raw = await getItem(CLOUD_ACTIVITY);
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export async function touchCloudActivity(now = Date.now()): Promise<void> {
  await setItem(CLOUD_ACTIVITY, String(now));
}

export async function writeSaladEndpoint(value: string | null): Promise<void> {
  await writeSecure(SALAD_ENDPOINT, value);
}

async function readSecure(key: string): Promise<string | null> {
  try {
    if (!(await SecureStore.isAvailableAsync())) return null;
    const value = await SecureStore.getItemAsync(key);
    return value?.trim() ? value : null;
  } catch {
    return null;
  }
}

async function writeSecure(key: string, value: string | null): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error('This preview has no phone keychain. Open Yume in Expo Go to save a key with Secure Store.');
  }
  if (value) await SecureStore.setItemAsync(key, value.trim());
  else await SecureStore.deleteItemAsync(key);
}

export async function loadMeshes(): Promise<SavedMesh[]> {
  const list = await loadJson<SavedMesh[]>(KEYS.meshes, []);
  return Array.isArray(list) ? list : [];
}

export async function saveMeshes(meshes: SavedMesh[]): Promise<void> {
  await setItem(KEYS.meshes, JSON.stringify(meshes));
}

export async function loadTurnarounds(): Promise<TurnaroundBook[]> {
  const list = await loadJson<TurnaroundBook[]>(KEYS.turnarounds, []);
  return Array.isArray(list) ? list : [];
}

export async function saveTurnarounds(books: TurnaroundBook[]): Promise<void> {
  await setItem(KEYS.turnarounds, JSON.stringify(books));
}

export async function readPng(uri: string): Promise<Uint8Array> {
  if (uri.startsWith('data:')) return base64ToBytes(uri.slice(uri.indexOf(',') + 1));
  const { File } = await import('expo-file-system');
  const file = new File(uri);
  return new Uint8Array(await file.arrayBuffer());
}

export async function persistPng(filename: string, bytes: Uint8Array): Promise<string> {
  if (Platform.OS === 'web') {
    return `data:image/png;base64,${bytesToBase64(bytes)}`;
  }
  const { Directory, File, Paths } = await import('expo-file-system');
  const dir = new Directory(Paths.document, 'yume');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, filename);
  if (file.exists) file.delete();
  file.create();
  await file.write(bytes);
  return file.uri;
}

export async function deleteImageUri(uri: string): Promise<void> {
  if (Platform.OS === 'web' || !uri.startsWith('file')) return;
  try {
    const { File } = await import('expo-file-system');
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A missing file should not block clearing history.
  }
}
