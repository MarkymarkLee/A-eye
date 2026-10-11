import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Camera, CircleCheck, CircleDollarSign, MessageSquareText, Trophy } from "lucide-react";
import { Page } from "@/components/motion/page";
import { Button } from "@/components/ui/button";
import { Badge, LiveDot } from "@/components/ui/badge";
import { allOpenQuestions, getResults } from "@/lib/store";
import { requestOrigin } from "@/lib/request-origin";
import { TallyBars } from "@/components/tally-bars";
import { AskForm } from "@/components/ask-form";
import { Card } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Reveal } from "@/components/reveal";
import { formatDistance } from "@/lib/geo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "For agents", description: "Give your AI agent eyes on any place, answered by people standing there." };

const LOOP = [
  { icon: MessageSquareText, verb: "Ask", body: "Your agent posts a question, a pin and a radius, plus a raffle pot." },
  { icon: CircleDollarSign, verb: "Pay", body: "The pot is paid per request over x402 in AUSD on Base Sepolia." },
  { icon: Camera, verb: "Answer", body: "People within the radius answer with a live photo. GPS and timing are checked." },
  { icon: Trophy, verb: "Settle", body: "At close you get the split, every photo, and a provably fair raffle draw." },
];

const CHECKS = [
  "GPS accuracy of 75 m or better.",
  "Distance to the pin within the radius, plus GPS error.",
  "Photo taken in the app within the last 2 minutes.",
  "One answer per person, and no photo used twice.",
];

const TOOLS = [
  ["ask_location_question", "Post a question at a lat/lng and pay its pot."],
  ["wait_for_results", "Block until the question closes or a timeout hits."],
  ["get_question_results", "Percentages, counts, gallery link and photos as image blocks."],
  ["check_coverage", "How many observers were active nearby recently."],
  ["list_my_questions", "Questions this agent (wallet or A_EYE_AGENT_LABEL) has asked."],
];

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ lat?: string; lng?: string }> }) {
  const sp = await searchParams;
  const origin = await requestOrigin();
  const open = await allOpenQuestions();
  const featured = [...open].sort((a, b) => b.responses - a.responses)[0];
  const live = featured ? await getResults(featured.id, origin) : undefined;
  const initial = sp.lat && sp.lng ? { lat: Number(sp.lat), lng: Number(sp.lng) } : undefined;

  return (
    <Page>
    <main>
      <section className="bg-aurora">
      <div className="mx-auto grid max-w-[1200px] items-center gap-8 px-4 pb-12 pt-8 md:px-6 md:pt-16 lg:grid-cols-[7fr_5fr] lg:gap-12 lg:pb-20">
        <Reveal>
          <Badge tone="accent" size="md">For AI agents and developers</Badge>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.02] tracking-tighter text-balance md:text-7xl">
            Ask the <span className="text-gradient">physical world.</span>
          </h1>
          <p className="mt-6 max-w-[44ch] text-lg leading-relaxed text-muted">
            Your agent asks about a place. People standing there answer with a photo. You get percentages and proof.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a href="#connect">
                Connect an agent <ArrowRight className="size-4" strokeWidth={2.4} aria-hidden />
              </a>
            </Button>
            {live && (
              <Button asChild size="lg" variant="secondary">
                <Link href={`/q/${live.id}`} transitionTypes={["nav-forward"]}>
                  View live results
                </Link>
              </Button>
            )}
          </div>
        </Reveal>

        {live ? (
          <Reveal delay={0.12}>
            <figure className="rounded-[24px] bg-surface p-5 shadow-lift ring-1 ring-line md:p-6">
              <div className="grid grid-cols-[1fr_auto] items-start gap-4">
                <figcaption>
                  <p className="flex items-center gap-2 text-[13px] text-muted">
                    <LiveDot /> Live now at {live.place_label}
                  </p>
                  <p className="mt-1 text-[19px] font-medium leading-snug tracking-tight">{live.prompt}</p>
                </figcaption>
                <span className="font-mono text-[13px] text-muted">{live.responses} people</span>
              </div>
              <div className="mt-6">
                {live.sealed ? (
                  <p className="rounded-[14px] bg-accent-soft px-4 py-3 text-[14px] leading-snug text-accent-ink">
                    Sealed until close. Agents pay {live.peek?.price_usd ?? 0.02} AUSD over x402 to peek; the fee tops up the raffle.
                  </p>
                ) : (
                  <TallyBars rows={live.tally} size="sm" />
                )}
              </div>
              {live.evidence.length > 0 && (
                <div className="mt-6 grid grid-cols-3 gap-2">
                  {live.evidence.slice(-3).map((e) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={e.id}
                      src={e.image_url}
                      alt={`Answer "${e.answer}", ${formatDistance(e.distance_m)} from the spot`}
                      className="aspect-[4/5] w-full rounded-[12px] bg-surface-2 object-cover"
                    />
                  ))}
                </div>
              )}
            </figure>
          </Reveal>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="https://picsum.photos/seed/aeye-campus-plaza/900/1100"
            alt="A campus plaza in daylight"
            className="aspect-[4/5] w-full rounded-[24px] object-cover shadow-lift"
          />
        )}
      </div>
      </section>

      <section className="border-t border-line bg-surface/60">
        <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-14">
          <Tabs
            hashSync
            label="For agents"
            listClassName="md:max-w-[520px]"
            items={[
              { value: "how", label: "How it works", content: <HowItWorks /> },
              { value: "connect", label: "Connect", content: <Connect origin={origin} /> },
              {
                value: "try",
                label: "Try it",
                content: (
                  <div className="max-w-[760px]">
                    <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Ask a test question</h2>
                    <p className="mt-2 max-w-[56ch] text-[15px] leading-relaxed text-muted">
                      Pin it where you are, then open it on your phone and answer it yourself.
                    </p>
                    <AskForm initial={initial} />
                  </div>
                ),
              },
            ]}
          />
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-8 text-[13px] text-muted md:px-6">
          <p>A-eye, built at B@BHacks 2.0.</p>
          <div className="flex flex-wrap gap-5">
            <Link href="/vault" className="hover:text-ink">
              Bounty Credit Vault (XRPL lending)
            </Link>
            <Link href="/" className="hover:text-ink">
              Answer questions near you
            </Link>
          </div>
        </div>
      </footer>
    </main>
    </Page>
  );
}

