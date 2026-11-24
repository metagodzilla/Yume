import { encodePng } from '@/src/lib/png';
import { aspectById, styleById } from '@/src/lib/presets';
import type { AspectId, Character, StyleId } from '@/src/lib/types';

type RGB = [number, number, number];

const INK: RGB = [28, 18, 36];
const WHITE: RGB = [255, 248, 252];

function hex(value: string): RGB {
  const h = value.replace('#', '');
  const full = h.length === 3 ? h.split('').map((part) => part + part).join('') : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function shade(color: RGB, t: number): RGB {
  return t >= 0 ? mix(color, [255, 255, 255], t) : mix(color, [0, 0, 0], -t);
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Surface {
  readonly width: number;
  readonly height: number;
  readonly px: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.px = new Uint8ClampedArray(width * height * 4);
  }

  private span(y: number, x0: number, x1: number, color: RGB, alpha: number) {
    if (y < 0 || y >= this.height || alpha <= 0) return;
    const left = Math.max(0, x0);
    const right = Math.min(this.width - 1, x1);
    if (right < left) return;
    const row = y * this.width * 4;
    const r = color[0];
    const g = color[1];
    const b = color[2];
    if (alpha >= 254) {
      for (let x = left; x <= right; x += 1) {
        const i = row + x * 4;
        this.px[i] = r;
        this.px[i + 1] = g;
        this.px[i + 2] = b;
        this.px[i + 3] = 255;
      }
      return;
    }
    const aa = alpha / 255;
    const inv = 1 - aa;
    for (let x = left; x <= right; x += 1) {
      const i = row + x * 4;
      this.px[i] = this.px[i] * inv + r * aa;
      this.px[i + 1] = this.px[i + 1] * inv + g * aa;
      this.px[i + 2] = this.px[i + 2] * inv + b * aa;
      this.px[i + 3] = 255;
    }
  }

  gradient(top: RGB, bottom: RGB) {
    const last = Math.max(1, this.height - 1);
    for (let y = 0; y < this.height; y += 1) {
      this.span(y, 0, this.width - 1, mix(top, bottom, y / last), 255);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: RGB, alpha = 255) {
    if (rx <= 0.4 || ry <= 0.4 || alpha <= 0) return;
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

  rect(x: number, y: number, w: number, h: number, color: RGB, alpha = 255) {
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(this.height - 1, Math.ceil(y + h));
    const x0 = Math.floor(x);
    const x1 = Math.ceil(x + w);
    for (let yy = y0; yy <= y1; yy += 1) this.span(yy, x0, x1, color, alpha);
  }

  polygon(points: Array<[number, number]>, color: RGB, alpha = 255) {
    if (points.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.height - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y += 1) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i += 1) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          const t = (y - y1) / (y2 - y1);
          xs.push(x1 + t * (x2 - x1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        this.span(y, Math.floor(xs[i]), Math.ceil(xs[i + 1]), color, alpha);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: RGB, width = 2, alpha = 255) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    const radius = Math.max(0.6, width / 2);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      this.ellipse(x0 + dx * t, y0 + dy * t, radius, radius, color, alpha);
    }
  }

  tint(color: RGB, amount: number) {
    const inv = 1 - amount;
    for (let i = 0; i < this.px.length; i += 4) {
      this.px[i] = this.px[i] * inv + color[0] * amount;
      this.px[i + 1] = this.px[i + 1] * inv + color[1] * amount;
      this.px[i + 2] = this.px[i + 2] * inv + color[2] * amount;
    }
  }

  vignette(strength: number) {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const max = Math.hypot(cx, cy);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const d = Math.hypot(x - cx, y - cy) / max;
        const f = Math.max(0, 1 - strength * d ** 1.7);
        const i = (y * this.width + x) * 4;
        this.px[i] *= f;
        this.px[i + 1] *= f;
        this.px[i + 2] *= f;
      }
    }
  }

  toInk() {
    for (let i = 0; i < this.px.length; i += 4) {
      const y = this.px[i] * 0.2126 + this.px[i + 1] * 0.7152 + this.px[i + 2] * 0.0722;
      const c = y > 188 ? 246 : y > 130 ? 214 : y > 78 ? 96 : 18;
      this.px[i] = c;
      this.px[i + 1] = c;
      this.px[i + 2] = c;
    }
  }
}

