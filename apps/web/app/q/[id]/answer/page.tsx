import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getResults } from "@/lib/store";
import { requestOrigin } from "@/lib/request-origin";
import { AnswerFlow } from "@/components/answer-flow";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const r = await getResults((await params).id, await requestOrigin());
  return { title: r ? r.prompt : "Question" };
}

export default async function AnswerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getResults(id, await requestOrigin());
  if (!r) notFound();
  if (r.status !== "open") redirect(`/q/${id}`);
  const { tally: _t, evidence: _e, raffle: _r, ...question } = r;
  return <AnswerFlow question={question} />;
}
