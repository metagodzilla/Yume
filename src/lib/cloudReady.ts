import { liveContainerGroup, readContainerGroup } from '@/src/lib/cloudActions';
import { deploymentForEndpoint } from '@/src/lib/cloudSteps';
import { fetchInstalls } from '@/src/lib/downloadClient';
import { cloudIsOff } from '@/src/lib/installGate';
import { normalizeEndpoint } from '@/src/lib/salad';
import { groupStatusOf, normalizeSaladKey } from '@/src/lib/saladCloud';
import { readCloudDeployment } from '@/src/lib/storage';

export type CloudReady = {
  endpoint: string;
  groupStatus: string;
  readyStatus: number;
  off: boolean;
  versionIds: number[];
};

export async function readCloudReady(endpointInput: string, apiKey: string): Promise<CloudReady> {
  const endpoint = normalizeEndpoint(endpointInput);
  const key = normalizeSaladKey(apiKey);
  const headers = {
    Authorization: `Bearer ${key}`,
    'Salad-Api-Key': key,
    'X-Api-Key': key,
  };
  const deployment = deploymentForEndpoint(endpoint, await readCloudDeployment()) ?? liveContainerGroup();
  let groupStatus = '';
  try {
    const group = await readContainerGroup(key, deployment);
    groupStatus = groupStatusOf(group).status;
  } catch {
    groupStatus = 'stopped';
  }
  let readyStatus = 0;
  if (endpoint) {
    try {
      readyStatus = (await fetch(`${endpoint}/ready`, { headers })).status;
    } catch {
      readyStatus = 0;
    }
  }
  const versionIds: number[] = [];
  if (endpoint && !cloudIsOff({ groupStatus, readyStatus })) {
    try {
      const listed = await fetch(`${endpoint}/models`, { headers });
      if (listed.ok) {
        const body = (await listed.json()) as { models?: { versionId?: number }[] };
        for (const item of body.models ?? []) {
          if (typeof item.versionId === 'number') versionIds.push(item.versionId);
        }
      }
    } catch {
      // A catalog miss means nothing is marked installed.
    }
    try {
      const jobs = await fetchInstalls(endpoint, key);
      for (const job of jobs) {
        if (job.state === 'done') versionIds.push(job.versionId);
      }
    } catch {
      // Install history is optional. The catalog is the source of installed files.
    }
  }
  return { endpoint, groupStatus, readyStatus, off: cloudIsOff({ groupStatus, readyStatus }), versionIds };
}