type Look = {
  hair: RGB;
  eye: RGB;
  eye2: RGB;
  outfit: RGB;
  skin: RGB;
  expression: string;
  pose: string;
  hairStyle: string;
  outfitId: string;
};

const HAIR_HEX: Record<string, string> = {
  black: '#241820',
  chestnut: '#6b3a22',
  blonde: '#e6c36a',
  silver: '#d5dbe8',
  pink: '#ff7eb6',
  blue: '#39498f',
  crimson: '#a3203a',
  white: '#f3efe6',
};

const EYE_HEX: Record<string, string> = {
  amber: '#e39b2b',
  blue: '#3aa0e0',
  crimson: '#d23a4e',
  emerald: '#2f9d6a',
  violet: '#7a4dd1',
  gold: '#e2b33a',
};

const OUTFIT_HEX: Record<string, string> = {
  blazer: '#2a3b6e',
  street: '#2c2830',
  coat: '#6d4a2e',
  armor: '#8d97a6',
  kimono: '#c23b56',
  idol: '#ff6fa5',
  hoodie: '#2f9e98',
  cape: '#3a2158',
};

const SKINS: RGB[] = [hex('#f6d3b4'), hex('#e7b48a'), hex('#c6865a'), hex('#8d5524'), hex('#f3c1a5')];

function pickHex(map: Record<string, string>, id: string, fallback: RGB): RGB {
  if (map[id]) return hex(map[id]);
  if (!id) return fallback;
  const n = hashSeed(id);
  return [40 + (n % 180), 40 + ((n >> 8) % 160), 50 + ((n >> 16) % 170)];
}

function resolveLook(character: Character | null, seed: number, styleId: StyleId): Look {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const hairIds = Object.keys(HAIR_HEX);
  const eyeIds = Object.keys(EYE_HEX);
  const outfitIds = Object.keys(OUTFIT_HEX);
  const hairId = character?.hairColor || hairIds[seed % hairIds.length];
  const eyeId = character?.eyeColor || eyeIds[(seed >> 3) % eyeIds.length];
  const outfitId = character?.outfit || outfitIds[(seed >> 5) % outfitIds.length];
  const eye = pickHex(EYE_HEX, eyeId, hex('#3aa0e0'));
  const eye2 = eyeId === 'mismatch' ? hex('#e39b2b') : eye;
  return {
    hair: pickHex(HAIR_HEX, hairId, hex('#241820')),
    eye,
    eye2,
    outfit: pickHex(OUTFIT_HEX, outfitId, hex('#3a2158')),
    skin: SKINS[(character ? hashSeed(character.id) : Math.floor(rng() * SKINS.length)) % SKINS.length],
    expression: character?.expression || 'smile',
    pose: character?.pose || 'standing',
    hairStyle: character?.hairStyle || 'long',
    outfitId,
  };
}

function settingOf(character: Character | null, styleId: StyleId): string {
  if (character?.setting) return character.setting;
  if (styleId === 'dark') return 'shrine';
  if (styleId === 'mecha') return 'rooftop';
  if (styleId === 'shonen') return 'rooftop';
  if (styleId === 'watercolor') return 'forest';
  if (styleId === 'manga') return 'classroom';
  return 'blossoms';
}

