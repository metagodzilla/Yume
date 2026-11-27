import {
  SALAD_API,
  SaladApiError,
  YUME_GROUP,
  YUME_IMAGE,
  YUME_ORGANIZATION,
  YUME_PROJECT,
  buildYumeContainerGroup,
  readNamedItems,
  saladRequest,
  type GpuChoice,
} from '@/src/lib/saladCloud';
import { logQueryBody } from '@/src/lib/saladLogs';
import type { CloudDeployment } from '@/src/lib/storage';

export function liveContainerGroup(): CloudDeployment {
  return {
    organization: YUME_ORGANIZATION,
    project: YUME_PROJECT,
    group: YUME_GROUP,
    gpuName: 'RTX 4090',
    gpuClassId: '',
    hourlyUsd: 0.253,
    image: YUME_IMAGE,
  };
}

export async function validateSaladKey(apiKey: string, fetchImpl?: typeof fetch) {
  return readContainerGroup(apiKey, liveContainerGroup(), fetchImpl);
}

export async function listOrganizations(apiKey: string, fetchImpl?: typeof fetch) {
  return saladRequest({ apiKey, path: '/organizations', fetchImpl });
}

export async function ensureYumeProject(apiKey: string, organization: string, fetchImpl?: typeof fetch): Promise<void> {
  const existing = await saladRequest({ apiKey, path: `/organizations/${encodeURIComponent(organization)}/projects`, fetchImpl });
  if (readNamedItems(existing).some((item) => item.name === YUME_PROJECT)) return;
  try {
    await saladRequest({
      apiKey,
      path: `/organizations/${encodeURIComponent(organization)}/projects`,
      method: 'POST',
      body: { name: YUME_PROJECT, display_name: 'Yume' },
      fetchImpl,
    });
  } catch (error) {
    if (error instanceof SaladApiError && error.status === 409) return;
    throw error;
  }
}

export async function listGpuClasses(apiKey: string, organization: string, fetchImpl?: typeof fetch) {
  return saladRequest({ apiKey, path: `/organizations/${encodeURIComponent(organization)}/gpu-classes`, fetchImpl });
}

export async function deployYumeGroup(input: {
  apiKey: string;
  organization: string;
  gpu: GpuChoice;
  adminToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<CloudDeployment> {
  const deployment: CloudDeployment = {
    organization: input.organization,
    project: YUME_PROJECT,
    group: YUME_GROUP,
    gpuName: input.gpu.name,
    gpuClassId: input.gpu.id,
    hourlyUsd: input.gpu.hourly,
    image: YUME_IMAGE,
  };
  const collection = collectionPath(deployment);
  try {
    await saladRequest({
      apiKey: input.apiKey,
      path: collection,
      method: 'POST',
      body: buildYumeContainerGroup({ apiKey: input.apiKey, gpuClassId: input.gpu.id, adminToken: input.adminToken }),
      fetchImpl: input.fetchImpl,
    });
  } catch (error) {
    if (!(error instanceof SaladApiError) || error.status !== 409) throw error;
  }
  try {
    await saladRequest({ apiKey: input.apiKey, path: `${groupPath(deployment)}/start`, method: 'POST', fetchImpl: input.fetchImpl });
  } catch (error) {
    if (!(error instanceof SaladApiError) || (error.status !== 409 && error.status !== 400)) throw error;
  }
  return deployment;
}

export async function readContainerGroup(apiKey: string, deployment: CloudDeployment, fetchImpl?: typeof fetch) {
  return saladRequest({ apiKey, path: groupPath(deployment), fetchImpl });
}

export async function readContainerInstances(apiKey: string, deployment: CloudDeployment, fetchImpl?: typeof fetch) {
  return saladRequest({ apiKey, path: `${groupPath(deployment)}/instances`, fetchImpl });
}

export async function queryContainerLogs(input: {
  apiKey: string;
  organization: string;
  group: string;
  instanceId?: string;
  start: string;
  end: string;
  fetchImpl?: typeof fetch;
}) {
  return saladRequest({
    apiKey: input.apiKey,
    path: `/organizations/${encodeURIComponent(input.organization)}/log-entries`,
    method: 'POST',
    body: logQueryBody({ group: input.group, instanceId: input.instanceId, start: input.start, end: input.end }),
    fetchImpl: input.fetchImpl,
  });
}

export function reallocateInstancePath(deployment: CloudDeployment, instanceId: string): string {
  return `${groupPath(deployment)}/instances/${encodeURIComponent(instanceId)}/reallocate`;
}

export async function reallocateInstance(apiKey: string, deployment: CloudDeployment, instanceId: string, fetchImpl?: typeof fetch) {
  return saladRequest({ apiKey, path: reallocateInstancePath(deployment, instanceId), method: 'POST', fetchImpl });
}

export function containerGroupUrl(deployment: CloudDeployment): string {
  return `${SALAD_API}${groupPath(deployment)}`;
}

export async function changeContainerGroup(input: {
  apiKey: string;
  deployment: CloudDeployment;
  action: 'start' | 'stop' | 'delete';
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const path = groupPath(input.deployment);
  if (input.action === 'delete') {
    try {
      await saladRequest({ apiKey: input.apiKey, path, method: 'DELETE', fetchImpl: input.fetchImpl });
    } catch (error) {
      if (error instanceof SaladApiError && error.status === 404) return;
      throw error;
    }
    return;
  }
  await saladRequest({ apiKey: input.apiKey, path: `${path}/${input.action}`, method: 'POST', fetchImpl: input.fetchImpl });
}

function collectionPath(deployment: CloudDeployment): string {
  return `/organizations/${encodeURIComponent(deployment.organization)}/projects/${encodeURIComponent(deployment.project)}/containers`;
}

function groupPath(deployment: CloudDeployment): string {
  return `${collectionPath(deployment)}/${encodeURIComponent(deployment.group)}`;
}
