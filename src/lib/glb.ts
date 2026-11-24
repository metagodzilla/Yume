import { encodePng } from '@/src/lib/png';

export type RGB = [number, number, number];

export type ParsedPrimitive = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  color: [number, number, number, number];
  png?: Uint8Array;
};

const HAIR: Record<string, RGB> = {
  black: [36, 28, 42],
  chestnut: [120, 72, 48],
  blonde: [232, 196, 122],
  silver: [214, 214, 224],
  pink: [255, 142, 199],
  blue: [48, 64, 140],
  crimson: [176, 42, 64],
  white: [244, 244, 248],
};

const OUTFIT: Record<string, RGB> = {
  blazer: [48, 58, 96],
  street: [64, 48, 72],
  coat: [92, 64, 48],
  armor: [150, 154, 168],
  kimono: [168, 56, 84],
  idol: [232, 96, 168],
  hoodie: [72, 96, 150],
  cape: [72, 40, 96],
};

const EYE: Record<string, RGB> = {
  amber: [214, 140, 48],
  blue: [64, 140, 210],
  crimson: [176, 42, 64],
  emerald: [48, 160, 110],
  violet: [150, 96, 210],
  gold: [230, 180, 64],
  mismatch: [90, 170, 190],
};

function tone(table: Record<string, RGB>, value: string, fallback: RGB): RGB {
  const known = table[value.trim()];
  if (known) return known;
  let hash = 0;
  for (const char of value) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return [80 + (hash % 140), 60 + ((hash >> 8) % 120), 80 + ((hash >> 16) % 140)];
}

type Parts = {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
};

function addEllipsoid(
  parts: Parts,
  center: [number, number, number],
  radius: [number, number, number],
  segs: number,
  rings: number,
  uv: [number, number],
) {
  const start = parts.positions.length / 3;
  for (let y = 0; y <= rings; y += 1) {
    const v = y / rings;
    const theta = v * Math.PI;
    for (let x = 0; x <= segs; x += 1) {
      const u = x / segs;
      const phi = u * Math.PI * 2;
      const sx = Math.sin(theta) * Math.cos(phi);
      const sy = Math.cos(theta);
      const sz = Math.sin(theta) * Math.sin(phi);
      parts.positions.push(center[0] + sx * radius[0], center[1] + sy * radius[1], center[2] + sz * radius[2]);
      const nx = sx / radius[0];
      const ny = sy / radius[1];
      const nz = sz / radius[2];
      const len = Math.hypot(nx, ny, nz) || 1;
      parts.normals.push(nx / len, ny / len, nz / len);
      parts.uvs.push(uv[0], uv[1]);
    }
  }
  const row = segs + 1;
  for (let y = 0; y < rings; y += 1) {
    for (let x = 0; x < segs; x += 1) {
      const a = start + y * row + x;
      const b = a + row;
      parts.indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

function floats(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return out;
}

function pad(bytes: Uint8Array, fill: number): Uint8Array {
  const extra = (4 - (bytes.length % 4)) % 4;
  if (!extra) return bytes;
  const out = new Uint8Array(bytes.length + extra);
  out.set(bytes);
  out.fill(fill, bytes.length);
  return out;
}

function bounds(values: number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = values[i + axis] ?? 0;
      min[axis] = Math.min(min[axis] ?? Infinity, value);
      max[axis] = Math.max(max[axis] ?? -Infinity, value);
    }
  }
  return { min, max };
}

/** A small textured GLB. Demo mode uses it as a stand-in, not a scan of the drawing. */
export function buildMockGlb(input: { hair?: string; outfit?: string; eye?: string } = {}): Uint8Array {
  const hair = tone(HAIR, input.hair ?? '', [255, 142, 199]);
  const outfit = tone(OUTFIT, input.outfit ?? '', [72, 40, 96]);
  const eye = tone(EYE, input.eye ?? '', [64, 140, 210]);
  const skin: RGB = [242, 196, 176];
  const png = encodePng(4, 1, new Uint8ClampedArray([...skin, 255, ...hair, 255, ...outfit, 255, ...eye, 255]));
  const parts: Parts = { positions: [], normals: [], uvs: [], indices: [] };
  addEllipsoid(parts, [0, 1.35, 0], [0.42, 0.48, 0.4], 12, 8, [0.125, 0.5]);
  addEllipsoid(parts, [0, 0.55, 0], [0.46, 0.62, 0.32], 12, 8, [0.625, 0.5]);
  addEllipsoid(parts, [0, 1.55, -0.02], [0.48, 0.42, 0.46], 12, 6, [0.375, 0.5]);
  addEllipsoid(parts, [-0.62, 0.85, 0], [0.12, 0.34, 0.12], 8, 6, [0.625, 0.5]);
  addEllipsoid(parts, [0.62, 0.85, 0], [0.12, 0.34, 0.12], 8, 6, [0.625, 0.5]);
  addEllipsoid(parts, [-0.14, 1.38, 0.34], [0.07, 0.08, 0.05], 8, 6, [0.875, 0.5]);
  addEllipsoid(parts, [0.14, 1.38, 0.34], [0.07, 0.08, 0.05], 8, 6, [0.875, 0.5]);

  const indexBytes = new Uint8Array(parts.indices.length * 2);
  const indexView = new DataView(indexBytes.buffer);
  parts.indices.forEach((value, index) => indexView.setUint16(index * 2, value, true));
  const blocks = [indexBytes, floats(parts.positions), floats(parts.normals), floats(parts.uvs), png];
  const padded = blocks.map((block, index) => pad(block, index === blocks.length - 1 ? 0 : 0));
  let cursor = 0;
  const bufferViews = blocks.map((block, index) => {
    const view = { buffer: 0, byteOffset: cursor, byteLength: block.length, target: index === 0 ? 34963 : index < 4 ? 34962 : undefined };
    cursor += padded[index]?.length ?? 0;
    return view;
  });
  const bin = new Uint8Array(cursor);
  padded.forEach((block, index) => bin.set(block, bufferViews[index]?.byteOffset ?? 0));
  const box = bounds(parts.positions);
  const json = {
    asset: { version: '2.0', generator: 'yume' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'stand-in' }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 1, NORMAL: 2, TEXCOORD_0: 3 },
            indices: 0,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
        doubleSided: true,
      },
    ],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728 }],
    images: [{ mimeType: 'image/png', bufferView: 4 }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: bufferViews.map((item) => {
      const view: { buffer: number; byteOffset: number; byteLength: number; target?: number } = {
        buffer: item.buffer,
        byteOffset: item.byteOffset,
        byteLength: item.byteLength,
      };
      if (item.target) view.target = item.target;
      return view;
    }),
    accessors: [
      {
        bufferView: 0,
        componentType: 5123,
        count: parts.indices.length,
        type: 'SCALAR',
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: parts.positions.length / 3,
        type: 'VEC3',
        min: box.min,
        max: box.max,
      },
      { bufferView: 2, componentType: 5126, count: parts.normals.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: 5126, count: parts.uvs.length / 2, type: 'VEC2' },
    ],
  };
  const jsonBytes = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const jsonChunk = chunk(0x4e4f534a, jsonBytes);
  const binChunk = chunk(0x004e4942, bin);
  const total = 12 + jsonChunk.length + binChunk.length;
  const out = new Uint8Array(total);
  const header = new DataView(out.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, total, true);
  out.set(jsonChunk, 12);
  out.set(binChunk, 12 + jsonChunk.length);
  return out;
}

