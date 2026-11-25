/** Picture jobs stay on the server. A phone network blip only retries the poll. */

export function isTransientNetwork(message: string): boolean {
  return /unknownhost|unable to resolve|timeout|timed out|network request failed|connection reset|econnreset|fetch failed|socket|aborted|failed to fetch/i.test(message);
}

export function retryDelayMs(attempt: number): number {
  return Math.min(15_000, 1000 * 2 ** Math.max(0, attempt));
}

export type JobView = {
  id?: string;
  status?: string;
  note?: string;
  step?: string;
  error?: string;
  ready?: boolean;
  image?: string;
  images?: string[];
  seeds?: number[];
  model?: string;
  consistency?: string;
  width?: number;
  height?: number;
  prompt?: string;
  mode?: string;
  page?: string;
  bubbles?: number;
  mask?: string;
};

export function jobFinished(view: JobView): boolean {
  return view.status === 'done' || view.status === 'failed' || view.ready === true;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function followJob(input: {
  id: string;
  read: () => Promise<JobView>;
  result: () => Promise<JobView>;
  onNote?: (note: string) => void;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<JobView> {
  const wait = input.sleepImpl ?? sleep;
  const now = input.now ?? Date.now;
  const deadline = now() + 25 * 60 * 1000;
  let failures = 0;
  while (now() < deadline) {
    try {
      const view = await input.read();
      failures = 0;
      if (view.status === 'failed') throw new Error(view.error || 'The picture could not be finished. The original was not changed.');
      if (view.status === 'done' || view.ready) return await input.result();
      input.onNote?.(view.step || view.note || '');
      await wait(2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missing = /no job with that id/i.test(message);
      if (!isTransientNetwork(message) && !missing) throw error;
      failures += 1;
      if (missing && failures > 6) throw new Error('The server restarted and that job is gone.');
      if (failures > 20) throw new Error('The phone lost the cloud for too long. The job may still be running.');
      await wait(retryDelayMs(failures));
    }
  }
  throw new Error('The picture is still running on the cloud.');
}
