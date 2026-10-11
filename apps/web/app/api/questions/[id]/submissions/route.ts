import { NextResponse } from "next/server";
import { checkPresence } from "@/lib/geo";
import { currentObserver } from "@/lib/observer";
import { parseSubmissionFields } from "@/lib/submission-form";
import { addSubmission, getQuestionRow } from "@/lib/store";
import { isCrossSiteRequest } from "@/lib/same-origin";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { sanitizeJpeg } from "@/lib/jpeg";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  const { id } = await params;
  const question = getQuestionRow(id);
  if (!question) return NextResponse.json({ error: "Question not found." }, { status: 404 });

  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Photo is too large." }, { status: 413 });
  }
  const limit = rateLimit(`submissions:${clientIp(req)}`, 60, 10 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterS);
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  const fields = parseSubmissionFields(form);
  if (!fields.success) return NextResponse.json({ error: "Missing location, time or answer." }, { status: 400 });

  const image = form.get("image");
  if (!(image instanceof Blob) || image.type !== "image/jpeg") {
    return NextResponse.json({ error: "A photo from the in-app camera is required." }, { status: 422 });
  }
  if (image.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Photo is too large." }, { status: 413 });
  const clean = sanitizeJpeg(new Uint8Array(await image.arrayBuffer()));
  if (!clean) return NextResponse.json({ error: "That photo isn't a valid JPEG. Use the in-app camera." }, { status: 422 });

  const presence = checkPresence({ question, ...fields.data });
  if (!presence.ok) {
    return NextResponse.json({ error: presence.reason, distance_m: presence.distance_m }, { status: 422 });
  }

  const observer = await currentObserver();
  const result = await addSubmission({
    question_id: id,
    observer_id: observer.id,
    ...fields.data,
    distance_m: presence.distance_m,
    image: { bytes: clean, type: image.type },
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}
