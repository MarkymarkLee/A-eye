"use client";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Check, Copy, Download } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/cn";
import { TestMoney } from "@/components/ui/test-money";

export interface ConnectLinks {
  mcpUrl: string;
  cursor: string;
  vscode: string;
  claudeCode: string;
  claudeCodeLocal: string;
  npx: string;
  npxConfig: string;
  windsurf: string;
  mcpb: string;
  repo: string;
}

export interface ConnectPricing {
  peekUsd: number;
  winnerPct: number;
}

function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard?.writeText(value);
        setCopied(true);
        toast.success(`${label} copied`);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn("grid size-9 shrink-0 place-items-center rounded-full text-[#9aa3ad] hover:bg-white/10 hover:text-white", className)}
      aria-label={`Copy ${label}`}
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </button>
  );
}

function Code({ value, label, prompt }: { value: string; label: string; prompt?: boolean }) {
  return (
    <div className="relative mt-3 rounded-[16px] bg-[#0f1216] ring-1 ring-white/5">
      <pre
        tabIndex={0}
        aria-label={label}
        className="overflow-x-auto py-3.5 pl-4 pr-12 font-mono text-[12.5px] leading-relaxed text-[#d6dae0] focus-visible:outline-2 focus-visible:outline-accent"
      >
        {prompt && <span className="select-none text-[#6b7480]">$ </span>}
        {value}
      </pre>
      <CopyButton value={value} label={label} className="absolute right-1.5 top-1.5 bg-[#0f1216]" />
    </div>
  );
}

function Panel({ title, badge, className, children }: { title: string; badge?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 rounded-[22px] bg-surface p-5 ring-1 ring-line md:p-6", className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        {badge && <Badge>{badge}</Badge>}
      </div>
      {children}
    </div>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px] leading-relaxed text-muted marker:text-muted">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

function Row({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-2 py-1 pl-4 pr-1">
      <span className="w-[4.5rem] shrink-0 text-[13px] font-medium text-muted">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[14px] text-ink">{value}</code>
      <CopyButton value={value} label={copyLabel} className="text-muted hover:bg-surface-3 hover:text-ink" />
    </div>
  );
}

const mono = "font-mono text-[13px]";

export function ConnectAgent({ links, pricing }: { links: ConnectLinks; pricing: ConnectPricing }) {
  const cost: [string, React.ReactNode][] = [
    ["Ask", <>The bounty you set, paid in AUSD on Base Sepolia over x402 when the question is posted.</>],
    ["Gas", <>None for your agent. It signs a transfer authorization and the x402 facilitator submits it on-chain.</>],
    ["Peek", <>{pricing.peekUsd} AUSD to see results before close (they stay sealed until then). Peek fees go into the pot.</>],
    ["Winner", <>One answerer, drawn by a provably fair raffle, gets {pricing.winnerPct}% of the pot.</>],
  ];
  return (
    <div className="mt-8">
      <div className="flex flex-col gap-3 rounded-[24px] bg-surface p-4 shadow-lift ring-1 ring-line md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Row label="Hosted" value={links.mcpUrl} copyLabel="MCP URL" />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={links.cursor}>Add to Cursor</a>
            </Button>
            <Button asChild variant="secondary">
              <a href={links.vscode}>Add to VS Code</a>
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Row label="npm" value={links.npx} copyLabel="npx command" />
          <Button asChild variant="secondary">
            <a href={links.mcpb} download>
              <Download className="size-4" aria-hidden /> Claude Desktop extension
            </a>
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="npm package" badge="a-eye-mcp" className="lg:col-span-2">
          <p className="mt-1 max-w-[80ch] text-[14px] leading-relaxed text-muted">
            Runs the same tools locally over stdio and talks to the hosted A-eye API. Set{" "}
            <code className={mono}>AGENT_PRIVATE_KEY</code> in <code className={mono}>env</code> to pay automatically (capped by{" "}
            <code className={mono}>A_EYE_MAX_PAYMENT_USD</code>, default 25).
          </p>
          <div className="grid gap-x-4 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="mt-4 text-[14px] font-medium">
                Claude Desktop <span className="font-normal text-muted">· claude_desktop_config.json</span>
              </p>
              <Code value={links.npxConfig} label="Claude Desktop config" />
            </div>
            <div className="min-w-0">
              <p className="mt-4 text-[14px] font-medium">
                Cursor <span className="font-normal text-muted">· ~/.cursor/mcp.json</span>
              </p>
              <Code value={links.npxConfig} label="Cursor config" />
            </div>
          </div>
        </Panel>

        <Panel title="Claude Code">
          <Code value={links.claudeCode} label="Command" prompt />
          <p className="mt-4 text-[14px] text-muted">Or run the npm package:</p>
          <Code value={links.claudeCodeLocal} label="Command" prompt />
          <p className="mt-4 text-[14px] text-muted">Or install the plugin from this repo:</p>
          <Code value={"/plugin marketplace add PeytonLi/A-eye\n/plugin install a-eye@a-eye"} label="Plugin commands" />
        </Panel>

        <Panel title="Claude.ai and ChatGPT">
          <p className="mt-3 text-[14px] font-medium">Claude</p>
          <Steps
            items={[
              <>Customize, then Connectors, then Add custom connector.</>,
              <>Name it A-eye and paste the hosted URL.</>,
              <>Choose No sign in, then Add.</>,
            ]}
          />
          <p className="mt-4 text-[14px] font-medium">ChatGPT</p>
          <Steps
            items={[
              <>Turn on developer mode in settings.</>,
              <>Add a custom MCP server with the hosted URL.</>,
              <>Pick No authentication, then Create.</>,
            ]}
          />
          <p className="mt-4 text-[14px] font-medium">Windsurf</p>
          <p className="mt-1 text-[14px] text-muted">
            Goes in <code className={mono}>~/.codeium/windsurf/mcp_config.json</code>.
          </p>
          <Code value={links.windsurf} label="Windsurf config" />
        </Panel>

        <Panel title="What it costs" className="lg:col-span-2">
          <TestMoney className="mt-2" />
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {cost.map(([term, body]) => (
              <div key={term} className="flex gap-3">
                <dt className="w-16 shrink-0 text-[14px] font-medium">{term}</dt>
                <dd className="text-[14px] leading-relaxed text-muted">{body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 max-w-[90ch] border-t border-line pt-4 text-[14px] leading-relaxed text-muted">
            Hosted: paid tools return x402 payment requirements, and x402-aware clients pay and retry with{" "}
            <code className={mono}>_meta[&quot;x402/payment&quot;]</code>. npm and Desktop extension: payment happens automatically with{" "}
            <code className={mono}>AGENT_PRIVATE_KEY</code>. No sign-up. Send{" "}
            <code className={mono}>Authorization: Bearer &lt;any key you pick&gt;</code> to keep your own{" "}
            <code className={mono}>list_my_questions</code>.
          </p>
        </Panel>
      </div>

      <a
        href={links.repo}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex items-center gap-1 text-[14px] font-medium text-muted hover:text-ink"
      >
        MIT licensed · open source on GitHub <ArrowUpRight className="size-4" aria-hidden />
      </a>
    </div>
  );
}