function paintSetting(s: Surface, setting: string, rng: () => number, sky: RGB) {
  const { width: w, height: h } = s;
  if (setting === 'rooftop' || setting === 'platform') {
    const blocks = setting === 'platform' ? 4 : 7;
    for (let i = 0; i < blocks; i += 1) {
      const bw = w * (0.1 + rng() * 0.06);
      const bh = h * (0.16 + rng() * 0.26);
      const x = (w / blocks) * i + 4;
      const y = h * 0.62 - bh;
      s.rect(x, y, bw, bh, shade(sky, -0.45));
      for (let wy = y + 8; wy < h * 0.6; wy += 14) {
        for (let wx = x + 6; wx < x + bw - 8; wx += 11) {
          if (rng() > 0.42) s.rect(wx, wy, 4, 6, rng() > 0.55 ? hex('#ffd36e') : hex('#7ee7ff'), 230);
        }
      }
    }
  }
  if (setting === 'forest' || setting === 'blossoms') {
    for (let i = 0; i < 5; i += 1) {
      const x = w * (0.08 + i * 0.21);
      s.rect(x - 4, h * 0.66, 8, h * 0.14, hex('#5a3a28'));
      s.ellipse(x, h * 0.6, w * 0.11, h * 0.13, hex('#1d6b45'));
      s.ellipse(x - 10, h * 0.55, w * 0.08, h * 0.1, hex('#2f8a58'));
    }
  }
  if (setting === 'shrine') {
    const vermilion = hex('#d4483a');
    const top = h * 0.07;
    s.rect(w * 0.16, top, w * 0.68, Math.max(6, h * 0.016), vermilion);
    s.rect(w * 0.2, top + h * 0.035, w * 0.6, Math.max(4, h * 0.01), shade(vermilion, 0.15));
    s.rect(w * 0.26, top + h * 0.03, Math.max(6, w * 0.02), h * 0.2, vermilion);
    s.rect(w * 0.72, top + h * 0.03, Math.max(6, w * 0.02), h * 0.2, vermilion);
  }
  if (setting === 'classroom') {
    s.rect(w * 0.12, h * 0.1, w * 0.76, h * 0.38, mix(sky, hex('#cfe9ff'), 0.45));
    s.rect(w * 0.48, h * 0.1, w * 0.018, h * 0.38, hex('#f7f1e4'));
    s.rect(w * 0.12, h * 0.28, w * 0.76, h * 0.016, hex('#f7f1e4'));
  }
  if (setting === 'bedroom') {
    s.rect(w * 0.58, h * 0.12, w * 0.28, h * 0.26, shade(sky, -0.35));
    s.ellipse(w * 0.72, h * 0.23, w * 0.045, w * 0.045, hex('#fff6d8'));
  }
  if (setting === 'stars' || setting === 'rooftop') {
    for (let i = 0; i < 36; i += 1) {
      s.ellipse(rng() * w, rng() * h * 0.55, 1.3, 1.3, WHITE, 180 + rng() * 70);
    }
  }
  const moonX = w * (0.72 + rng() * 0.12);
  const moonY = h * (0.14 + rng() * 0.05);
  if (setting !== 'classroom') {
    s.ellipse(moonX, moonY, w * 0.09, w * 0.09, setting === 'blossoms' ? hex('#fff0c9') : hex('#f7f4ff'), 230);
  }
}

function hairBack(s: Surface, cx: number, cy: number, sc: number, look: Look) {
  s.ellipse(cx, cy + 8 * sc, 118 * sc, 150 * sc, look.hair);
  if (look.hairStyle === 'bob') s.ellipse(cx, cy + 20 * sc, 126 * sc, 110 * sc, look.hair);
  if (look.hairStyle === 'spikes') {
    for (let i = -3; i <= 3; i += 1) {
      const tipX = cx + i * 28 * sc;
      s.polygon(
        [
          [tipX, cy - 150 * sc],
          [tipX - 16 * sc, cy - 40 * sc],
          [tipX + 16 * sc, cy - 40 * sc],
        ],
        look.hair,
      );
    }
  }
}

function hairSides(s: Surface, cx: number, cy: number, sc: number, look: Look, flip: boolean) {
  const hair = look.hair;
  const x = (value: number) => (flip ? cx - (value - cx) : value);
  const style = look.hairStyle;
  if (style === 'bob' || style === 'spikes') return;
  if (style === 'twintails') {
    s.ellipse(x(cx - 92 * sc), cy + 150 * sc, 36 * sc, 120 * sc, hair);
    s.ellipse(x(cx + 92 * sc), cy + 150 * sc, 36 * sc, 120 * sc, hair);
    s.ellipse(x(cx - 92 * sc), cy + 28 * sc, 16 * sc, 16 * sc, hex('#ff4d8d'));
    s.ellipse(x(cx + 92 * sc), cy + 28 * sc, 16 * sc, 16 * sc, hex('#ff4d8d'));
  } else if (style === 'ponytail') {
    s.ellipse(x(cx + 78 * sc), cy - 20 * sc, 34 * sc, 90 * sc, hair);
    s.ellipse(x(cx + 70 * sc), cy - 78 * sc, 14 * sc, 14 * sc, hex('#ffd36e'));
  } else if (style === 'braids') {
    for (let i = 0; i < 5; i += 1) {
      s.ellipse(x(cx - 78 * sc), cy + 70 * sc + i * 28 * sc, 16 * sc, 16 * sc, hair);
      s.ellipse(x(cx + 70 * sc), cy + 40 * sc + i * 22 * sc, 12 * sc, 12 * sc, shade(hair, 0.08));
    }
  } else if (style === 'wolf') {
    s.ellipse(x(cx - 80 * sc), cy + 90 * sc, 30 * sc, 70 * sc, hair);
    s.ellipse(x(cx + 86 * sc), cy + 150 * sc, 28 * sc, 120 * sc, hair);
  } else if (style === 'hime') {
    s.ellipse(x(cx - 78 * sc), cy + 150 * sc, 22 * sc, 140 * sc, hair);
    s.ellipse(x(cx + 78 * sc), cy + 150 * sc, 22 * sc, 140 * sc, hair);
  } else {
    s.ellipse(x(cx - 74 * sc), cy + 160 * sc, 34 * sc, 140 * sc, hair);
    s.ellipse(x(cx + 74 * sc), cy + 160 * sc, 34 * sc, 140 * sc, hair);
  }
}

