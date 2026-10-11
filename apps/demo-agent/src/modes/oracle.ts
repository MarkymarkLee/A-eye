import { runAgent, type ToolHandler } from "../agent.js";
import type { LlmConfig } from "../config.js";
import type { McpBridge } from "../mcp-bridge.js";
import {
  buildOrder,
  sizeTrade,
  listObservableMarkets,
  executeSandboxTrade,
  type Candidate,
  type OrderSpec,
} from "../gemini.js";
import { GeminiRestClient } from "../gemini-rest.js";
import { parseResults, type ParsedResults } from "../results.js";
import { aEyeApiUrl } from "../config.js";

export type OracleArgs = {
  minutes: number;
  threshold: number;
  dryRun: boolean;
  implied: number | null;
  list: boolean;
};

const CHOU = { lat: 37.8716, lng: -122.2536 };

const SYSTEM = `You are an oracle agent. You compare Gemini prediction-market odds
with a local human crowd forecast, then trade the divergence in Gemini sandbox.

Steps:
1. Call list_observable_markets and pick the top tradable sandbox candidate.
   Gemini sandbox currently lists Crypto and Commodities contracts only.
2. Call check_coverage, then ask a clear yes/no crowd-forecast question at
   lat 37.8716, lng -122.2536 that people can reasonably answer, for example
   "Will BTC be at or above $83,200 at 6pm ET today?" Option 0 MUST be Yes.
   Include market_ref: {"provider":"gemini","env":<env>,"event_ticker":<ticker>,
   "contract_symbol":<symbol>,"label":<label>,"implied_yes":<implied_yes or null>,
   "expiry":<expiry>}.
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
      "List active Gemini sandbox Crypto and Commodities markets with contracts that can be phrased as a yes/no forecast humans can answer. Sorted best-first.",
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
  decision: ReturnType<typeof sizeTrade>;
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
      const sizing = sizeTrade({
        crowdYesPct,
        responses,
        impliedYes: implied,
        buyYes: candidate.buy_yes,
        buyNo: candidate.buy_no,
        thresholdPts: args.threshold,
      });
      trade = {
        candidate,
        crowd_yes_pct: crowdYesPct,
        responses,
        implied_source: args.implied != null ? "override" : "market",
        implied_yes: implied,
        decision: sizing,
      };
      let order: OrderSpec | undefined;
      let placement: Awaited<ReturnType<typeof executeSandboxTrade>> | undefined;
      if (sizing.action !== "none") {
        order = buildOrder(candidate, sizing);
        placement = await executeSandboxTrade(order, candidate, { dryRun: args.dryRun });
        trade.order = order;
        trade.placement = placement;
      }
      const recorded = await recordTrade(questionId, candidate, sizing, order, placement, {
        crowdPct: crowdYesPct,
        marketPct: implied == null ? null : implied * 100,
        dryRun: args.dryRun,
      });
      if (!recorded) log(`Could not record market trade for question ${questionId}.`);
      return { text: JSON.stringify(trade, null, 2) };
    },
  });

  const user = `Find the best tradable Gemini sandbox market, ask people near Chou Hall
(lat ${CHOU.lat}, lng ${CHOU.lng}) for a yes/no crowd forecast relevant to it,
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
      const placement = trade.placement as { dry_run?: boolean; reason?: string; order_id?: string; status?: string } | undefined;
      const tag = placement?.dry_run
        ? `dry run: ${placement.reason}`
        : `sandbox order ${placement?.order_id ?? "?"} ${placement?.status ?? ""}`;
      lines.push(
        "",
        `Market: ${market}${src} · Humans: ${humans} → ${div} > ${args.threshold} → ` +
          `${trade.decision.action === "buy_yes" ? "BUY YES" : "BUY NO"} ${trade.order!.symbol} @${trade.order!.price} x${trade.order!.quantity} [${tag}]`,
      );
    }
  }
  return lines.join("\n");
}

type RecordSizing = ReturnType<typeof sizeTrade>;

