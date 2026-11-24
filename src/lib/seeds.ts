const SEED_MAX = 2_147_483_647;

export function chooseSeeds(input: { locked: boolean; seedText: string; count: number; rng?: () => number }): { requestSeed: number; seeds: number[] } {
  const count = Math.max(1, Math.min(4, Math.floor(input.count) || 1));
  const rng = input.rng ?? Math.random;
  const base = input.locked ? lockedSeed(input.seedText) : Math.floor(rng() * SEED_MAX);
  return { requestSeed: base, seeds: expandSeeds(base, count) };
}

export function expandSeeds(base: number, count: number): number[] {
  const start = normalizeSeed(base);
  const total = Math.max(1, Math.min(4, Math.floor(count) || 1));
  return Array.from({ length: total }, (_, index) => (start + index) % SEED_MAX);
}

export function lockedSeed(seedText: string): number {
  const parsed = Number(String(seedText).replace(/[^\d]/g, ''));
  if (!Number.isFinite(parsed)) return 0;
  return Math.floor(parsed) % SEED_MAX;
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed) || seed < 0) return 0;
  return Math.floor(seed) % SEED_MAX;
}
