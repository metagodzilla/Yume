import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import { composePreview } from '@/src/lib/compose';
import { uid } from '@/src/lib/id';
import {
  defaultLibrary,
  deleteStyle,
  duplicateStyle,
  mergeLibrary,
  moveStyle,
  parseBundle,
  pixelsForAspect,
  replaceLibrary,
  restoreBuiltins,
  sortStyles,
  styleByStoredId,
  upsertStyle,
} from '@/src/lib/library';
import { dropTiles, withFavorite } from '@/src/lib/gallery';
import { produceImages } from '@/src/lib/produce';
import { classifyGatewayInput, migrateKeyStoredAsUrl } from '@/src/lib/salad';
import { normalizeSaladKey } from '@/src/lib/saladCloud';
import { exportBundle } from '@/src/lib/library';
import { getTaste, importTaste } from '@/src/lib/tasteStore';
import { throttleSteps } from '@/src/lib/phonePower';
import { getThrottle } from '@/src/lib/thermalState';
import {
  deleteImageUri,
  loadCharacters,
  loadHistory,
  loadLibrary,
  loadSession,
  loadSettings,
  persistPng,
  readApiKey,
  readSaladEndpoint,
  readSaladKey,
  saveCharacters,
  saveHistory,
  saveLibrary,
  saveSession,
  saveSettings,
  secureStoreReady,
  writeApiKey,
  writeSaladEndpoint,
  writeSaladKey,
} from '@/src/lib/storage';
import type {
  AspectId,
  Character,
  Generation,
  Library,
  LoraSpec,
  PromptTemplate,
  ProviderId,
  SamplerId,
  Session,
  Settings,
  UserStyle,
  ViewerState,
  Wildcard,
} from '@/src/lib/types';
import { DEFAULT_SESSION, DEFAULT_SETTINGS } from '@/src/lib/types';

const HISTORY_LIMIT = 30;

type StudioContextValue = {
  ready: boolean;
  prompt: string;
  setPrompt: (value: string) => void;
  preview: string;
  setPreview: (value: string) => void;
  previewDirty: boolean;
  resetPreview: () => void;
  rerollSnippets: () => void;
  styleId: string;
  selectStyle: (id: string) => void;
  aspectId: AspectId;
  setAspectId: (value: AspectId) => void;
  count: number;
  setCount: (value: number) => void;
  characters: Character[];
  selectedCharacterId: string | null;
  selectedCharacter: Character | null;
  selectCharacter: (id: string | null) => void;
  commitCharacter: (character: Character) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  history: Generation[];
  deleteGeneration: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  remix: (generation: Generation) => void;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  setEnhance: (value: boolean) => void;
  setExpandSnippets: (value: boolean) => void;
  setNegative: (value: string) => void;
  resetTune: () => void;
  setSeedMode: (value: 'random' | 'fixed') => void;
  setSeed: (value: number) => void;
  setSteps: (value: number) => void;
  setCfg: (value: number) => void;
  setSampler: (value: SamplerId) => void;
  setWidth: (value: number) => void;
  setHeight: (value: number) => void;
  setCustomSize: (value: boolean) => void;
  setSaladModel: (value: string) => void;
  setLoras: (value: LoraSpec[]) => void;
  setProvider: (value: ProviderId) => void;
  library: Library;
  upsertStyle: (style: UserStyle) => Promise<void>;
  duplicateStyle: (id: string) => Promise<void>;
  deleteStyle: (id: string) => Promise<void>;
  moveStyle: (id: string, direction: -1 | 1) => Promise<void>;
  restoreStyles: () => Promise<void>;
  saveWildcard: (card: Wildcard) => Promise<void>;
  deleteWildcard: (id: string) => Promise<void>;
  saveTemplate: (template: PromptTemplate) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  applyTemplate: (template: PromptTemplate) => void;
  exportLibrary: () => string;
  importLibrary: (raw: string, mode: 'merge' | 'replace') => Promise<string>;
  hasKey: boolean;
  hasSaladKey: boolean;
  secureStoreAvailable: boolean;
  saveKey: (value: string) => Promise<void>;
  clearKey: () => Promise<void>;
  saveSaladKey: (value: string) => Promise<void>;
  clearSaladKey: () => Promise<void>;
  saveSaladEndpoint: (value: string) => Promise<void>;
  cloudNotice: string | null;
  dismissCloudNotice: () => void;
  loading: boolean;
  status: string;
  error: string | null;
  clearError: () => void;
  generate: () => Promise<void>;
  rememberGeneration: (record: Generation) => Promise<void>;
  toggleFavorite: (id: string, index: number) => Promise<void>;
  removeGalleryTiles: (keys: { generationId: string; index: number }[]) => Promise<void>;
  viewer: ViewerState | null;
  openViewer: (viewer: ViewerState) => void;
  closeViewer: () => void;
  setViewerIndex: (index: number) => void;
};

