import { unzlibSync } from 'fflate';

import { encodePng } from '@/src/lib/png';

export type DecodedPng = { width: number; height: number; rgba: Uint8ClampedArray };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) {
    throw new Error('Not a PNG');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = view.getUint32(0);
      height = view.getUint32(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const bpp = colorType === 2 ? 3 : 4;
  const compressed = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of idat) {
    compressed.set(part, cursor);
    cursor += part.length;
  }
  const raw = unzlibSync(compressed);
  const stride = width * bpp;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const recon = new Uint8Array(stride * height);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source];
    source += 1;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source];
      source += 1;
      const left = x >= bpp ? recon[y * stride + x - bpp] : 0;
      const up = y > 0 ? recon[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= bpp ? recon[(y - 1) * stride + x - bpp] : 0;
      let out = value;
      if (filter === 1) out = (value + left) & 255;
      else if (filter === 2) out = (value + up) & 255;
      else if (filter === 3) out = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) out = (value + paeth(left, up, upperLeft)) & 255;
      recon[y * stride + x] = out;
    }
    for (let x = 0; x < width; x += 1) {
      const p = y * stride + x * bpp;
      const i = (y * width + x) * 4;
      rgba[i] = recon[p];
      rgba[i + 1] = recon[p + 1];
      rgba[i + 2] = recon[p + 2];
      rgba[i + 3] = bpp === 4 ? recon[p + 3] : 255;
    }
  }
  return { width, height, rgba };
}

const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01110'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
  H: ['10001', '10001', '11111', '10001', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '11100', '10010', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['10001', '10001', '10001', '11111', '00001', '00001', '00001'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function stamp(rgba: Uint8ClampedArray, width: number, text: string, x: number, y: number) {
  let cursor = x;
  for (const char of text.toUpperCase()) {
    const glyph = GLYPHS[char] ?? GLYPHS[' '];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (glyph[row][col] !== '1') continue;
        const px = cursor + col;
        const py = y + row;
        if (px < 0 || py < 0 || px >= width) continue;
        const i = (py * width + px) * 4;
        rgba[i] = 255;
        rgba[i + 1] = 247;
        rgba[i + 2] = 251;
        rgba[i + 3] = 255;
      }
    }
    cursor += 6;
  }
}

function sample(image: DecodedPng, x: number, y: number): [number, number, number, number] {
  const sx = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const sy = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const i = (sy * image.width + sx) * 4;
  return [image.rgba[i], image.rgba[i + 1], image.rgba[i + 2], image.rgba[i + 3]];
}

export function composeSheet(frames: { label: string; png: Uint8Array }[], cellWidth = 180, cellHeight = 240): Uint8Array {
  const labelHeight = 16;
  const gap = 8;
  const width = frames.length * cellWidth + (frames.length + 1) * gap;
  const height = cellHeight + labelHeight + gap * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 16;
    rgba[i + 1] = 8;
    rgba[i + 2] = 20;
    rgba[i + 3] = 255;
  }
  frames.forEach((frame, index) => {
    const image = decodePng(frame.png);
    const originX = gap + index * (cellWidth + gap);
    const originY = gap;
    for (let y = 0; y < cellHeight; y += 1) {
      for (let x = 0; x < cellWidth; x += 1) {
        const [r, g, b, a] = sample(image, (x / cellWidth) * image.width, (y / cellHeight) * image.height);
        const i = ((originY + y) * width + originX + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = a;
      }
    }
    stamp(rgba, width, frame.label, originX, originY + cellHeight + 4);
  });
  return encodePng(width, height, rgba);
}
