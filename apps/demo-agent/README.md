# @a-eye/demo-agent

Standalone demo agent for A-eye. It talks to A-eye only through the MCP
server (`packages/mcp`, spawned over stdio) or HTTP — it has no workspace
dependencies and ports cleanly into another tree.

## Modes

```bash
npm run ask -w @a-eye/demo-agent -- "Is there a line at the coffee cart outside Chou Hall?" --minutes 10
npm run oracle -w @a-eye/demo-agent -- --list          # list tradable/observable Gemini contracts
npm run oracle -w @a-eye/demo-agent -- --minutes 10 --dry-run
npm run oracle -w @a-eye/demo-agent -- --question <id> # evaluate existing results without an LLM
npm run oracle -w @a-eye/demo-agent -- --positions      # show sandbox positions and active orders
npm run oracle -w @a-eye/demo-agent -- --cancel-all     # cancel active sandbox orders
npm run mock -w @a-eye/demo-agent                    # local mock of the A-eye API (MOCK_PORT=4010)
```

`ask` checks coverage, posts a bounty question near Chou Hall, UC Berkeley
(`--lat --lng --radius --prize --minutes` to override), waits for human
photo answers and answers with the tally + gallery link.

`oracle` chooses an active Gemini sandbox Crypto or Commodities contract
with enough time remaining, asks a yes/no crowd-forecast question, compares
human YES responses with live market odds, sizes an order, and records the
result on A-eye. `--question <id>` skips LLM question generation, refreshes
odds for an existing market-linked question, evaluates its results, and
records the trade. Every order is sandbox-only.

## Environment

LLM: `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`, default `gpt-4.1`) wins;
otherwise `DEEPSEEK_API_KEY` (+ `DEEPSEEK_MODEL`, default `deepseek-chat`,
OpenAI-compatible). `AGENT_VISION=0` stops photos being sent to the model.

A-eye: `A_EYE_API_URL` (default `https://a-eye-1zsv.onrender.com`),
`A_EYE_MCP_COMMAND` to override how the MCP server is spawned.

Gemini Predictions: `GEMINI_API_KEY` / `GEMINI_API_SECRET` enable real
sandbox orders; `GEMINI_ACCOUNT` defaults to `primary`,
`GEMINI_ORDER_QTY` optionally fixes order quantity, and
`A_EYE_TRADE_TOKEN` optionally authenticates trade-recording requests.

Oracle sizing: `ORACLE_DIVERGENCE_PTS` (15),
`ORACLE_MIN_RESPONSES` (3), `ORACLE_PRIOR_WEIGHT` (5),
`ORACLE_MIN_EDGE` (0.03), `ORACLE_BANKROLL_USD` (20),
`ORACLE_KELLY_FRACTION` (0.25), `ORACLE_MAX_CONTRACTS` (10),
`ORACLE_MAX_NOTIONAL_USD` (5), and `ORACLE_FILL_WAIT_S` (10). The hard
upper bounds are 50 contracts and $25 notional, regardless of configuration.

## Caveats

- **Orders only ever go to the Gemini `sandbox` environment — hard-coded.**
  Production is used read-only for market discovery and odds display.
- With no Gemini credentials, `--dry-run`, or no tradable sandbox candidate,
  the oracle records a dry-run result instead of placing an order.
- Without GEMINI keys every order is a dry run; `--implied` overrides market
  odds for testing.
