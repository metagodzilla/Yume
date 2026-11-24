import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { Platform } from 'react-native';

import { changeContainerGroup, liveContainerGroup, readContainerGroup } from '@/src/lib/cloudActions';
import { beginCloudStart, beginCloudStop, liveSessionQuote } from '@/src/lib/cloudRun';
import { deploymentForEndpoint } from '@/src/lib/cloudSteps';
import { groupStatusOf, shouldIdleStop, shouldIdleWarn } from '@/src/lib/saladCloud';
import { counts } from '@/src/lib/queue';
import { useQueue } from '@/src/lib/queuestore';
import { normalizeEndpoint } from '@/src/lib/salad';
import { readCloudActivity, readCloudDeployment, readSaladKey, touchCloudActivity } from '@/src/lib/storage';
import { publishQueue } from 'yume-queue';
import { useStudio } from '@/src/studio';

export function IdleStop() {
  const studio = useStudio();
  const queue = useQueue();
  const minutes = studio.settings.idleStopMinutes;
  const jobs = queue.jobs;
  const busy = useRef(false);
  const warned = useRef(false);

  useEffect(() => {
    void touchCloudActivity();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void touchCloudActivity();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void (async () => {
        if (busy.current || minutes <= 0) return;
        const saved = await readCloudDeployment();
        const deployment = deploymentForEndpoint(normalizeEndpoint(studio.settings.saladEndpoint), saved) ?? liveContainerGroup();
        const key = await readSaladKey();
        if (!key) return;
        const tally = counts({ jobs, autoResume: true, online: true });
        const activeJobs = tally.running + tally.waiting;
        try {
          const group = await readContainerGroup(key, deployment);
          const status = groupStatusOf(group);
          const running = status.status === 'running' || status.running > 0;
          const lastActivityMs = await readCloudActivity();
          const now = Date.now();
          const sample = { idleMinutes: minutes, lastActivityMs, now, activeJobs, running };
          if (shouldIdleWarn(sample)) {
            if (!warned.current) {
              warned.current = true;
              await warnIdleStop(minutes);
            }
            return;
          }
          if (!shouldIdleStop(sample)) {
            warned.current = false;
            return;
          }
          busy.current = true;
          const quote = liveSessionQuote();
          beginCloudStop(quote.usd, quote.upSec);
          try {
            await changeContainerGroup({ apiKey: key, deployment, action: 'stop' });
          } catch (error) {
            beginCloudStart();
            throw error;
          }
          publishQueue('Salad server stopped', `Idle for ${minutes} minutes, so Yume stopped it to save money.`, 100, 1);
          setTimeout(() => publishQueue('Yume', 'Idle stop', 0, 0), 5000);
          await touchCloudActivity();
        } catch {
          // A failed idle check should not interrupt drawing. The next minute tries again.
        } finally {
          busy.current = false;
        }
      })();
    }, 60_000);
    return () => clearInterval(timer);
  }, [jobs, minutes, studio.settings.saladEndpoint]);

  return null;
}

async function warnIdleStop(minutes: number) {
  const body = `No jobs for ${minutes - 1} minutes. Yume stops the cloud in 1 minute.`;
  publishQueue('Yume will stop the cloud', body, 0, 1);
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Yume will stop the cloud', body, sound: false },
      trigger: null,
    });
  } catch {
    // The next signed build includes notifications. The queue notice still runs.
  }
}
