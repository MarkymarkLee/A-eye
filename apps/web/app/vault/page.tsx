import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Bot, Camera, HandCoins, Landmark, type LucideIcon } from "lucide-react";
import { Page } from "@/components/motion/page";
import { Badge, LiveDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { loadVaultView } from "@/lib/xrpl-vault-state";
import { devnetAccount, type VaultRole, type VaultView } from "@/lib/xrpl-lending";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Bounty Credit Vault",
  description: "Sponsors fund an XRPL vault, A-eye brokers loans, and agents borrow to pay bounties to people on the ground.",
};

const ROLES: { role: VaultRole; also?: VaultRole; title: string; who: string; body: string; icon: LucideIcon }[] = [
  {
    role: "depositor",
    also: "sponsor",
    title: "Depositors",
    who: "Sponsors",
    body: "Deposit XRP into a Single Asset Vault for shares. One redeems with yield at maturity; one stays in.",
    icon: HandCoins,
  },
  { role: "broker", title: "Loan Broker", who: "A-eye", body: "Posts first-loss cover and underwrites fixed-term credit from the vault.", icon: Landmark },
  { role: "borrower", title: "Borrower", who: "AI agent", body: "Draws a loan, funds a question bounty pot, repays with interest.", icon: Bot },
  { role: "observer", title: "Observer", who: "Person on the ground", body: "Answers the question and receives the escrowed bounty.", icon: Camera },
];

const ROLE_TONE: Record<VaultRole, "accent" | "ok" | "sky" | "neutral"> = {
  broker: "accent",
  depositor: "ok",
  sponsor: "ok",
  borrower: "sky",
  observer: "neutral",
};

const PHASE_LABEL: Record<VaultView["phase"], string> = {
  subscription: "Subscription: deposits open",
  investment: "Investment: capital deployed",
  redemption: "Redemption: withdrawals open",
};

function xrp(drops: string | number, digits = 6): string {
  const n = Number(drops) / 1_000_000;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
}