async function recordTrade(
  questionId: string,
  candidate: Candidate,
  sizing: RecordSizing,
  order: OrderSpec | undefined,
  placement: Awaited<ReturnType<typeof executeSandboxTrade>> | undefined,
  values: { crowdPct: number; marketPct: number | null; dryRun: boolean },
) {
  try {
    const response = await fetch(`${aEyeApiUrl()}/api/questions/${encodeURIComponent(questionId)}/trades`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.A_EYE_TRADE_TOKEN ? { authorization: `Bearer ${process.env.A_EYE_TRADE_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        provider: "gemini",
        env: "sandbox",
        symbol: candidate.contract_symbol,
        side: sizing.action === "none" ? "none" : "buy",
        outcome: sizing.action === "buy_no" ? "no" : "yes",
        quantity: order?.quantity ?? "0",
        price: order ? Number(order.price) : 0,
        status: sizing.action === "none" ? "no_trade" : placement?.status ?? "dry_run",
        order_id: placement?.order_id ?? null,
        filled_quantity: placement?.filled_quantity ?? "0",
        avg_price: placement?.avg_price != null ? Number(placement.avg_price) : null,
        market_pct: values.marketPct,
        crowd_pct: values.crowdPct,
        edge_pts: sizing.divergence_pts,
        dry_run: values.dryRun || placement?.dry_run === true || sizing.action === "none",
        reason: placement?.reason ?? sizing.reason,
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch (error) {
    console.error(`Market trade persistence failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  }
}

export async function runQuestionMode(questionId: string, dryRun: boolean, log: (line: string) => void) {
  const response = await fetch(`${aEyeApiUrl()}/api/questions/${encodeURIComponent(questionId)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Could not fetch question ${questionId} (${response.status}).`);
  const results = await response.json() as Record<string, unknown>;
  const marketRef = results.market_ref as Record<string, unknown> | undefined;
  if (!marketRef || marketRef.provider !== "gemini") throw new Error("Question has no Gemini market_ref.");
  if (results.sealed === true) throw new Error(`Results for question ${questionId} are sealed.`);
  const symbol = String(marketRef.contract_symbol ?? "");
  const report = await listObservableMarkets({ questionMinutes: 0 });
  const candidate = report.candidates.find((item) => item.contract_symbol === symbol) ?? {
    env: "sandbox" as const,
    tradable: marketRef.env === "sandbox",
    event_ticker: String(marketRef.event_ticker ?? ""),
    event_title: "",
    contract_symbol: symbol,
    label: String(marketRef.label ?? ""),
    strike: { type: "above", value: "" },
    implied_yes: typeof marketRef.implied_yes === "number" ? marketRef.implied_yes : null,
    buy_yes: null,
    buy_no: null,
    expiry: typeof marketRef.expiry === "string" ? marketRef.expiry : null,
  };
  const implied = candidate.implied_yes ?? (typeof marketRef.implied_yes === "number" ? marketRef.implied_yes : null);
  const tally = Array.isArray(results.tally) ? results.tally as { option?: string; pct?: number }[] : [];
  const options = Array.isArray(results.options)
    ? results.options.filter((option): option is string => typeof option === "string")
    : tally.map((row) => String(row.option ?? ""));
  const requestedYesIndex = marketRef.yes_option_index;
  const yesIndex =
    typeof requestedYesIndex === "number" &&
    Number.isInteger(requestedYesIndex) &&
    requestedYesIndex >= 0 &&
    requestedYesIndex < options.length
      ? requestedYesIndex
      : Math.max(options.findIndex((option) => /^\s*yes\b/i.test(option)), 0);
  const crowdPct = Number(tally[yesIndex]?.pct ?? 0);
  const sizing = sizeTrade({
    crowdYesPct: crowdPct,
    responses: Number(results.responses ?? 0),
    impliedYes: implied,
    buyYes: candidate.buy_yes,
    buyNo: candidate.buy_no,
  });
  const order = sizing.action === "none" ? undefined : buildOrder(candidate, sizing);
  const placement = order ? await executeSandboxTrade(order, candidate, { dryRun }) : undefined;
  await recordTrade(questionId, candidate, sizing, order, placement, {
    crowdPct,
    marketPct: implied == null ? null : implied * 100,
    dryRun,
  });
  log(JSON.stringify({ question_id: questionId, candidate, sizing, placement }, null, 2));
}

export async function sandboxPositions(log: (line: string) => void) {
  const client = new GeminiRestClient();
  const [positions, orders] = await Promise.all([client.positions(), client.activeOrders()]);
  log(JSON.stringify({ positions, active_orders: orders }, null, 2));
}

export async function cancelAllSandboxOrders(log: (line: string) => void) {
  const client = new GeminiRestClient();
  const orders = await client.activeOrders();
  for (const order of orders) {
    const id = String(order.orderId ?? "");
    if (!/^\d+$/.test(id)) continue;
    await client.cancelOrder(id);
    log(`Cancelled sandbox order ${id}`);
  }
  if (!orders.length) log("No active sandbox orders.");
}
