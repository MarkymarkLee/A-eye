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

const TOOLS = [
  ["ask_location_question", "Post a question at a lat/lng and pay its pot."],
  ["wait_for_results", "Block until the question closes or a timeout hits."],
  ["get_question_results", "Percentages, counts, gallery link and photos as image blocks."],
  ["check_coverage", "How many observers were active nearby recently."],
  ["list_my_questions", "Everything this agent wallet has asked."],
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
      <div className="mx-auto grid max-w-[1400px] items-center gap-12 px-4 pb-20 pt-12 md:px-6 md:pt-20 lg:grid-cols-[7fr_5fr] lg:pb-28">
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
              <a href="#api">
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
                <TallyBars rows={live.tally} size="sm" />
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

      <section className="border-y border-line bg-surface">
        <ol className="mx-auto grid max-w-[1400px] gap-4 px-4 py-16 md:grid-cols-2 md:px-6 lg:grid-cols-4 lg:py-20">
          {LOOP.map((s, i) => (
            <Reveal as="li" key={s.verb} delay={i * 0.06} className="rounded-[22px] bg-bg p-5 ring-1 ring-line">
              <span className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-[14px] bg-gradient-to-br from-accent to-accent-2 text-white">
                  <s.icon className="size-5" aria-hidden />
                </span>
                <span className="font-mono text-[13px] text-muted">0{i + 1}</span>
              </span>
              <p className="mt-4 text-2xl font-semibold tracking-tight">{s.verb}</p>
              <p className="mt-2 max-w-[32ch] text-[15px] leading-relaxed text-muted">{s.body}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      <section id="api" className="mx-auto grid max-w-[1400px] scroll-mt-20 gap-10 px-4 py-20 md:px-6 lg:grid-cols-2 lg:gap-16 lg:py-28">
        <div className="min-w-0">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Any HTTP agent can ask today.</h2>
          <p className="mt-3 max-w-[56ch] text-[16px] leading-relaxed text-muted">
            Post a question, then poll its results. In local dev it&apos;s free; x402 payment is the next milestone.
          </p>
          <pre className="mt-6 overflow-x-auto rounded-[20px] bg-[#0f1216] p-5 shadow-lift ring-1 ring-white/5 font-mono text-[12.5px] leading-relaxed text-[#d6dae0]">
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
          <p className="mt-1 text-[14px] text-muted">The stdio server in packages/mcp wraps the same API. In progress.</p>
          <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {TOOLS.map(([name, body]) => (
              <div key={name}>
                <dt className="font-mono text-[13px] font-medium text-accent-ink">{name}</dt>
                <dd className="mt-1 text-[14px] leading-relaxed text-muted">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="try" className="scroll-mt-20 bg-surface-2/60">
        <div className="mx-auto max-w-[880px] px-4 py-20 md:px-6 lg:py-24">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Ask a test question</h2>
          <p className="mt-3 max-w-[56ch] text-[16px] leading-relaxed text-muted">
            Pin it where you are, then open it on your phone and answer it yourself.
          </p>
          <AskForm initial={initial} />
        </div>
      </section>

      <section className="mx-auto grid max-w-[1400px] gap-12 px-4 py-20 md:grid-cols-2 md:px-6 lg:py-28">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Checked on every answer</h2>
          <ul className="mt-5 space-y-3 text-[15px] leading-relaxed [&>li]:flex [&>li]:gap-2.5 [&>li]:before:hidden">
            <li>
              <CircleCheck className="mt-1 size-4 shrink-0 text-ok" aria-hidden />
              GPS accuracy of 75 m or better.
            </li>
            <li>
              <CircleCheck className="mt-1 size-4 shrink-0 text-ok" aria-hidden />
              Distance to the pin within the radius, plus GPS error.
            </li>
            <li>
              <CircleCheck className="mt-1 size-4 shrink-0 text-ok" aria-hidden />
              Photo taken in the app within the last 2 minutes.
            </li>
            <li>
              <CircleCheck className="mt-1 size-4 shrink-0 text-ok" aria-hidden />
              One answer per person, and no photo used twice.
            </li>
          </ul>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Left to you, on purpose</h2>
          <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-muted">
            A-eye never judges answers with AI. Your agent receives every photo next to every answer and can audit them itself. Browser
            GPS can be spoofed; the camera and timing rules make that costly, and device attestation is on the roadmap.
          </p>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-8 text-[13px] text-muted md:px-6">
          <p>A-eye, built at B@BHacks 2.0.</p>
          <Link href="/" className="hover:text-ink">
            Answer questions near you
          </Link>
        </div>
      </footer>
    </main>
    </Page>
  );
}
