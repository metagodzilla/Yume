import { useEffect, useRef } from 'react';

import { readCloudReady } from '@/src/lib/cloudReady';
import { runModelInstall } from '@/src/lib/modelInstall';
import { normalizeEndpoint } from '@/src/lib/salad';
import { readCivitaiToken, readSaladKey } from '@/src/lib/storage';
import { finishJob, getQueue, queueCounts, reportJob, useQueue } from '@/src/lib/queuestore';
import { useStudio } from '@/src/studio';

export function InstallRunner() {
  const studio = useStudio();
  useQueue();
  const running = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => void pump(), 4000);
    return () => clearInterval(timer);
  }, [studio.settings.saladEndpoint]);

  async function pump() {
    if (running.current) return;
    const job = getQueue().jobs.find((item) => item.kind === 'install' && item.status === 'waiting' && item.versionId);
    if (!job?.versionId) return;
    const endpoint = normalizeEndpoint(studio.settings.saladEndpoint);
    const key = await readSaladKey();
    if (!endpoint || !key) return;
    const ready = await readCloudReady(endpoint, key);
    if (ready.off) return;
    running.current = true;
    reportJob(job.id, 0.02, 'Downloading on the server', 'running');
    try {
      const token = await readCivitaiToken();
      await runModelInstall({
        endpoint,
        apiKey: key,
        civitaiToken: token,
        versionId: job.versionId,
        name: job.title,
        onProgress: (label, fraction) => reportJob(job.id, fraction, label, 'running'),
      });
      finishJob(job.id);
    } catch (caught) {
      reportJob(job.id, 0, caught instanceof Error ? caught.message : 'The download failed.', 'failed');
    } finally {
      running.current = false;
    }
  }

  void queueCounts();
  return null;
}
