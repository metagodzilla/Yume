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

export const TRELLIS_MESH_NOTE =
  'Salad runs Microsoft TRELLIS on the front view only. The other turnaround angles are ignored, because this model does not take a multi-view set. Hair and hands often need cleanup.';

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
  mode: 'mock' | 'trellis' | 'demo';
  note: string;
};

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
    note: typeof parsed.note === 'string' ? parsed.note : mode === 'trellis' ? TRELLIS_MESH_NOTE : MESH_LIMIT,
  };
}
