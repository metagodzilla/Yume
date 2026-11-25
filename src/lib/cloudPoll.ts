/** While the cloud is ready, the status card does not need a 5 second refresh. */
export function cloudPollMs(ready: boolean): number {
  return ready ? 60_000 : 5_000;
}

/** Restore models once for each server boot, not on every status refresh. */
export function shouldRestoreBoot(bootId: string, restoredBootId: string): boolean {
  const id = bootId.trim();
  return Boolean(id) && id !== restoredBootId;
}