function drawEye(
  s: Surface,
  x: number,
  y: number,
  sc: number,
  iris: RGB,
  expression: string,
  look: number,
) {
  if (expression === 'sleepy') {
    s.line(x - 16 * sc, y, x + 16 * sc, y + 3 * sc, INK, Math.max(2, 3 * sc));
    return;
  }
  if (expression === 'angry') {
    s.ellipse(x, y, 18 * sc, 14 * sc, WHITE);
    s.ellipse(x + look, y + 2 * sc, 9 * sc, 9 * sc, iris);
    s.ellipse(x + look, y + 3 * sc, 4.5 * sc, 4.5 * sc, INK);
    s.line(x - 20 * sc, y - 16 * sc, x + 14 * sc, y - 6 * sc, INK, Math.max(2, 3 * sc));
    return;
  }
  if (expression === 'sad') {
    s.ellipse(x, y + 2 * sc, 16 * sc, 16 * sc, WHITE);
    s.ellipse(x + look, y + 4 * sc, 8 * sc, 8 * sc, iris);
    s.ellipse(x + look, y + 5 * sc, 4 * sc, 4 * sc, INK);
    s.line(x - 16 * sc, y - 6 * sc, x + 14 * sc, y - 16 * sc, INK, Math.max(2, 2.4 * sc));
    return;
  }
  const es = expression === 'surprised' ? 1.16 : expression === 'fierce' ? 0.86 : expression === 'shy' ? 0.92 : 1;
  const py = expression === 'shy' ? 4 * sc : 1 * sc;
  s.ellipse(x, y, 18 * sc * es, 22 * sc * es, WHITE);
  s.ellipse(x + look, y + py, 11 * sc * es, 13 * sc * es, iris);
  s.ellipse(x + look, y + py + 2 * sc, 5.5 * sc * es, 7 * sc * es, INK);
  s.ellipse(x + look - 5 * sc, y + py - 6 * sc, 3.4 * sc, 3.4 * sc, WHITE);
  s.ellipse(x + look + 4 * sc, y + py + 4 * sc, 1.7 * sc, 1.7 * sc, WHITE);
  s.line(x - 18 * sc * es, y - 4 * sc, x + 16 * sc * es, y - 12 * sc, INK, Math.max(2, 2.6 * sc));
}

function drawMouth(s: Surface, cx: number, cy: number, sc: number, expression: string) {
  if (expression === 'surprised') {
    s.ellipse(cx, cy, 8 * sc, 10 * sc, hex('#c45b6a'));
    return;
  }
  if (expression === 'angry' || expression === 'sad') {
    for (let i = 0; i <= 16; i += 1) {
      const t = i / 16;
      const x = cx - 12 * sc + 24 * sc * t;
      const y = cy - Math.sin(t * Math.PI) * (expression === 'sad' ? 7 : 4) * sc;
      s.ellipse(x, y, 1.7 * sc, 1.7 * sc, hex('#c45b6a'));
    }
    return;
  }
  if (expression === 'determined' || expression === 'fierce') {
    s.line(cx - 10 * sc, cy, cx + 12 * sc, cy + (expression === 'fierce' ? 2 : 0) * sc, hex('#a34b58'), Math.max(2, 2.4 * sc));
    return;
  }
  const up = expression === 'shy' ? 0.45 : 1;
  for (let i = 0; i <= 16; i += 1) {
    const t = i / 16;
    const x = cx - 12 * sc + 24 * sc * t;
    const y = cy + Math.sin(t * Math.PI) * 5 * sc * up;
    s.ellipse(x, y, 1.7 * sc, 1.7 * sc, hex('#c45b6a'));
  }
}