const StudioContext = createContext<StudioContextValue | null>(null);

async function dropImages(items: Generation[]) {
  await Promise.all(items.flatMap((item) => item.imageUris.map((uri) => deleteImageUri(uri))));
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [prompt, setPromptState] = useState('');
  const [preview, setPreviewState] = useState('');
  const [previewDirty, setPreviewDirty] = useState(false);
  const [styleId, setStyleId] = useState(DEFAULT_SESSION.styleId);
  const [aspectId, setAspectIdState] = useState<AspectId>(DEFAULT_SESSION.aspectId);
  const [count, setCountState] = useState(DEFAULT_SESSION.count);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [library, setLibrary] = useState<Library>(defaultLibrary());
  const [hasKey, setHasKey] = useState(false);
  const [hasSaladKey, setHasSaladKey] = useState(false);
  const [secureStoreAvailable, setSecureStoreAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cloudNotice, setCloudNotice] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [storedCharacters, storedHistory, session, storedSettings, storedLibrary, key, saladKey, saladEndpoint, keychain] =
        await Promise.all([
          loadCharacters(),
          loadHistory(),
          loadSession(),
          loadSettings(),
          loadLibrary(),
          readApiKey(),
          readSaladKey(),
          readSaladEndpoint(),
          secureStoreReady(),
        ]);
      if (!live) return;
      setCharacters(storedCharacters);
      setHistory(storedHistory);
      setPromptState(session.prompt);
      setPreviewState(session.preview);
      setPreviewDirty(session.previewDirty);
      setStyleId(session.styleId);
      setAspectIdState(session.aspectId);
      setCountState(session.count);
      const selected = storedCharacters.some((character) => character.id === session.selectedCharacterId)
        ? session.selectedCharacterId
        : null;
      setSelectedCharacterId(selected);
      let endpoint = saladEndpoint || storedSettings.saladEndpoint || '';
      let nextSaladKey = saladKey;
      let nextSettings = storedSettings;
      const migrated = migrateKeyStoredAsUrl(endpoint, saladKey);
      if (migrated.moved) {
        const hadKey = Boolean(saladKey?.trim());
        let storedKey = hadKey;
        if (!hadKey && migrated.key && keychain) {
          await writeSaladKey(migrated.key);
          nextSaladKey = migrated.key;
          storedKey = true;
        }
        if (storedKey) {
          endpoint = '';
          nextSettings = { ...storedSettings, saladEndpoint: '' };
          if (keychain) await writeSaladEndpoint(null);
          await saveSettings(nextSettings);
          setCloudNotice(migrated.notice);
        }
      }
      setSettings({ ...nextSettings, saladEndpoint: endpoint });
      setLibrary(storedLibrary);
      setHasKey(Boolean(key));
      setHasSaladKey(Boolean(nextSaladKey));
      setSecureStoreAvailable(keychain);
      setReady(true);
    })().catch(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (sessionTimer.current) clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(() => {
      const session: Session = { prompt, preview, previewDirty, styleId, aspectId, count, selectedCharacterId };
      void saveSession(session);
    }, 250);
    return () => {
      if (sessionTimer.current) clearTimeout(sessionTimer.current);
    };
  }, [ready, prompt, preview, previewDirty, styleId, aspectId, count, selectedCharacterId]);

  useEffect(() => {
    if (!ready) return;
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    settingsTimer.current = setTimeout(() => {
      void saveSettings(settings);
    }, 250);
    return () => {
      if (settingsTimer.current) clearTimeout(settingsTimer.current);
    };
  }, [ready, settings]);

  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? null;
  const activeStyle = styleByStoredId(library.styles, styleId);

  useEffect(() => {
    if (!ready || previewDirty) return;
    const next = composePreview({
      userPrompt: prompt,
      enhance: settings.enhance,
      expandSnippets: settings.expandSnippets,
      style: activeStyle,
      aspectId,
      character: selectedCharacter,
      wildcards: library.wildcards,
    });
    setPreviewState((current) => (current === next ? current : next));
  }, [
    ready,
    previewDirty,
    prompt,
    settings.enhance,
    settings.expandSnippets,
    activeStyle,
    aspectId,
    selectedCharacter,
    library.wildcards,
  ]);

  useEffect(() => {
    if (!ready || settings.tuneLocked) return;
    setSettings((current) => {
      if (
        current.negative === activeStyle.negative &&
        current.steps === activeStyle.steps &&
        current.cfg === activeStyle.cfg &&
        current.sampler === activeStyle.sampler
      ) {
        return current;
      }
      return {
        ...current,
        negative: activeStyle.negative,
        steps: activeStyle.steps,
        cfg: activeStyle.cfg,
        sampler: activeStyle.sampler,
      };
    });
  }, [ready, settings.tuneLocked, activeStyle]);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const setCount = useCallback((value: number) => {
    setCountState(Math.max(1, Math.min(4, value)));
  }, []);

  const setAspectId = useCallback((value: AspectId) => {
    setAspectIdState(value);
    setSettings((current) => (current.customSize ? current : { ...current, ...pixelsForAspect(value) }));
  }, []);

  const selectCharacter = useCallback((id: string | null) => setSelectedCharacterId(id), []);

  const commitCharacter = useCallback(
    async (character: Character) => {
      const nextCharacter = { ...character, name: character.name.trim() || 'Unnamed', updatedAt: Date.now() };
      const next = characters.some((item) => item.id === nextCharacter.id)
        ? characters.map((item) => (item.id === nextCharacter.id ? nextCharacter : item))
        : [nextCharacter, ...characters];
      const pruned = nextCharacter.saved ? next : next.filter((item) => item.saved || item.id === nextCharacter.id);
      setCharacters(pruned);
      setSelectedCharacterId(nextCharacter.id);
      await saveCharacters(pruned);
    },
    [characters],
  );

  const deleteCharacter = useCallback(
    async (id: string) => {
      const next = characters.filter((character) => character.id !== id);
      setCharacters(next);
      if (selectedCharacterId === id) setSelectedCharacterId(null);
      await saveCharacters(next);
    },
    [characters, selectedCharacterId],
  );

  const rememberLibrary = useCallback(async (next: Library) => {
    setLibrary(next);
    await saveLibrary(next);
  }, []);

  const deleteGeneration = useCallback(
    async (id: string) => {
      const target = history.find((item) => item.id === id);
      const next = history.filter((item) => item.id !== id);
      setHistory(next);
      await saveHistory(next);
      if (target) await dropImages([target]);
    },
    [history],
  );

  const persistHistory = useCallback(async (next: Generation[]) => {
    setHistory(next);
    await saveHistory(next);
  }, []);

  const toggleFavorite = useCallback(
    async (id: string, index: number) => {
      const next = history.map((item) => (item.id === id ? withFavorite(item, index) : item));
      await persistHistory(next);
    },
    [history, persistHistory],
  );

  const removeGalleryTiles = useCallback(
    async (keys: { generationId: string; index: number }[]) => {
      const { next, removed } = dropTiles(history, keys);
      await persistHistory(next);
      await Promise.all(removed.map((uri) => deleteImageUri(uri)));
      setViewer(null);
    },
    [history, persistHistory],
  );

  const clearHistory = useCallback(async () => {
    const previous = history;
    setHistory([]);
    await saveHistory([]);
    await dropImages(previous);
  }, [history]);

  const remix = useCallback(
    (generation: Generation) => {
      setPromptState(generation.userPrompt);
      setPreviewState(generation.finalPrompt || generation.enhancedPrompt);
      setPreviewDirty(true);
      setStyleId(generation.styleId);
      setAspectIdState(generation.aspectId);
      setCountState(generation.count || 1);
      if (generation.characterId && characters.some((character) => character.id === generation.characterId)) {
        setSelectedCharacterId(generation.characterId);
      }
      setSettings((current) => ({
        ...current,
        provider: generation.provider || current.provider,
        enhance: generation.enhance !== false,
        negative: generation.negative || current.negative,
        tuneLocked: true,
        seedMode: generation.seed != null ? 'fixed' : 'random',
        seed: generation.seed ?? current.seed,
        steps: generation.steps || current.steps,
        cfg: generation.cfg || current.cfg,
        sampler: generation.sampler || current.sampler,
        width: generation.width || current.width,
        height: generation.height || current.height,
        customSize: true,
        saladModel: generation.saladModel || '',
        loras: generation.loras || [],
      }));
    },
    [characters],
  );

  const generate = useCallback(async () => {
    if (loading) return;
    void import('@/src/lib/storage').then(({ touchCloudActivity }) => touchCloudActivity());
    setError(null);
    const sent = (previewDirty ? preview : composePreview({
      userPrompt: prompt,
      enhance: settings.enhance,
      expandSnippets: settings.expandSnippets,
      style: activeStyle,
      aspectId,
      character: selectedCharacter,
      wildcards: library.wildcards,
    })).trim();
    if (!sent) {
      setError('The prompt that will be sent is empty. Write a scene, or turn the enhancer on.');
      return;
    }
    setLoading(true);
    setStatus(
      settings.provider === 'demo'
        ? 'Painting on this phone…'
        : settings.provider === 'salad'
          ? 'Sending it to Salad… a cold node can take a few minutes.'
          : 'Sending the prompt to OpenAI…',
    );
    const started = Date.now();
    try {
      const [openaiKey, saladKey] = await Promise.all([readApiKey(), readSaladKey()]);
      const throttle = getThrottle();
      let provider = settings.provider;
      if (throttle.preferCloud && settings.saladEndpoint.trim() && saladKey) provider = 'salad';
      const scaled =
        provider === 'demo' || settings.sourceMode === 'phone' ? throttleSteps(settings.steps, count, throttle) : { steps: settings.steps, count };
      if (throttle.pauseQueue && provider !== 'salad') {
        setError(throttle.notice || 'Phone is hot. The queue is paused until it cools.');
        return;
      }
      if (scaled.steps !== settings.steps && throttle.pauseMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, throttle.pauseMs));
      }
      const result = await produceImages({
        provider,
        prompt: sent,
        negative: settings.negative,
        styleId,
        aspectId,
        character: selectedCharacter,
        count: scaled.count,
        width: settings.width,
        height: settings.height,
        steps: scaled.steps,
        cfg: settings.cfg,
        sampler: settings.sampler,
        seedMode: settings.seedMode,
        seed: settings.seed,
        saladModel: settings.saladModel,
        loras: settings.loras,
        openaiModel: settings.openaiModel,
        openaiKey,
        saladEndpoint: settings.saladEndpoint,
        saladKey,
        platform: Platform.OS,
      });
      if (settings.provider === 'demo') {
        const wait = 700 - (Date.now() - started);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      if (result.seeds[0] != null) patchSettings({ seed: result.seeds[0] });
      const id = uid('gen');
      const imageUris: string[] = [];
      for (let index = 0; index < result.pngs.length; index += 1) {
        imageUris.push(await persistPng(`${id}-${index}.png`, result.pngs[index]));
      }
      const record: Generation = {
        id,
        createdAt: Date.now(),
        userPrompt: prompt.trim(),
        enhancedPrompt: sent,
        finalPrompt: sent,
        negative: settings.negative,
        styleId,
        styleName: activeStyle.name,
        aspectId,
        count: imageUris.length,
        characterId: selectedCharacter?.id ?? null,
        characterName: selectedCharacter?.name ?? null,
        imageUris,
        source: result.source,
        model: result.model,
        provider: settings.provider,
        enhance: settings.enhance,
        seed: result.seeds[0] ?? null,
        seeds: result.seeds,
        steps: settings.steps,
        cfg: settings.cfg,
        sampler: settings.sampler,
        width: settings.width,
        height: settings.height,
        saladModel: settings.saladModel,
        loras: settings.loras,
        warning: result.warning,
        durationMs: Date.now() - started,
      };
      const combined = [record, ...history];
      const next = combined.slice(0, HISTORY_LIMIT);
      setHistory(next);
      await saveHistory(next);
      if (combined.length > HISTORY_LIMIT) await dropImages(combined.slice(HISTORY_LIMIT));
      if (result.warning) setError(result.warning);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong while drawing.');
    } finally {
      setLoading(false);
      setStatus('');
    }
  }, [
    loading,
    previewDirty,
    preview,
    prompt,
    settings,
    activeStyle,
    aspectId,
    selectedCharacter,
    library.wildcards,
    styleId,
    count,
    history,
    patchSettings,
  ]);

  const value = useMemo<StudioContextValue>(
    () => ({
      ready,
      prompt,
      setPrompt: setPromptState,
      preview,
      setPreview: (next) => {
        setPreviewDirty(true);
        setPreviewState(next);
      },
      previewDirty,
      resetPreview: () => setPreviewDirty(false),
      rerollSnippets: () => {
        setPreviewState(
          composePreview({
            userPrompt: prompt,
            enhance: settings.enhance,
            expandSnippets: true,
            style: activeStyle,
            aspectId,
            character: selectedCharacter,
            wildcards: library.wildcards,
          }),
        );
        setPreviewDirty(true);
      },
      styleId,
      selectStyle: setStyleId,
      aspectId,
      setAspectId,
      count,
      setCount,
      characters,
      selectedCharacterId,
      selectedCharacter,
      selectCharacter,
      commitCharacter,
      deleteCharacter,
      history,
      deleteGeneration,
      clearHistory,
      remix,
      settings,
      updateSettings,
      setEnhance: (enhance) => patchSettings({ enhance }),
      setExpandSnippets: (expandSnippets) => patchSettings({ expandSnippets }),
      setNegative: (negative) => patchSettings({ negative, tuneLocked: true }),
      resetTune: () => patchSettings({ tuneLocked: false }),
      setSeedMode: (seedMode) => patchSettings({ seedMode }),
      setSeed: (seed) => patchSettings({ seed, seedMode: 'fixed' }),
      setSteps: (steps) => patchSettings({ steps, tuneLocked: true }),
      setCfg: (cfg) => patchSettings({ cfg, tuneLocked: true }),
      setSampler: (sampler) => patchSettings({ sampler, tuneLocked: true }),
      setWidth: (width) => patchSettings({ width, customSize: true }),
      setHeight: (height) => patchSettings({ height, customSize: true }),
      setCustomSize: (customSize) => {
        patchSettings(customSize ? { customSize } : { customSize, ...pixelsForAspect(aspectId) });
      },
      setSaladModel: (saladModel) => patchSettings({ saladModel }),
      setLoras: (loras) => patchSettings({ loras }),
      setProvider: (provider) => patchSettings({ provider }),
      library,
      upsertStyle: async (style) => rememberLibrary({ ...library, styles: upsertStyle(library.styles, style) }),
      duplicateStyle: async (id) => rememberLibrary({ ...library, styles: duplicateStyle(library.styles, id, uid('style')) }),
      deleteStyle: async (id) => {
        if (library.styles.length <= 1) return;
        const styles = deleteStyle(library.styles, id);
        await rememberLibrary({ ...library, styles });
        if (styleId === id && styles[0]) setStyleId(styles[0].id);
      },
      moveStyle: async (id, direction) => rememberLibrary({ ...library, styles: moveStyle(library.styles, id, direction) }),
      restoreStyles: async () => rememberLibrary({ ...library, styles: restoreBuiltins(library.styles) }),
      saveWildcard: async (card) => {
        const wildcards = library.wildcards.some((item) => item.id === card.id)
          ? library.wildcards.map((item) => (item.id === card.id ? card : item))
          : [...library.wildcards, card];
        await rememberLibrary({ ...library, wildcards });
      },
      deleteWildcard: async (id) => rememberLibrary({ ...library, wildcards: library.wildcards.filter((item) => item.id !== id) }),
      saveTemplate: async (template) => {
        const templates = library.templates.some((item) => item.id === template.id)
          ? library.templates.map((item) => (item.id === template.id ? template : item))
          : [...library.templates, template];
        await rememberLibrary({ ...library, templates });
      },
      deleteTemplate: async (id) => rememberLibrary({ ...library, templates: library.templates.filter((item) => item.id !== id) }),
      applyTemplate: (template) => {
        setPromptState(template.prompt);
        setPreviewDirty(false);
        if (template.negative) patchSettings({ negative: template.negative, tuneLocked: true });
      },
      exportLibrary: () => exportBundle(library, getTaste()),
      importLibrary: async (raw, mode) => {
        const parsed = parseBundle(raw);
        if (!parsed.ok) return parsed.error;
        const next = mode === 'replace' ? replaceLibrary(parsed.bundle) : mergeLibrary(library, parsed.bundle);
        await rememberLibrary(next);
        if (parsed.bundle.taste) importTaste(parsed.bundle.taste, mode);
        return mode === 'replace' ? 'Replaced your styles, snippets, and templates.' : 'Merged that file into the library.';
      },
      hasKey,
      hasSaladKey,
      secureStoreAvailable,
      saveKey: async (value) => {
        const trimmed = value.trim();
        if (!trimmed.startsWith('sk-')) throw new Error('That does not look like an OpenAI key. It should start with sk-.');
        await writeApiKey(trimmed);
        setHasKey(true);
      },
      clearKey: async () => {
        await writeApiKey(null);
        setHasKey(false);
      },
      saveSaladKey: async (value) => {
        const key = normalizeSaladKey(value);
        if (!key) throw new Error('Paste the key before saving.');
        await writeSaladKey(key);
        setHasSaladKey(true);
      },
      clearSaladKey: async () => {
        await writeSaladKey(null);
        setHasSaladKey(false);
      },
      saveSaladEndpoint: async (value) => {
        const classified = classifyGatewayInput(value);
        if (classified.kind === 'key') throw new Error('This looks like your API key — move it to Key?');
        if (classified.kind === 'invalid') throw new Error('The server URL has to start with http:// or https:// and include a host.');
        const endpoint = classified.kind === 'url' ? classified.url : '';
        patchSettings({ saladEndpoint: endpoint });
        if (await secureStoreReady()) await writeSaladEndpoint(endpoint || null);
      },
      cloudNotice,
      dismissCloudNotice: () => setCloudNotice(null),
      loading,
      status,
      error,
      clearError: () => setError(null),
      generate,
      rememberGeneration: async (record) => {
        const combined = [record, ...history];
        const next = combined.slice(0, HISTORY_LIMIT);
        setHistory(next);
        await saveHistory(next);
        if (combined.length > HISTORY_LIMIT) await dropImages(combined.slice(HISTORY_LIMIT));
      },
      toggleFavorite,
      removeGalleryTiles,
      viewer,
      openViewer: setViewer,
      closeViewer: () => setViewer(null),
      setViewerIndex: (index) => setViewer((current) => (current ? { ...current, index } : current)),
    }),
    [
      ready,
      prompt,
      preview,
      previewDirty,
      styleId,
      aspectId,
      setAspectId,
      count,
      setCount,
      characters,
      selectedCharacterId,
      selectedCharacter,
      selectCharacter,
      commitCharacter,
      deleteCharacter,
      history,
      deleteGeneration,
      clearHistory,
      toggleFavorite,
      removeGalleryTiles,
      remix,
      settings,
      updateSettings,
      patchSettings,
      library,
      rememberLibrary,
      activeStyle,
      hasKey,
      hasSaladKey,
      secureStoreAvailable,
      cloudNotice,
      loading,
      status,
      error,
      generate,
      viewer,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio must be used inside StudioProvider');
  return value;
}

export function orderedStyles(styles: UserStyle[]): UserStyle[] {
  return sortStyles(styles);
}
