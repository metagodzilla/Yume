import { base64ToBytes, bytesToBase64 } from '@/src/lib/base64';
import { buildMockGlb } from '@/src/lib/glb';
import { normalizeEndpoint, saladErrorMessage } from '@/src/lib/salad';
import { normalizeSaladKey } from '@/src/lib/saladCloud';
import type { Character } from '@/src/lib/types';

export const MESH_STEPS = [
  'Reading the front view',
  'Asking for a mesh',
  'Building the shape',
  'Baking a texture',
  'Opening the viewer',
] as const;

export const MESH_LIMIT =
  'Fine details often need cleanup. Fingers, hair strands, and thin clothes can come out soft, melted, or stuck together. Treat this as a starting mesh, not a finished sculpt.';

export const DEMO_MESH_NOTE =
  'Demo studio builds a simple colored figure from the character traits. It does not reconstruct the drawing, and it does not run a 3D model. Hands are blobs on purpose.';

export const TRIPOSR_MESH_NOTE =
  'The picture server builds a textured GLB with TripoSR from one photo. Extra views are kept with the job. Hair and hands often need cleanup.';

export type SavedMesh = {
  characterId: string;
  createdAt: number;
  glbUri: string;
  sheetUri?: string;
  note: string;
  model: string;
  mode: string;
};

export type MeshResult = {
  glb: Uint8Array;
  model: string;
  mode: 'mock' | 'trellis' | 'triposr' | 'demo';
  note: string;
};

export const PICTURE_SERVER_MESH_MESSAGE =
  '3D is built on the picture server. Add that Salad gateway under Connect. A separate 3D URL is not required.';

/** An empty 3D URL means the picture server. A filled one is an older separate mesh gateway. */
export function meshPlan(meshEndpoint: string): 'picture' | 'separate' {
  return meshEndpoint.trim() ? 'separate' : 'picture';
}

export function demoMesh(character: Character): MeshResult {
  return {
    glb: buildMockGlb({ hair: character.hairColor, outfit: character.outfit, eye: character.eyeColor }),
    model: 'yume-stand-in',
    mode: 'demo',
    note: DEMO_MESH_NOTE,
  };
}

export async function requestSaladMesh(input: {
  endpoint: string;
  apiKey: string;
  frontPng: Uint8Array;
  views: { angle: string; png: Uint8Array }[];
}): Promise<MeshResult> {
  const endpoint = normalizeEndpoint(input.endpoint);
  if (!endpoint) {
    throw new Error('Add a 3D endpoint in Settings, or the Salad image endpoint. The mesh container is separate from the picture one.');
  }
  const apiKey = normalizeSaladKey(input.apiKey);
  if (!apiKey) throw new Error('Add the Salad API key in Settings. The mesh container uses the same key.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 110_000);
  let response: Response;
  try {
    response = await fetch(`${endpoint}/mesh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Api-Key': apiKey,
        'Salad-Api-Key': apiKey,
      },
      body: JSON.stringify({
        image: bytesToBase64(input.frontPng),
        views: input.views.map((view) => ({ angle: view.angle, image: bytesToBase64(view.png) })),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new Error(
      aborted
        ? 'The mesh request ended before a model came back. A cold Salad node can take several minutes, and the gateway stops a request after about 100 seconds. Wait until /ready says ready, then try again.'
        : saladErrorMessage({ aborted: false }),
    );
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  if (!response.ok) {
    const message = saladErrorMessage({ aborted: false, status: response.status, body: raw });
    if (response.status === 404) {
      throw new Error('That endpoint has no /mesh path. Deploy the mesh container and paste its gateway URL into the 3D endpoint.');
    }
    throw new Error(message);
  }
  let parsed: { glb?: unknown; model?: unknown; mode?: unknown; note?: unknown } = {};
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error('The mesh server answered, but not with a GLB.');
  }
  if (typeof parsed.glb !== 'string' || !parsed.glb) throw new Error('The mesh server did not return a GLB.');
  const mode = parsed.mode === 'trellis' ? 'trellis' : 'mock';
  return {
    glb: base64ToBytes(parsed.glb),
    model: typeof parsed.model === 'string' ? parsed.model : 'salad',
    mode,
    note: typeof parsed.note === 'string' ? parsed.note : mode === 'trellis' ? TRIPOSR_MESH_NOTE : MESH_LIMIT,
  };
}

function meshHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'X-Api-Key': apiKey,
    'Salad-Api-Key': apiKey,
  };
}

export async function requestPictureMesh(input: {
  endpoint: string;
  apiKey: string;
  image: Uint8Array;
  views: { angle: string; png: Uint8Array }[];
  onStatus?: (message: string) => void;
}): Promise<MeshResult> {
  const endpoint = normalizeEndpoint(input.endpoint);
  if (!endpoint) throw new Error('Add the picture server in Connect. 3D runs on that same cloud.');
  const apiKey = normalizeSaladKey(input.apiKey);
  if (!apiKey) throw new Error('Add the Salad API key in Connect. 3D uses the same key as pictures.');
  const headers = { ...meshHeaders(apiKey), 'Content-Type': 'application/json' };
  input.onStatus?.('Sending the picture to the cloud.');
  const started = await fetch(`${endpoint}/3d/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image: bytesToBase64(input.image),
      views: input.views.map((view) => ({ angle: view.angle, image: bytesToBase64(view.png) })),
    }),
  });
  const startedText = await started.text();
  if (!started.ok) throw new Error(saladErrorMessage({ aborted: false, status: started.status, body: startedText }));
  const job = JSON.parse(startedText) as { id?: unknown };
  if (typeof job.id !== 'string' || !job.id) throw new Error('The picture server did not start a 3D job.');
  const deadline = Date.now() + 20 * 60 * 1000;
  let modelName = 'stabilityai/TripoSR';
  while (Date.now() < deadline) {
    const status = await fetch(`${endpoint}/3d/jobs/${job.id}`, { headers: meshHeaders(apiKey) });
    const statusText = await status.text();
    if (!status.ok) throw new Error(saladErrorMessage({ aborted: false, status: status.status, body: statusText }));
    const body = JSON.parse(statusText) as { status?: string; error?: string; model?: string };
    if (body.model) modelName = body.model;
    if (body.status === 'error') throw new Error(body.error || 'The mesh could not be built.');
    if (body.status === 'done') break;
    input.onStatus?.(body.status === 'running' ? 'Building the mesh on the GPU. The first run also downloads TripoSR.' : 'Waiting for the 3D job.');
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  if (Date.now() >= deadline) throw new Error('The 3D job is still running. Leave the cloud up and try again in a minute.');
  const file = await fetch(`${endpoint}/3d/jobs/${job.id}/model.glb`, { headers: meshHeaders(apiKey) });
  if (!file.ok) {
    const detail = await file.text();
    throw new Error(saladErrorMessage({ aborted: false, status: file.status, body: detail }));
  }
  const glb = new Uint8Array(await file.arrayBuffer());
  if (glb.length < 12) throw new Error('The picture server did not return a GLB.');
  const mode = modelName.includes('mock') ? 'mock' : 'triposr';
  return { glb, model: modelName, mode, note: mode === 'triposr' ? TRIPOSR_MESH_NOTE : MESH_LIMIT };
}