function drawCharacter(
  s: Surface,
  look: Look,
  styleId: StyleId,
  aspectId: AspectId,
  flip: boolean,
  angle?: 'front' | 'three-quarter' | 'side' | 'three-quarter-back' | 'back' | 'face',
) {
  const { width: w, height: h } = s;
  const chibi = styleId === 'chibi';
  let scale = Math.min(w, h) / (aspectId === 'avatar' ? 430 : 520);
  let cx = aspectId === 'landscape' ? w * 0.34 : w * 0.5;
  let cy = aspectId === 'avatar' ? h * 0.5 : h * 0.4;
  if (look.pose === 'portrait' || aspectId === 'avatar') {
    scale *= 1.22;
    cy = h * 0.5;
  }
  if (look.pose === 'leap') cy -= h * 0.05;
  if (look.pose === 'sitting') cy += h * 0.045;
  if (look.pose === 'running') cx += w * 0.05;
  if (angle === 'three-quarter') cx += w * 0.06;
  if (angle === 'side') cx += w * 0.14;
  if (angle === 'three-quarter-back') cx -= w * 0.05;
  if (angle === 'face') {
    scale *= 1.85;
    cy = h * 0.62;
  }
  if (chibi) scale *= 1.05;
  const sc = scale;
  const head = chibi ? 1.28 : 1;
  const body = chibi ? 0.62 : 1;
  const outfit = look.outfit;

  if (look.outfitId === 'cape' || styleId === 'dark') {
    s.ellipse(cx, cy + 210 * sc, 150 * sc, 170 * sc * body, shade(outfit, -0.35));
  }
  hairBack(s, cx, cy, sc * head, look);

  s.ellipse(cx, cy + 118 * sc, 26 * sc, 34 * sc, shade(look.skin, -0.08));
  const bodyRy = 130 * sc * body * (look.outfitId === 'kimono' || look.outfitId === 'coat' ? 1.15 : 1);
  s.ellipse(cx, cy + 230 * sc, 108 * sc, bodyRy, outfit);
  if (look.outfitId === 'blazer') s.ellipse(cx, cy + 150 * sc, 28 * sc, 22 * sc, WHITE);
  if (look.outfitId === 'kimono') s.ellipse(cx, cy + 210 * sc, 70 * sc, 18 * sc, hex('#f2d48a'));
  if (look.outfitId === 'hoodie') s.ellipse(cx, cy + 20 * sc, 100 * sc * head, 78 * sc, shade(outfit, -0.12));
  if (look.outfitId === 'armor' || styleId === 'mecha') {
    s.rect(cx - 120 * sc, cy + 150 * sc, 54 * sc, 36 * sc, shade(outfit, 0.2));
    s.rect(cx + 66 * sc, cy + 150 * sc, 54 * sc, 36 * sc, shade(outfit, 0.2));
    s.polygon(
      [
        [cx - 46 * sc, cy + 170 * sc],
        [cx + 46 * sc, cy + 170 * sc],
        [cx + 30 * sc, cy + 250 * sc],
        [cx - 30 * sc, cy + 250 * sc],
      ],
      shade(outfit, 0.28),
    );
  }

  const backView = angle === 'back' || angle === 'three-quarter-back';
  if (backView) {
    s.ellipse(cx, cy, 96 * sc * head, 112 * sc * head, look.hair);
    hairSides(s, cx, cy, sc * head, look, flip);
    return;
  }
  if (angle !== 'side') s.ellipse(cx - 90 * sc * head, cy + 6 * sc, 16 * sc, 22 * sc, look.skin);
  s.ellipse(cx + 90 * sc * head, cy + 6 * sc, 16 * sc, 22 * sc, look.skin);
  s.ellipse(cx, cy, 92 * sc * head, 104 * sc * head, look.skin);
  s.ellipse(cx, cy - 55 * sc * head, 96 * sc * head, 54 * sc, look.hair);

  const blush = look.expression === 'shy' || styleId === 'shojo' ? 130 : 80;
  s.ellipse(cx - 48 * sc, cy + 30 * sc, 18 * sc, 10 * sc, hex('#ff8aa8'), blush);
  s.ellipse(cx + 48 * sc, cy + 30 * sc, 18 * sc, 10 * sc, hex('#ff8aa8'), blush);

  const eyeScale = sc * (chibi ? 1.2 : 1);
  const lookX = look.pose === 'glance' ? (flip ? -4 : 4) * sc : 0;
  if (angle !== 'side') drawEye(s, cx - 34 * sc, cy - 2 * sc, eyeScale, look.eye, look.expression, lookX);
  drawEye(s, cx + (angle === 'side' ? 8 : 34) * sc, cy - 2 * sc, eyeScale, look.eye2, look.expression, lookX);

  const brow = look.expression === 'determined' || look.expression === 'fierce' ? -26 : -30;
  const tilt = look.expression === 'fierce' ? 7 : look.expression === 'surprised' ? -4 : 2;
  s.line(cx - 52 * sc, cy + brow * sc, cx - 18 * sc, cy + (brow - tilt) * sc, shade(look.hair, -0.2), 3 * sc);
  s.line(cx + 18 * sc, cy + (brow - tilt) * sc, cx + 52 * sc, cy + brow * sc, shade(look.hair, -0.2), 3 * sc);
  s.ellipse(cx, cy + 22 * sc, 3 * sc, 2 * sc, shade(look.skin, -0.25), 180);
  drawMouth(s, cx, cy + 48 * sc, sc, look.expression);

  if (styleId === 'mecha') {
    s.ellipse(cx, cy - 4 * sc, 78 * sc, 16 * sc, hex('#67e8f9'), 170);
    s.line(cx, cy - 120 * sc * head, cx + 20 * sc, cy - 168 * sc, shade(outfit, 0.4), 3 * sc);
  }
  hairSides(s, cx, cy, sc * head, look, flip);
}

