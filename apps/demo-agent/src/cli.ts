#!/usr/bin/env node
// Usage:
//   tsx src/cli.ts ask "<question>" [--lat .. --lng .. --minutes .. --prize .. --radius ..]
//   tsx src/cli.ts oracle [--minutes ..] [--threshold ..] [--dry-run] [--implied ..] [--list]

import { loadLlm } from "./config.js";
import { McpBridge } from "./mcp-bridge.js";
import { runAskMode } from "./modes/ask.js";
import { listMode, runOracleMode } from "./modes/oracle.js";

function flags(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (key === "dry-run" || key === "list") {
        out[key] = true;
      } else {
        out[key] = argv[++i] ?? "";
      }
    } else {
      positional.push(a);
    }
  }
  return { out, positional };
}

const log = (l: string) => console.log(l);

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const { out, positional } = flags(rest);

  if (mode === "oracle" && out.list === true) {
    await listMode(log);
    return;
  }

  const llm = loadLlm();
  const bridge = await McpBridge.connect();
  try {
    if (mode === "ask") {
      const question = positional[0];
      if (!question) throw new Error('usage: ask "<question>" [--lat --lng --minutes --prize --radius]');
      const answer = await runAskMode(
        llm,
        bridge,
        {
          question,
          lat: Number(out.lat ?? 37.8716),
          lng: Number(out.lng ?? -122.2536),
          minutes: Number(out.minutes ?? 10),
          prize: Number(out.prize ?? 1),
          radius: Number(out.radius ?? 150),
        },
        log,
      );
      console.log(`\n${answer}`);
    } else if (mode === "oracle") {
      const answer = await runOracleMode(
        llm,
        bridge,
        {
          minutes: Number(out.minutes ?? 10),
          threshold: Number(out.threshold ?? process.env.ORACLE_DIVERGENCE_PTS ?? 15),
          dryRun: out["dry-run"] === true,
          implied: out.implied != null ? Number(out.implied) : null,
          list: false,
        },
        log,
      );
      console.log(`\n${answer}`);
    } else {
      console.error("usage: cli.ts ask <question> [opts] | oracle [opts]");
      process.exit(1);
    }
  } finally {
    await bridge.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
