export type FramePreset = '2k' | '4k';

export function snap8(value: number): number {
  return Math.max(8, Math.round(value / 8) * 8);
}

export function planTarget(width: number, height: number, preset: FramePreset): { width: number; height: number; passes: number; longEdge: number } {
  const longEdge = preset === '2k' ? 2048 : 3840;
  const srcW = Math.max(1, Math.round(width));
  const srcH = Math.max(1, Math.round(height));
  let outW: number;
  let outH: number;
  if (srcW >= srcH) {
    outW = longEdge;
    outH = snap8(Math.round((srcH * longEdge) / srcW));
  } else {
    outH = longEdge;
    outW = snap8(Math.round((srcW * longEdge) / srcH));
  }
  let dstLong = Math.max(outW, outH);
  if (preset === '4k' && dstLong > 4096) {
    const scale = 4096 / dstLong;
    outW = snap8(Math.round(outW * scale));
    outH = snap8(Math.round(outH * scale));
    dstLong = Math.max(outW, outH);
  }
  const srcLong = Math.max(srcW, srcH);
  let passes = 0;
  let grown = srcLong;
  while (grown < dstLong && passes < 3) {
    grown *= 4;
    passes += 1;
  }
  return { width: outW, height: outH, passes, longEdge: dstLong };
}

export function detailDenoise(detail: number): number {
  const amount = Math.max(0, Math.min(1, detail));
  return Math.round((0.2 + amount * 0.25) * 1000) / 1000;
}

export function repairDenoise(strength: number): number {
  const amount = Math.max(0, Math.min(1, strength));
  return Math.round((0.3 + amount * 0.35) * 1000) / 1000;
}

export function redrawDenoise(strength: number): number {
  const amount = Math.max(0, Math.min(1, strength));
  return Math.round((0.4 + amount * 0.35) * 1000) / 1000;
}

export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function characterSheetTags(character: { hairColor?: string; eyeColor?: string; outfit?: string; clothesPrompt?: string } | null): string {
  if (!character) return '';
  const tags = [
    character.hairColor ? `${character.hairColor} hair` : '',
    character.eyeColor ? `${character.eyeColor} eyes` : '',
    character.outfit || '',
    character.clothesPrompt || '',
  ].filter(Boolean);
  return tags.join(', ');
}

export function loraForCharacter<T extends { name: string; filename: string; type: string }>(name: string, installed: T[]): T | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return installed.find((item) => /lora|locon/i.test(item.type) && (item.name.toLowerCase().includes(key) || item.filename.toLowerCase().includes(key))) ?? null;
}
