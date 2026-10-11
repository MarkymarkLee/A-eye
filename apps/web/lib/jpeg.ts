const DROP_MARKERS = new Set([0xe1, 0xfe, 0xef]);

function shouldDrop(marker: number): boolean {
  return DROP_MARKERS.has(marker) || (marker >= 0xe3 && marker <= 0xed);
}

export function sanitizeJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const segments: Uint8Array[] = [bytes.slice(0, 2)];
  let keptBytes = 2;
  let offset = 2;

  while (offset < bytes.length) {
    const segmentStart = offset;
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset]!;
    offset += 1;

    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      const segment = bytes.slice(segmentStart, offset);
      segments.push(segment);
      keptBytes += segment.length;
      continue;
    }

    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return null;
    const segmentEnd = offset + length;

    if (marker === 0xda) {
      const rest = bytes.slice(segmentStart);
      segments.push(rest);
      keptBytes += rest.length;
      const output = new Uint8Array(keptBytes);
      let outputOffset = 0;
      for (const segment of segments) {
        output.set(segment, outputOffset);
        outputOffset += segment.length;
      }
      return output;
    }

    if (!shouldDrop(marker)) {
      const segment = bytes.slice(segmentStart, segmentEnd);
      segments.push(segment);
      keptBytes += segment.length;
    }
    offset = segmentEnd;
  }

  return null;
}