function chunk(type: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, true);
  view.setUint32(4, type, true);
  out.set(data, 8);
  return out;
}

const COMPONENT = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as const;
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as const;

function readAccessor(json: GlbJson, bin: Uint8Array, index: number): Float32Array | Uint16Array | Uint32Array {
  const accessor = json.accessors[index];
  if (!accessor || accessor.bufferView == null) throw new Error('This GLB has an empty accessor.');
  const view = json.bufferViews[accessor.bufferView];
  if (!view) throw new Error('This GLB is missing a buffer.');
  const component = COMPONENT[accessor.componentType as keyof typeof COMPONENT];
  const width = WIDTH[accessor.type as keyof typeof WIDTH];
  if (!component || !width) throw new Error('This GLB uses a vertex format the viewer cannot read.');
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? component * width;
  const count = accessor.count * width;
  const bytes = new Uint8Array(count * component);
  for (let i = 0; i < accessor.count; i += 1) {
    bytes.set(bin.subarray(start + i * stride, start + i * stride + component * width), i * component * width);
  }
  const copy = bytes.buffer;
  if (accessor.componentType === 5126) return new Float32Array(copy);
  if (accessor.componentType === 5123) return new Uint16Array(copy);
  if (accessor.componentType === 5125) return new Uint32Array(copy);
  throw new Error('This GLB uses a vertex format the viewer cannot read.');
}

type GlbJson = {
  buffers?: { byteLength: number }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  accessors: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
  }[];
  meshes?: {
    primitives: {
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
    }[];
  }[];
  materials?: {
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: { index: number };
    };
  }[];
  textures?: { source?: number }[];
  images?: { mimeType?: string; bufferView?: number }[];
  nodes?: {
    mesh?: number;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
  }[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
};

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        (a[row] ?? 0) * (b[col * 4] ?? 0) +
        (a[4 + row] ?? 0) * (b[col * 4 + 1] ?? 0) +
        (a[8 + row] ?? 0) * (b[col * 4 + 2] ?? 0) +
        (a[12 + row] ?? 0) * (b[col * 4 + 3] ?? 0);
    }
  }
  return out;
}