function HowItWorks() {
  return (
    <div className="grid gap-4">
      <ol className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {LOOP.map((s, i) => (
          <li key={s.verb} className="rounded-[20px] bg-bg p-4 ring-1 ring-line md:p-5">
            <span className="flex items-center justify-between">
              <span className="grid size-10 place-items-center rounded-[13px] bg-gradient-to-br from-accent to-accent-2 text-white">
                <s.icon className="size-5" aria-hidden />
              </span>
              <span className="font-mono text-[12px] text-muted">0{i + 1}</span>
            </span>
            <p className="mt-3 text-[19px] font-semibold tracking-tight">{s.verb}</p>
            <p className="mt-1 text-[13.5px] leading-snug text-muted md:text-[14.5px]">{s.body}</p>
          </li>
        ))}
      </ol>
      <Card className="grid gap-6 p-5 md:grid-cols-2 md:p-6">
        <div>
          <h3 className="text-[17px] font-semibold tracking-tight">Checked on every answer</h3>
          <ul className="mt-3 grid gap-2 text-[14.5px] leading-snug">
            {CHECKS.map((c) => (
              <li key={c} className="flex gap-2.5">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                {c}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-[17px] font-semibold tracking-tight">Left to you, on purpose</h3>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
            A-eye never judges answers with AI. Your agent gets every photo next to every answer and can audit them itself. Browser GPS can
            be spoofed; the camera and timing rules make that costly, and device attestation is on the roadmap.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Connect({ origin }: { origin: string }) {
  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Any HTTP agent can ask today.</h2>
        <p className="mt-2 max-w-[56ch] text-[15px] leading-relaxed text-muted">
          Paid servers answer with an x402 402 challenge (AUSD on Base Sepolia); unpaid/dev servers accept it free.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-[20px] bg-[#0f1216] p-5 font-mono text-[12.5px] leading-relaxed text-[#d6dae0] shadow-lift ring-1 ring-white/5">
{`curl -X POST ${origin}/api/questions \\
  -H 'content-type: application/json' \\
  -d '{
    "lat": 37.86967, "lng": -122.25913,
    "question": "Is there a line at the coffee cart?",
    "options": ["No line", "1 to 5 people", "6 or more"],
    "prize_usd": 2, "closes_in_minutes": 30
  }'

curl ${origin}/api/questions/<question_id>`}
        </pre>
      </div>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold tracking-tight">MCP tools</h3>
        <p className="mt-1 text-[14px] text-muted">The stdio server in packages/mcp wraps the same API.</p>
        <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {TOOLS.map(([name, body]) => (
            <div key={name}>
              <dt className="font-mono text-[13px] font-medium text-accent-ink">{name}</dt>
              <dd className="mt-1 text-[14px] leading-relaxed text-muted">{body}</dd>
            </div>
          ))}
        </dl>
        <pre className="mt-5 overflow-x-auto rounded-[20px] bg-[#0f1216] p-5 font-mono text-[12.5px] leading-relaxed text-[#d6dae0] shadow-lift ring-1 ring-white/5">
          {JSON.stringify(
            { mcpServers: { "a-eye": { command: "node", args: ["/path/to/A-eye/packages/mcp/dist/index.js"], env: { A_EYE_API_URL: origin } } } },
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  );
}
