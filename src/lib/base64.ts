const TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += TABLE[(triple >> 18) & 63];
    out += TABLE[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? TABLE[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? TABLE[triple & 63] : '=';
  }
  return out;
}

export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/[^A-Za-z0-9+/=]/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length * 3) / 4 - pad);
  const lookup = new Uint8Array(128);
  for (let i = 0; i < TABLE.length; i += 1) lookup[TABLE.charCodeAt(i)] = i;
  let offset = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)] ?? 0;
    const b = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const c = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const d = lookup[clean.charCodeAt(i + 3)] ?? 0;
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (offset < out.length) out[offset] = (triple >> 16) & 255;
    if (offset + 1 < out.length) out[offset + 1] = (triple >> 8) & 255;
    if (offset + 2 < out.length) out[offset + 2] = triple & 255;
    offset += 3;
  }
  return out;
}
