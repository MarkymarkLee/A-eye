import { describe, expect, it } from "vitest";
import { sanitizeJpeg } from "./jpeg";

const marker = (code: number, payload: string | Uint8Array) => {
  const data = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const length = data.length + 2;
  return new Uint8Array([0xff, code, length >> 8, length & 0xff, ...data]);
};

const bytes = (...parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

describe("sanitizeJpeg", () => {
  it("strips metadata while preserving image segments and scan bytes", () => {
    const soi = new Uint8Array([0xff, 0xd8]);
    const app0 = marker(0xe0, "JFIF\0");
    const app1 = marker(0xe1, "Exif\0\0GPS private metadata");
    const comment = marker(0xfe, "comment bytes");
    const dqt = marker(0xdb, new Uint8Array([0, 1, 2]));
    const sos = marker(0xda, new Uint8Array([1, 1, 0, 0, 63, 0]));
    const scan = new Uint8Array([0x11, 0xff, 0x00, 0x22, 0xff, 0xd9]);
    const input = bytes(soi, app0, app1, comment, dqt, sos, scan);

    const output = sanitizeJpeg(input)!;
    expect(output).not.toBeNull();
    expect(new TextDecoder().decode(output)).not.toMatch(/Exif|GPS|comment/);
    expect(Array.from(output)).toEqual(Array.from(bytes(soi, app0, dqt, sos, scan)));
  });

  it.each([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    new TextEncoder().encode("<html>not an image</html>"),
  ])("rejects non-JPEG data", (input) => {
    expect(sanitizeJpeg(input)).toBeNull();
  });

  it("rejects truncated segments and files without SOS", () => {
    expect(sanitizeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0x01]))).toBeNull();
    expect(sanitizeJpeg(bytes(new Uint8Array([0xff, 0xd8]), marker(0xe0, "JFIF")))).toBeNull();
  });
});
