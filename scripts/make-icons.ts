import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { encodePng } from '../src/lib/png';

type RGB = [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

class Surface {
  readonly px: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.px = new Uint8ClampedArray(width * height * 4);
  }

  private span(y: number, x0: number, x1: number, color: RGB, alpha: number) {
    if (y < 0 || y >= this.height || alpha <= 0) return;
    const left = Math.max(0, x0);
    const right = Math.min(this.width - 1, x1);
    if (right < left) return;
    const row = y * this.width * 4;
    const aa = alpha / 255;
    const inv = 1 - aa;
    for (let x = left; x <= right; x += 1) {
      const i = row + x * 4;
      if (alpha >= 254) {
        this.px[i] = color[0];
        this.px[i + 1] = color[1];
        this.px[i + 2] = color[2];
        this.px[i + 3] = 255;
      } else {
        const base = this.px[i + 3] / 255;
        const outA = aa + base * (1 - aa);
        if (outA <= 0) continue;
        this.px[i] = (color[0] * aa + this.px[i] * base * inv) / outA;
        this.px[i + 1] = (color[1] * aa + this.px[i + 1] * base * inv) / outA;
        this.px[i + 2] = (color[2] * aa + this.px[i + 2] * base * inv) / outA;
        this.px[i + 3] = outA * 255;
      }
    }
  }

  fill(color: RGB) {
    for (let y = 0; y < this.height; y += 1) this.span(y, 0, this.width - 1, color, 255);
  }

  gradient(top: RGB, bottom: RGB) {
    for (let y = 0; y < this.height; y += 1) {
      this.span(y, 0, this.width - 1, mix(top, bottom, y / (this.height - 1)), 255);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: RGB, alpha = 255) {
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y += 1) {
      const ny = (y + 0.5 - cy) / ry;
      const remain = 1 - ny * ny;
      if (remain <= 0) continue;
      const span = rx * Math.sqrt(remain);
      this.span(y, Math.floor(cx - span), Math.ceil(cx + span), color, alpha);
    }
  }
}

function paint(size: number, mode: 'app' | 'foreground' | 'mono' | 'background') {
  const s = new Surface(size, size);
  const ink: RGB = [16, 8, 20];
  const sakura: RGB = [255, 142, 199];
  const hair: RGB = [255, 92, 168];
  const skin: RGB = [255, 214, 196];
  if (mode === 'app' || mode === 'background') s.gradient([42, 16, 64], [255, 120, 176]);
  if (mode === 'background') return encodePng(size, size, s.px);
  const color = mode === 'mono' ? ([255, 255, 255] as RGB) : hair;
  const face = mode === 'mono' ? ([255, 255, 255] as RGB) : skin;
  const cx = size / 2;
  const cy = size * 0.54;
  const sc = size / 1024;
  if (mode !== 'mono') {
    s.ellipse(cx, cy + 40 * sc, 280 * sc, 320 * sc, color);
    s.ellipse(cx - 190 * sc, cy + 260 * sc, 90 * sc, 220 * sc, color);
    s.ellipse(cx + 190 * sc, cy + 260 * sc, 90 * sc, 220 * sc, color);
    s.ellipse(cx, cy, 210 * sc, 230 * sc, face);
    s.ellipse(cx, cy - 120 * sc, 220 * sc, 120 * sc, color);
    s.ellipse(cx - 70 * sc, cy - 10 * sc, 36 * sc, 44 * sc, ink);
    s.ellipse(cx + 70 * sc, cy - 10 * sc, 36 * sc, 44 * sc, ink);
    s.ellipse(cx - 82 * sc, cy - 24 * sc, 12 * sc, 12 * sc, [255, 255, 255]);
    s.ellipse(cx + 58 * sc, cy - 24 * sc, 12 * sc, 12 * sc, [255, 255, 255]);
  } else {
    s.ellipse(cx, cy, 220 * sc, 240 * sc, color);
    for (let i = 0; i < 5; i += 1) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      s.ellipse(cx + Math.cos(angle) * 180 * sc, cy + Math.sin(angle) * 180 * sc, 110 * sc, 150 * sc, color);
    }
    s.ellipse(cx, cy, 70 * sc, 70 * sc, ink, 0);
  }
  if (mode === 'app') {
    s.ellipse(size * 0.78, size * 0.22, 70 * sc, 70 * sc, sakura);
  }
  return encodePng(size, size, s.px);
}

const root = join(process.cwd(), 'assets', 'images');
writeFileSync(join(root, 'icon.png'), paint(1024, 'app'));
writeFileSync(join(root, 'splash-icon.png'), paint(1024, 'foreground'));
writeFileSync(join(root, 'android-icon-foreground.png'), paint(1024, 'foreground'));
writeFileSync(join(root, 'android-icon-background.png'), paint(1024, 'background'));
writeFileSync(join(root, 'android-icon-monochrome.png'), paint(1024, 'mono'));
writeFileSync(join(root, 'favicon.png'), paint(48, 'app'));
console.log('icons written');
