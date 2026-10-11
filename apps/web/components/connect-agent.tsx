"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/cn";

export interface ConnectLinks {
  mcpUrl: string;
  cursor: string;
  vscode: string;
  claudeCode: string;
  claudeDesktop: string;
  windsurf: string;
  mcpb: string;
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
      <pre className="overflow-x-auto py-3.5 pl-4 pr-12 font-mono text-[12.5px] leading-relaxed text-[#d6dae0]">
        {prompt && <span className="select-none text-[#6b7480]">$ </span>}
        {value}
      </pre>
      <CopyButton value={value} label={label} className="absolute right-1.5 top-1.5 bg-[#0f1216]" />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[22px] bg-surface p-5 ring-1 ring-line md:p-6">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
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

export function ConnectAgent({ links }: { links: ConnectLinks }) {
  return (
    <div className="mt-8">
      <div className="flex flex-col gap-4 rounded-[24px] bg-surface p-4 shadow-lift ring-1 ring-line md:flex-row md:items-center md:p-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-2 py-1 pl-4 pr-1">
          <span className="shrink-0 text-[13px] font-medium text-muted">MCP URL</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[14px] text-ink">{links.mcpUrl}</code>
          <CopyButton value={links.mcpUrl} label="MCP URL" className="text-muted hover:bg-surface-3 hover:text-ink" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={links.cursor}>Add to Cursor</a>
          </Button>
          <Button asChild variant="secondary">
            <a href={links.vscode}>Add to VS Code</a>
          </Button>
          <Button asChild variant="secondary">
            <a href={links.mcpb} download>
              <Download className="size-4" aria-hidden /> Claude Desktop
            </a>
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Claude Code">
          <Code value={links.claudeCode} label="Command" prompt />
          <p className="mt-4 text-[14px] text-muted">Or install the plugin from this repo:</p>
          <Code value={"/plugin marketplace add PeytonLi/A-eye\n/plugin install a-eye@a-eye"} label="Plugin commands" />
        </Panel>

        <Panel title="Claude.ai and ChatGPT">
          <p className="mt-3 text-[14px] font-medium">Claude</p>
          <Steps
            items={[
              <>Customize, then Connectors, then Add custom connector.</>,
              <>Name it A-eye and paste the MCP URL.</>,
              <>Choose No sign in, then Add.</>,
            ]}
          />
          <p className="mt-4 text-[14px] font-medium">ChatGPT</p>
          <Steps
            items={[
              <>Turn on developer mode in settings.</>,
              <>Add a custom MCP server with the MCP URL.</>,
              <>Pick No authentication, then Create.</>,
            ]}
          />
        </Panel>

        <Panel title="Claude Desktop config">
          <p className="mt-1 text-[14px] leading-relaxed text-muted">
            Runs the npm package locally. Add <code className="font-mono text-[13px]">AGENT_PRIVATE_KEY</code> to{" "}
            <code className="font-mono text-[13px]">env</code> to pay pots automatically.
          </p>
          <Code value={links.claudeDesktop} label="Claude Desktop config" />
        </Panel>

        <Panel title="Windsurf config">
          <p className="mt-1 text-[14px] leading-relaxed text-muted">
            Goes in <code className="font-mono text-[13px]">~/.codeium/windsurf/mcp_config.json</code>.
          </p>
          <Code value={links.windsurf} label="Windsurf config" />
        </Panel>
      </div>

      <p className="mt-5 max-w-[80ch] text-[14px] leading-relaxed text-muted">
        No sign-up. Send <code className="font-mono text-[13px]">Authorization: Bearer &lt;any key you pick&gt;</code> to keep your own{" "}
        <code className="font-mono text-[13px]">list_my_questions</code>. Paid asks return x402 payment requirements; x402-aware clients pay
        and retry with <code className="font-mono text-[13px]">_meta[&quot;x402/payment&quot;]</code>.
      </p>
    </div>
  );
}
