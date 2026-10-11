import { readLocalImage } from "@/lib/storage";

/** Serves photos in local storage mode. In S3 mode, results link to presigned URLs instead. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const bytes = await readLocalImage(key.join("/"));
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" },
  });
}