function short(s: string): string {
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

function SourceBadge({ view }: { view: VaultView }) {
  if (view.source === "live")
    return (
      <Badge tone="ok" size="md">
        <LiveDot tone="ok" /> Live on XRPL Devnet
      </Badge>
    );
  if (view.source === "recorded")
    return (
      <Badge tone="sky" size="md">
        Recorded Devnet run (network unreachable)
      </Badge>
    );
  return (
    <Badge tone="warn" size="md">
      Simulated: what the flow would do
    </Badge>
  );
}

function Stat({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-2 font-mono text-[26px] font-semibold tabular-nums tracking-tight md:text-[30px]">
        {value}
        {unit && <span className="ml-1.5 text-[15px] font-medium text-muted">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
    </Card>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-[13px] text-accent-ink underline-offset-4 hover:underline"
    >
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </a>
  );
}

export default async function VaultPage() {
  const view = await loadVaultView();
  const yieldDrops = Number(view.depositor_yield_drops);

  return (
    <Page>
      <main>
        <section className="bg-aurora">
          <div className="mx-auto max-w-[1100px] px-4 pb-14 pt-10 md:px-6 md:pt-16">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent" size="md">
                XLS-65 Single Asset Vault + XLS-66 Lending
              </Badge>
              <SourceBadge view={view} />
            </div>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.04] tracking-tighter text-balance md:text-6xl">
              Bounty <span className="text-gradient">Credit Vault</span>
            </h1>
            <p className="mt-4 max-w-[60ch] text-[16px] leading-relaxed text-muted md:text-lg">
              Sponsors fund a vault on the XRP Ledger. A-eye brokers a fixed-term loan to an AI agent, the agent pays a person
              on the ground to answer its question, then repays with interest that accrues to the vault&apos;s shares.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {view.vault_explorer_url && (
                <Button asChild variant="secondary">
                  <a href={view.vault_explorer_url} target="_blank" rel="noreferrer">
                    View vault on Devnet explorer <ArrowUpRight className="size-4" aria-hidden />
                  </a>
                </Button>
              )}
              <Button asChild variant="ghost">
                <Link href="/agents">
                  How agents ask <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-[1100px] px-4 pb-24 md:px-6">
          <section aria-label="Vault stats" className="-mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total value locked" value={xrp(view.tvl_drops)} unit="XRP" hint={`${xrp(view.available_drops)} XRP available`} />
            <Stat
              label="Share price"
              value={view.share_price.toFixed(7)}
              unit="drops"
              hint={`per share · ${Number(view.shares_outstanding).toLocaleString("en-US")} shares`}
            />
            <Stat
              label="Depositor yield"
              value={`${yieldDrops >= 0 ? "+" : ""}${yieldDrops.toLocaleString("en-US")}`}
              unit="drops"
              hint="interest paid into the vault, net of broker fee"
            />
            <Stat label="Vault phase" value={view.phase[0]!.toUpperCase() + view.phase.slice(1)} hint={PHASE_LABEL[view.phase]} />
          </section>

          <section className="mt-12">
            <h2 className="text-2xl font-semibold tracking-tight">Who does what</h2>
            <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ROLES.map((r) => {
                const accounts = [view.accounts[r.role], r.also && view.accounts[r.also]].filter((a): a is string => Boolean(a));
                return (
                  <li key={r.role}>
                    <Card className="h-full p-5">
                      <span className="grid size-10 place-items-center rounded-[13px] bg-gradient-to-br from-accent to-accent-2 text-white">
                        <r.icon className="size-5" aria-hidden />
                      </span>
                      <p className="mt-4 text-[17px] font-semibold tracking-tight">{r.title}</p>
                      <p className="text-[13px] text-muted">{r.who}</p>
                      <p className="mt-2 text-[14px] leading-relaxed text-muted">{r.body}</p>
                      {accounts.length > 0 && (
                        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                          {accounts.map((a) => (
                            <ExternalLink key={a} href={devnetAccount(a)}>
                              {short(a)}
                            </ExternalLink>
                          ))}
                        </p>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="mt-12">
            <h2 className="text-2xl font-semibold tracking-tight">Loans</h2>
            {view.loans.length === 0 ? (
              <EmptyState className="mt-5" icon={<Landmark className="size-6" />} title="No loans yet" body="The broker has not issued credit from this vault." />
            ) : (
              <ul className="mt-5 grid gap-3">
                {view.loans.map((l, i) => (
                  <li key={l.loan_id ?? i}>
                    <Card className="grid gap-4 p-5 md:grid-cols-[1fr_auto_auto_auto] md:items-center md:gap-8">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge tone={l.status === "open" ? "warn" : "ok"}>{l.status === "open" ? "Open" : "Repaid and closed"}</Badge>
                          <span className="text-[13px] text-muted">
                            {l.apr_pct}% APR · {l.term_sec}s term
                          </span>
                        </div>
                        <p className="mt-2 text-[14px] text-muted">
                          Borrower {l.borrower ? <ExternalLink href={devnetAccount(l.borrower)}>{short(l.borrower)}</ExternalLink> : "AI agent"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[12.5px] text-muted">Principal</p>
                        <p className="font-mono text-[17px] font-semibold tabular-nums">{xrp(l.principal_drops)} XRP</p>
                      </div>
                      <div>
                        <p className="text-[12.5px] text-muted">Outstanding</p>
                        <p className="font-mono text-[17px] font-semibold tabular-nums">{xrp(l.outstanding_drops)} XRP</p>
                      </div>
                      {l.explorer_url ? <ExternalLink href={l.explorer_url}>Loan tx</ExternalLink> : <span className="text-[13px] text-muted">Not on-chain</span>}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-12">
            <h2 className="text-2xl font-semibold tracking-tight">Capital flow on-chain</h2>
            <p className="mt-1 text-[14px] text-muted">
              {view.source === "simulated"
                ? "Devnet is unavailable, so these are the transactions the demo would submit."
                : "Every step is a validated transaction on XRPL Devnet."}
            </p>
            <Card className="mt-5 overflow-hidden">
              <ol className="divide-y divide-line">
                {view.steps.map((s, i) => (
                  <li key={s.key} className="grid grid-cols-[2rem_1fr] gap-x-3 gap-y-1 px-5 py-4 md:grid-cols-[2rem_1fr_9rem_10rem] md:items-center">
                    <span className="font-mono text-[13px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium leading-snug">{s.label}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge tone={ROLE_TONE[s.role]}>{s.role}</Badge>
                        <span className="font-mono text-[12.5px] text-muted">{s.tx_type}</span>
                      </p>
                    </div>
                    <span className="col-start-2 font-mono text-[14px] tabular-nums md:col-start-auto md:text-right">
                      {s.amount_drops ? `${xrp(s.amount_drops)} XRP` : ""}
                    </span>
                    <span className="col-start-2 md:col-start-auto md:text-right">
                      {s.explorer_url && s.hash ? (
                        <ExternalLink href={s.explorer_url}>{short(s.hash)}</ExternalLink>
                      ) : (
                        <span className="text-[13px] text-muted">pending</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          </section>

          <section className="mt-12 grid gap-3">
            <Disclosure title="Why a closed-ended vault?">
              <p className="text-[14.5px] leading-relaxed text-muted">
                Under LendingProtocolV1_1 a Loan Broker can only lend from a closed-ended vault. It runs in three phases:
                subscription (sponsors deposit), investment (the broker lends, deposits and withdrawals pause) and redemption
                (loans are repaid and depositors withdraw their share of principal plus interest).
              </p>
            </Disclosure>
            <Disclosure title="Run it yourself">
              <p className="text-[14.5px] leading-relaxed text-muted">
                <code className="font-mono text-[13px] text-ink">npm run xrpl:vault</code> funds fresh Devnet wallets from the
                faucet, runs every step above in about six minutes and records the run that this page reads. If the vault
                amendments or Devnet are unavailable, the script prints a dry run and this page falls back to the last recorded
                run, then to a simulation.
              </p>
            </Disclosure>
          </section>
        </div>
      </main>
    </Page>
  );
}
