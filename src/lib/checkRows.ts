export type CheckStatus = 'pass' | 'fail' | 'skip';

export type CheckRow = {
  area: string;
  name: string;
  status: CheckStatus;
  http?: number;
  message: string;
  ms: number;
  detail?: string;
  imageUri?: string;
  settings?: string;
};

export type AreaCount = { area: string; pass: number; fail: number; skip: number };

export function areaCounts(rows: CheckRow[]): AreaCount[] {
  const order: string[] = [];
  const map = new Map<string, AreaCount>();
  for (const row of rows) {
    let bucket = map.get(row.area);
    if (!bucket) {
      bucket = { area: row.area, pass: 0, fail: 0, skip: 0 };
      map.set(row.area, bucket);
      order.push(row.area);
    }
    bucket[row.status] += 1;
  }
  return order.map((area) => map.get(area)!);
}
