import { useSyncExternalStore } from 'react';

import { castVote, emptyTaste, hideTasteItem, mergeTaste, publishTaste, type TasteStore, type TasteVote } from '@/src/lib/taste';

let state = emptyTaste();
const listeners = new Set<() => void>();
let hydrated = false;

function emit() {
  publishTaste(state);
  for (const listener of listeners) listener();
}

async function persist() {
  const { saveTaste } = await import('@/src/lib/storage');
  await saveTaste(JSON.stringify(state));
}

export async function hydrateTaste() {
  if (hydrated) return;
  hydrated = true;
  try {
    const { loadTaste } = await import('@/src/lib/storage');
    const raw = await loadTaste();
    if (!raw) return;
    const parsed = JSON.parse(raw) as TasteStore;
    if (!Array.isArray(parsed.votes) || !Array.isArray(parsed.hidden)) return;
    state = { votes: parsed.votes, hidden: parsed.hidden };
    emit();
  } catch {
    state = emptyTaste();
  }
}

export function getTaste(): TasteStore {
  return state;
}

export function voteImage(vote: TasteVote) {
  state = castVote(state, vote);
  emit();
  void persist();
}

export function removeTasteItem(key: string) {
  state = hideTasteItem(state, key);
  emit();
  void persist();
}

export function resetTaste() {
  state = emptyTaste();
  emit();
  void persist();
}

export function replaceTaste(store: TasteStore) {
  state = { votes: store.votes, hidden: store.hidden };
  emit();
  void persist();
}

export function importTaste(store: TasteStore, mode: 'merge' | 'replace') {
  replaceTaste(mode === 'replace' ? store : mergeTaste(state, store));
}

export function useTasteProfile(): TasteStore {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      void hydrateTaste();
      return () => listeners.delete(listener);
    },
    getTaste,
    getTaste,
  );
}
