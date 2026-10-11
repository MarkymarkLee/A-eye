import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getResults, sealResults } from "@/lib/store";
import { Page } from "@/components/motion/page";
import { requestOrigin } from "@/lib/request-origin";
import { LiveResults } from "@/components/live-results";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const results = await getResults((await params).id, await requestOrigin());
  if (!results) return { title: "Results" };
  const r = sealResults(results);
  const lead = [...r.tally].sort((a, b) => b.count - a.count)[0];
  return {
    title: r.prompt,
    description: r.responses ? `${lead?.pct}% say "${lead?.option}" (${r.responses} people on site)` : "Waiting for answers",
  };
}

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const results = await getResults(id, await requestOrigin());
  if (!results) notFound();
  const r = sealResults(results);
  return (
    <Page>
      <LiveResults initial={r} dev={process.env.NODE_ENV !== "production"} />
    </Page>
  );
}