function sparkle(s: Surface, x: number, y: number, r: number, color: RGB) {
  s.polygon(
    [
      [x, y - r],
      [x + r * 0.16, y],
      [x, y + r],
      [x - r * 0.16, y],
    ],
    color,
  );
  s.polygon(
    [
      [x - r, y],
      [x, y - r * 0.16],
      [x + r, y],
      [x, y + r * 0.16],
    ],
    color,
  );
}

const SKY: Record<StyleId, [string, string]> = {
  cel90s: ['#3a1d6e', '#ff8fb8'],
  modern: ['#241447', '#ff6ea8'],
  shonen: ['#2a1020', '#ff4d5a'],
  shojo: ['#6a4a86', '#ffd0ea'],
  chibi: ['#31448f', '#ffb0d0'],
  watercolor: ['#8ec8e0', '#f6d7bf'],
  dark: ['#140816', '#5a2344'],
  mecha: ['#071018', '#1d4d63'],
  manga: ['#f7f7f8', '#d5d5dc'],
  novel: ['#2a1244', '#ff5c98'],
};

export function renderAnimeFrame(input: {
  seed: number;
  variant: number;
  styleId: StyleId;
  aspectId: AspectId;
  character: Character | null;
  angle?: 'front' | 'three-quarter' | 'side' | 'three-quarter-back' | 'back' | 'face';
}): Uint8Array {
  const aspect = aspectById(input.aspectId);
  const s = new Surface(aspect.mock.width, aspect.mock.height);
  const rng = mulberry32(input.seed || 1);
  const sky = SKY[input.styleId];
  const top = mix(hex(sky[0]), hex(sky[1]), (input.variant % 4) * 0.14);
  s.gradient(top, mix(hex(sky[1]), hex(sky[0]), input.variant % 2 === 0 ? 0 : 0.35));
  const setting = settingOf(input.character, input.styleId);
  paintSetting(s, setting, rng, top);

  if (input.styleId === 'shonen' || input.character?.pose === 'running' || input.character?.pose === 'leap') {
    const ox = s.width * 0.5;
    const oy = s.height * 0.42;
    for (let i = 0; i < 18; i += 1) {
      const ang = rng() * Math.PI * 2;
      s.line(
        ox + Math.cos(ang) * 70,
        oy + Math.sin(ang) * 70,
        ox + Math.cos(ang) * s.width,
        oy + Math.sin(ang) * s.height,
        WHITE,
        1.4,
        70,
      );
    }
  }

  s.ellipse(s.width / 2, s.height * 0.9, s.width * 0.72, s.height * 0.08, shade(hex(sky[1]), -0.35), 180);

  const look = resolveLook(input.character, input.seed, input.styleId);
  const flip = look.pose === 'glance' || input.variant % 2 === 1 || input.angle === 'three-quarter' || input.angle === 'side';
  drawCharacter(s, look, input.styleId, input.aspectId, flip, input.angle);
  const propX = input.variant % 2 === 0 ? s.width * 0.18 : s.width * 0.82;
  if (input.variant % 2 === 0) {
    s.ellipse(propX, s.height * 0.36, s.width * 0.045, s.width * 0.06, hex('#ffd36e'));
    s.line(propX, s.height * 0.42, propX, s.height * 0.58, hex('#6b3a22'), 3);
  } else {
    s.ellipse(propX, s.height * 0.34, s.width * 0.11, s.width * 0.035, hex('#ff6fa5'));
    s.line(propX, s.height * 0.36, propX, s.height * 0.58, hex('#6b3a22'), 3);
  }

  const petal = input.styleId === 'watercolor' ? hex('#f4b7c8') : hex('#ffd0e6');
  if (input.styleId === 'watercolor' || input.styleId === 'shojo' || input.styleId === 'cel90s' || setting === 'blossoms') {
    for (let i = 0; i < 16; i += 1) {
      s.ellipse(rng() * s.width, rng() * s.height, 3 + rng() * 5, 2 + rng() * 2, petal, 170);
    }
  }
  if (input.styleId === 'shojo' || input.styleId === 'novel' || input.styleId === 'chibi') {
    for (let i = 0; i < 7; i += 1) {
      sparkle(s, rng() * s.width, rng() * s.height * 0.8, 7 + rng() * 8, WHITE);
    }
  }

  const lighting = input.character?.lighting;
  if (lighting === 'golden' || input.styleId === 'watercolor') s.tint(hex('#ffb15e'), 0.12);
  if (lighting === 'moon' || input.styleId === 'dark') s.tint(hex('#9eb6ff'), 0.16);
  if (lighting === 'candle') s.tint(hex('#ffb15e'), 0.18);
  if (lighting === 'neon' || input.styleId === 'mecha' || input.styleId === 'modern') {
    s.ellipse(s.width * 0.15, s.height * 0.3, s.width * 0.2, s.width * 0.2, hex('#ff4d9a'), 40);
    s.ellipse(s.width * 0.85, s.height * 0.25, s.width * 0.18, s.width * 0.18, hex('#67e8f9'), 40);
  }
  if (lighting === 'overcast') s.tint(hex('#d7d3de'), 0.12);
  s.vignette(input.styleId === 'manga' ? 0.08 : 0.28);

  if (input.styleId === 'manga' || input.aspectId === 'manga') {
    if (input.styleId === 'manga') s.toInk();
    const inset = Math.round(Math.min(s.width, s.height) * 0.035);
    s.rect(inset, inset, s.width - inset * 2, 4, INK);
    s.rect(inset, s.height - inset - 4, s.width - inset * 2, 4, INK);
    s.rect(inset, inset, 4, s.height - inset * 2, INK);
    s.rect(s.width - inset - 4, inset, 4, s.height - inset * 2, INK);
  }

  return encodePng(s.width, s.height, s.px);
}

export function renderDemoFrames(input: {
  prompt: string;
  styleId: StyleId;
  aspectId: AspectId;
  character: Character | null;
  count: number;
  seed?: number;
  variant?: number;
  angle?: 'front' | 'three-quarter' | 'side' | 'three-quarter-back' | 'back' | 'face';
}): Uint8Array[] {
  const hashed = hashSeed(`${input.prompt}|${input.styleId}|${input.aspectId}|${input.character?.id ?? ''}`);
  const base = input.seed != null ? input.seed >>> 0 : hashed;
  const frames: Uint8Array[] = [];
  for (let index = 0; index < input.count; index += 1) {
    frames.push(
      renderAnimeFrame({
        seed: (base + index * 9973) >>> 0,
        variant: input.variant ?? index,
        styleId: styleById(input.styleId).id,
        aspectId: aspectById(input.aspectId).id,
        character: input.character,
        angle: input.angle,
      }),
    );
  }
  return frames;
}
