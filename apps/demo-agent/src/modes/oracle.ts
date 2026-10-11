import { runAgent, type ToolHandler } from "../agent.js";
import type { LlmConfig } from "../config.js";
import type { McpBridge } from "../mcp-bridge.js";
import {
  buildOrder,
  decideTrade,
  listObservableMarkets,
  placeSandboxOrder,
  type Candidate,
  type OrderSpec,
} from "../gemini.js";
import { parseResults, type ParsedResults } from "../results.js";

export type OracleArgs = {
  minutes: number;
  threshold: number;
  dryRun: boolean;
  implied: number | null;
  list: boolean;
};

const CHOU = { lat: 37.8716, lng: -122.2536 };

const SYSTEM = `You are an oracle agent. You compare a prediction market's implied odds
against what humans on the ground at Chou Hall, UC Berkeley observe, and trade
the divergence.

Steps:
1. Call list_observable_markets. Pick the best candidate — prefer tradable
   (sandbox) instruments and ones that have odds, but if only non-tradable or
   unpriced candidates exist, still pick the best one and continue (the
   trade step degrades to a dry run). If there are no candidates at all,
   say so and stop.
2. Call check_coverage, then ask_location_question for a yes/no question at
   lat 37.8716, lng -122.2536 that a person outside can judge for that
   contract — e.g. "Is it 71°F (22°C) or warmer outside right now?" for an
   "above 71" strike. Option index 0 MUST be the "yes" answer. Include
   market_ref: {"provider":"gemini-predictions","env":<env>,"event_ticker":<ticker>,
   "contract_symbol":<symbol>,"label":<label>,"implied_yes":<implied_yes or null>}.
3. Call wait_for_results (repeat while status is open) until the question
   closes or settles.
4. Call evaluate_and_trade EXACTLY ONCE with question_id, contract_symbol and
   yes_option_index 0.
5. Report the outcome in one or two sentences.`;

const LIST_TOOL = {
  type: "function" as const,
  function: {
    name: "list_observable_markets",
    description:
      "List Gemini prediction-market contracts with a numeric above/below strike (e.g. temperature) that humans outside could observe. Sorted best-first.",
    parameters: { type: "object", properties: {} },
  },
};

const TRADE_TOOL = {
  type: "function" as const,
  function: {
    name: "evaluate_and_trade",
    description:
      "Compare crowd YES % on an A-eye question with the market's implied YES and place a sandbox order if they diverge enough.",
    parameters: {
      type: "object",
      properties: {
        question_id: { type: "string" },
        contract_symbol: { type: "string" },
        yes_option_index: { type: "integer", description: "tally index of the YES option (usually 0)" },
      },
      required: ["question_id", "contract_symbol", "yes_option_index"],
    },
  },
};

export async function listMode(log: (l: string) => void) {
  const { candidates, perEnv } = await listObservableMarkets();
  for (const e of perEnv) {
    log(`${e.env}: ${e.events} event(s)${e.error ? ` — ERROR ${e.error}` : ""}`);
  }
  if (candidates.length === 0) {
    log("No observable candidates.");
    return;
  }
  for (const c of candidates) {
    const implied = c.implied_yes != null ? `${Math.round(c.implied_yes * 100)}%` : "no odds";
    log(
      `${c.tradable ? "[sandbox]" : "[prod]   "} ${c.contract_symbol} ${c.strike.type} ${c.strike.value}` +
        ` | implied YES ${implied} | ${c.event_title} | ${c.label}`,
    );
  }
}

export type TradeRecord = {
  candidate: Candidate;
  crowd_yes_pct: number;
  responses: number;
  implied_source: "market" | "override";
  implied_yes: number | null;
  decision: ReturnType<typeof decideTrade>;
  order?: OrderSpec;
  placement?: unknown;
};

