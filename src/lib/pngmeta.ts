function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c ^= data[i] ?? 0;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out[i] = code < 256 ? code : 63;
  }
  return out;
}

/** A1111 writes the generation text as a PNG tEXt chunk named parameters. */
export function embedParameters(png: Uint8Array, parameters: string): Uint8Array {
  const keyword = 'parameters';
  const body = new Uint8Array(keyword.length + 1 + parameters.length);
  body.set(latin1(keyword), 0);
  body.set(latin1(parameters), keyword.length + 1);
  const text = chunk('tEXt', body);
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(png[offset + 4] ?? 0, png[offset + 5] ?? 0, png[offset + 6] ?? 0, png[offset + 7] ?? 0);
    if (type === 'IEND') {
      const out = new Uint8Array(png.length + text.length);
      out.set(png.subarray(0, offset), 0);
      out.set(text, offset);
      out.set(png.subarray(offset), offset + text.length);
      return out;
    }
    offset += 12 + length;
  }
  return png;
}

export function readParameters(png: Uint8Array): string | null {
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(png[offset + 4] ?? 0, png[offset + 5] ?? 0, png[offset + 6] ?? 0, png[offset + 7] ?? 0);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'tEXt' || type === 'iTXt') {
      const split = data.indexOf(0);
      const key = new TextDecoder().decode(data.subarray(0, split));
      if (key === 'parameters') {
        const start = type === 'iTXt' ? split + 5 : split + 1;
        return new TextDecoder().decode(data.subarray(start));
      }
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return null;
}