function nodeMatrix(node: NonNullable<GlbJson['nodes']>[number]): number[] {
  if (node.matrix && node.matrix.length === 16) return node.matrix;
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const x = r[0] ?? 0;
  const y = r[1] ?? 0;
  const z = r[2] ?? 0;
  const w = r[3] ?? 1;
  const rotation = [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    0,
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    0,
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
    0,
    0,
    0,
    0,
    1,
  ];
  const scale = [s[0] ?? 1, 0, 0, 0, 0, s[1] ?? 1, 0, 0, 0, 0, s[2] ?? 1, 0, 0, 0, 0, 1];
  const translation = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0] ?? 0, t[1] ?? 0, t[2] ?? 0, 1];
  return multiply(translation, multiply(rotation, scale));
}

function transformPoint(matrix: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0),
  ];
}

function imageBytes(json: GlbJson, bin: Uint8Array, materialIndex: number | undefined): Uint8Array | undefined {
  const material = materialIndex == null ? undefined : json.materials?.[materialIndex];
  const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
  const source = textureIndex == null ? undefined : json.textures?.[textureIndex]?.source;
  const image = source == null ? undefined : json.images?.[source];
  if (!image || image.bufferView == null) return undefined;
  if (image.mimeType && image.mimeType !== 'image/png') return undefined;
  const view = json.bufferViews[image.bufferView];
  if (!view) return undefined;
  const start = view.byteOffset ?? 0;
  return bin.slice(start, start + view.byteLength);
}

/** Reads the meshes a TRELLIS GLB or the demo stand-in is likely to contain. */
export function parseGlb(bytes: Uint8Array): ParsedPrimitive[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('That file is not a GLB mesh.');
  const length = view.getUint32(8, true);
  if (length > bytes.length) throw new Error('The GLB is cut off.');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GlbJson;
  const binHeader = 20 + jsonLength;
  const binLength = view.getUint32(binHeader, true);
  const bin = bytes.subarray(binHeader + 8, binHeader + 8 + binLength);
  const meshes = json.meshes ?? [];
  const nodes = json.nodes ?? [];
  const sceneNodes = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, index) => index);
  const found: ParsedPrimitive[] = [];

  const visit = (index: number, parent: number[]) => {
    const node = nodes[index];
    if (!node) return;
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh != null) {
      const mesh = meshes[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        const position = readAccessor(json, bin, primitive.attributes.POSITION ?? -1);
        const normal = primitive.attributes.NORMAL != null ? readAccessor(json, bin, primitive.attributes.NORMAL) : position;
        const uv = primitive.attributes.TEXCOORD_0 != null ? readAccessor(json, bin, primitive.attributes.TEXCOORD_0) : new Float32Array((position.length / 3) * 2);
        const indices =
          primitive.indices != null
            ? readAccessor(json, bin, primitive.indices)
            : Uint32Array.from({ length: position.length / 3 }, (_, item) => item);
        if (!(position instanceof Float32Array) || !(normal instanceof Float32Array) || !(uv instanceof Float32Array)) {
          throw new Error('This GLB uses a vertex format the viewer cannot read.');
        }
        if (!(indices instanceof Uint16Array) && !(indices instanceof Uint32Array)) {
          throw new Error('This GLB uses a vertex format the viewer cannot read.');
        }
        const baked = new Float32Array(position.length);
        const bakedNormals = new Float32Array(normal.length);
        for (let i = 0; i < position.length; i += 3) {
          const point = transformPoint(world, position[i] ?? 0, position[i + 1] ?? 0, position[i + 2] ?? 0);
          baked[i] = point[0];
          baked[i + 1] = point[1];
          baked[i + 2] = point[2];
          const direction = transformPoint(world, normal[i] ?? 0, normal[i + 1] ?? 0, normal[i + 2] ?? 0);
          const origin = transformPoint(world, 0, 0, 0);
          const nx = direction[0] - origin[0];
          const ny = direction[1] - origin[1];
          const nz = direction[2] - origin[2];
          const len = Math.hypot(nx, ny, nz) || 1;
          bakedNormals[i] = nx / len;
          bakedNormals[i + 1] = ny / len;
          bakedNormals[i + 2] = nz / len;
        }
        const factor = json.materials?.[primitive.material ?? -1]?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
        found.push({
          positions: baked,
          normals: bakedNormals,
          uvs: uv,
          indices,
          color: [factor[0] ?? 1, factor[1] ?? 1, factor[2] ?? 1, factor[3] ?? 1],
          png: imageBytes(json, bin, primitive.material),
        });
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const index of sceneNodes) visit(index, identity);
  if (!found.length && meshes[0]) visit(0, identity);
  if (!found.length) throw new Error('The GLB did not contain a mesh.');
  return found;
}
