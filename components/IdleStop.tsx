import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { changeContainerGroup, readContainerGroup } from '@/src/lib/cloudActions';
import { groupStatusOf, shouldIdleStop } from '@/src/lib/saladCloud';
import { counts } from '@/src/lib/queue';
import { useQueue } from '@/src/lib/queuestore';
import { readCloudActivity, readCloudDeployment, readSaladKey, touchCloudActivity } from '@/src/lib/storage';
import { publishQueue } from 'yume-queue';
import { useStudio } from '@/src/studio';

export function IdleStop() {
  const studio = useStudio();
  const queue = useQueue();
  const minutes = studio.settings.idleStopMinutes;
  const jobs = queue.jobs;
  const busy = useRef(false);

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
        const deployment = await readCloudDeployment();
        const key = await readSaladKey();
        if (!deployment || !key) return;
        const tally = counts({ jobs, autoResume: true, online: true });
        const activeJobs = tally.running + tally.waiting;
        try {
          const group = await readContainerGroup(key, deployment);
          const status = groupStatusOf(group);
          const running = status.status === 'running' || status.running > 0;
          const lastActivityMs = await readCloudActivity();
          if (!shouldIdleStop({ idleMinutes: minutes, lastActivityMs, now: Date.now(), activeJobs, running })) return;
          busy.current = true;
          await changeContainerGroup({ apiKey: key, deployment, action: 'stop' });
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
  }, [jobs, minutes]);

  return null;
}
