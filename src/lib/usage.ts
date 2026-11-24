export function sessionCost(connectedMs: number, hourlyUsd: number): number {
  if (connectedMs <= 0 || hourlyUsd <= 0) return 0;
  return (connectedMs / 3_600_000) * hourlyUsd;
}

export function capWarning(spentUsd: number, capUsd: number): string | null {
  if (capUsd <= 0) return null;
  if (spentUsd >= capUsd) return `This month is over the ${money(capUsd)} cap.`;
  if (spentUsd >= capUsd * 0.8) return `This month is near the ${money(capUsd)} cap.`;
  return null;
}

export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export type CloudStats = {
  gpu: string;
  utilPercent: number | null;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  diskFreeMb: number | null;
  diskTotalMb: number | null;
  uptimeSec: number;
  jobProgress: number | null;
  model: string;
  source: string;
};

export function emptyStats(): CloudStats {
  return {
    gpu: 'Unknown',
    utilPercent: null,
    vramUsedMb: null,
    vramTotalMb: null,
    ramUsedMb: null,
    ramTotalMb: null,
    diskFreeMb: null,
    diskTotalMb: null,
    uptimeSec: 0,
    jobProgress: null,
    model: 'Animagine XL 4.0',
    source: 'none',
  };
}
