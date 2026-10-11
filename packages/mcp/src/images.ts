export async function downscaleImage(
  bytes: Uint8Array,
  maxPx = 512,
): Promise<{ data: Buffer; mimeType: string } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const data = await sharp(bytes)
      .rotate()
      .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    return { data, mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}
