import { NextResponse } from "next/server";
import { SubmissionFields } from "@a-eye/shared";
import { checkPresence } from "@/lib/geo";
import { currentObserver } from "@/lib/observer";
import { addSubmission, getQuestionRow } from "@/lib/store";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const question = getQuestionRow(id);
  if (!question) return NextResponse.json({ error: "Question not found." }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  const fields = SubmissionFields.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!fields.success) return NextResponse.json({ error: "Missing location, time or answer." }, { status: 400 });

  const image = form.get("image");
  if (!(image instanceof Blob) || image.type !== "image/jpeg") {
    return NextResponse.json({ error: "A photo from the in-app camera is required." }, { status: 422 });
  }
  if (image.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Photo is too large." }, { status: 413 });

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
    image: { bytes: new Uint8Array(await image.arrayBuffer()), type: image.type },
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}