export async function runOracleMode(
  llm: LlmConfig,
  bridge: McpBridge,
  args: OracleArgs,
  log: (l: string) => void,
): Promise<string> {
  let latest: ParsedResults | undefined;
  let trade: TradeRecord | undefined;
  let latestCandidates: Candidate[] = [];

  const mcpTools = await bridge.openAiTools();
  const handlers: ToolHandler[] = mcpTools.map((definition) => ({
    definition,
    run: async (targs) => {
      const res = await bridge.callTool(definition.function.name, targs);
      const name = definition.function.name;
      if (name === "get_question_results" || name === "wait_for_results") {
        latest = parseResults(res.text) ?? latest;
      }
      return { text: res.text, images: res.images };
    },
  }));

  handlers.push({
    definition: LIST_TOOL,
    run: async () => {
      const report = await listObservableMarkets();
      latestCandidates = report.candidates;
      return { text: JSON.stringify({ per_env: report.perEnv, candidates: report.candidates }, null, 2) };
    },
  });

  handlers.push({
    definition: TRADE_TOOL,
    run: async (targs) => {
      const questionId = String(targs.question_id ?? "");
      const symbol = String(targs.contract_symbol ?? "");
      const yesIdx = Number(targs.yes_option_index ?? 0);
      // Fresh results via MCP (no images needed for the tally).
      const res = await bridge.callTool("get_question_results", {
        question_id: questionId,
        include_images: false,
      });
      const parsed = parseResults(res.text);
      if (parsed) latest = parsed;
      const crowdYesPct = parsed?.tally?.[yesIdx]?.pct ?? 0;
      const responses = parsed?.responses ?? 0;
      // Refresh the price.
      const report = await listObservableMarkets();
      latestCandidates = report.candidates;
      const candidate =
        report.candidates.find((c) => c.contract_symbol === symbol) ??
        ({
          env: "sandbox",
          tradable: true,
          event_ticker: "",
          event_title: "",
          contract_symbol: symbol,
          label: "",
          strike: { type: "above", value: "" },
          implied_yes: null,
          buy_yes: null,
          buy_no: null,
          expiry: null,
        } satisfies Candidate);
      const implied = args.implied ?? candidate.implied_yes;
      const decision = decideTrade({
        crowdYesPct,
        responses,
        impliedYes: implied,
        thresholdPts: args.threshold,
      });
      trade = {
        candidate,
        crowd_yes_pct: crowdYesPct,
        responses,
        implied_source: args.implied != null ? "override" : "market",
        implied_yes: implied,
        decision,
      };
      if (decision.action !== "none") {
        const order = buildOrder(candidate, decision.action);
        const placement = await placeSandboxOrder(order, candidate, { dryRun: args.dryRun });
        trade.order = order;
        trade.placement = placement;
      }
      return { text: JSON.stringify(trade, null, 2) };
    },
  });

  const user = `Find the best observable Gemini market, ask humans outside Chou Hall
(lat ${CHOU.lat}, lng ${CHOU.lng}) whether the YES condition currently holds,
close the question in ${args.minutes} minutes, then evaluate_and_trade once.
Divergence threshold: ${args.threshold} pts.${args.implied != null ? ` Market odds override: implied YES = ${args.implied}.` : ""}`;

  const answer = await runAgent({
    client: llm.client,
    model: llm.model,
    vision: llm.vision,
    system: SYSTEM,
    user,
    tools: handlers,
    log,
  });

  const lines: string[] = [answer];
  if (trade) {
    const market = trade.implied_yes != null ? `${Math.round(trade.implied_yes * 100)}%` : "no odds";
    const src = trade.implied_source === "override" ? " (override)" : "";
    const humans = `${Math.round(trade.crowd_yes_pct)}% (${trade.responses})`;
    const div = `${trade.decision.divergence_pts >= 0 ? "+" : ""}${Math.round(trade.decision.divergence_pts)} pts`;
    if (trade.decision.action === "none") {
      lines.push("", `Market: ${market}${src} · Humans: ${humans} → ${trade.decision.reason} → NO TRADE`);
    } else {
      const placement = trade.placement as { dry_run?: boolean; reason?: string; order_id?: string } | undefined;
      const tag = placement?.dry_run
        ? `dry run: ${placement.reason}`
        : `sandbox order ${placement?.order_id ?? "?"}`;
      lines.push(
        "",
        `Market: ${market}${src} · Humans: ${humans} → ${div} > ${args.threshold} → ` +
          `${trade.decision.action === "buy_yes" ? "BUY YES" : "BUY NO"} ${trade.order!.symbol} @${trade.order!.price} x${trade.order!.quantity} [${tag}]`,
      );
    }
  }
  return lines.join("\n");
}
