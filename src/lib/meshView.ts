import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Group,
  WebGLRenderer,
} from 'three';

import { decodePng } from '@/src/lib/sheet';
import { encodePng } from '@/src/lib/png';
import { parseGlb } from '@/src/lib/glb';

export type MeshShot = 'front' | 'side' | 'back';

export type MeshRig = {
  resize(width: number, height: number): void;
  look(yaw: number, pitch: number, distance: number): void;
  draw(): void;
  shot(view: MeshShot): Uint8Array;
  dispose(): void;
};

const YAW: Record<MeshShot, number> = { front: 0, side: Math.PI / 2, back: Math.PI };

export function createMeshRig(renderer: WebGLRenderer, glb: Uint8Array): MeshRig {
  const scene = new Scene();
  scene.background = new Color('#160b1e');
  const camera = new PerspectiveCamera(32, 1, 0.01, 100);
  scene.add(new AmbientLight('#fff4fb', 0.72));
  const key = new DirectionalLight('#fff7fb', 1.4);
  key.position.set(1.2, 2.4, 2.2);
  scene.add(key);
  const fill = new DirectionalLight('#7ee7ff', 0.35);
  fill.position.set(-2, 1, -1);
  scene.add(fill);

  const root = new Group();
  let radius = 1;
  const center = { x: 0, y: 0.8, z: 0 };
  for (const primitive of parseGlb(glb)) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(primitive.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(primitive.normals, 3));
    geometry.setAttribute('uv', new BufferAttribute(primitive.uvs, 2));
    geometry.setIndex(new BufferAttribute(primitive.indices, 1));
    const material = new MeshStandardMaterial({
      color: new Color(primitive.color[0], primitive.color[1], primitive.color[2]),
      roughness: 0.72,
      metalness: 0.02,
      side: DoubleSide,
    });
    if (primitive.png) {
      const image = decodePng(primitive.png);
      const texture = new DataTexture(image.rgba, image.width, image.height);
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestFilter;
      texture.colorSpace = SRGBColorSpace;
      texture.flipY = true;
      texture.needsUpdate = true;
      material.map = texture;
    }
    root.add(new Mesh(geometry, material));
  }
  scene.add(root);
  root.updateWorldMatrix(true, true);
  const box = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  root.traverse((child) => {
    const mesh = child as Mesh;
    const position = mesh.geometry?.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      box.min[0] = Math.min(box.min[0] ?? Infinity, x);
      box.min[1] = Math.min(box.min[1] ?? Infinity, y);
      box.min[2] = Math.min(box.min[2] ?? Infinity, z);
      box.max[0] = Math.max(box.max[0] ?? -Infinity, x);
      box.max[1] = Math.max(box.max[1] ?? -Infinity, y);
      box.max[2] = Math.max(box.max[2] ?? -Infinity, z);
    }
  });
  center.x = ((box.min[0] ?? 0) + (box.max[0] ?? 0)) / 2;
  center.y = ((box.min[1] ?? 0) + (box.max[1] ?? 0)) / 2;
  center.z = ((box.min[2] ?? 0) + (box.max[2] ?? 0)) / 2;
  radius =
    Math.hypot((box.max[0] ?? 1) - (box.min[0] ?? 0), (box.max[1] ?? 1) - (box.min[1] ?? 0), (box.max[2] ?? 1) - (box.min[2] ?? 0)) ||
    1;

  const rig: MeshRig = {
    resize(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    look(yaw, pitch, distance) {
      const clamped = Math.max(-1.1, Math.min(1.1, pitch));
      const reach = Math.max(0.8, distance) * radius * 0.72;
      const flat = Math.cos(clamped);
      camera.position.set(
        center.x + Math.sin(yaw) * flat * reach,
        center.y + Math.sin(clamped) * reach,
        center.z + Math.cos(yaw) * flat * reach,
      );
      camera.lookAt(center.x, center.y, center.z);
    },
    draw() {
      renderer.render(scene, camera);
    },
    shot(view) {
      rig.look(YAW[view], 0.15, 2.4);
      rig.draw();
      const gl = renderer.getContext();
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const raw = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      const rgba = new Uint8ClampedArray(width * height * 4);
      const row = width * 4;
      for (let y = 0; y < height; y += 1) {
        rgba.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
      }
      return encodePng(width, height, rgba);
    },
    dispose() {
      root.traverse((child) => {
        const mesh = child as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      renderer.dispose();
    },
  };
  rig.look(0.4, 0.2, 2.5);
  return rig;
}
