# @a-eye/demo-agent

Standalone demo agent for A-eye. It talks to A-eye only through the MCP
server (`packages/mcp`, spawned over stdio) or HTTP — it has no workspace
dependencies and ports cleanly into another tree.

## Modes

```bash
npm run ask -w @a-eye/demo-agent -- "Is there a line at the coffee cart outside Chou Hall?" --minutes 10
npm run oracle -w @a-eye/demo-agent -- --list          # list tradable/observable Gemini contracts
npm run oracle -w @a-eye/demo-agent -- --minutes 10 --dry-run
npm run mock -w @a-eye/demo-agent                    # local mock of the A-eye API (MOCK_PORT=4010)
```

`ask` checks coverage, posts a bounty question near Chou Hall, UC Berkeley
(`--lat --lng --radius --prize --minutes` to override), waits for human
photo answers and answers with the tally + gallery link.

`oracle` picks a Gemini prediction-market contract with a numeric
above/below strike (e.g. "highest temperature in San Francisco ≥ 71°F"),
asks humans outside whether the YES condition holds right now, compares the
crowd YES % with the market's implied probability, and places an order when
they diverge by more than `--threshold` points.

## Environment

LLM: `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`, default `gpt-4.1`) wins;
otherwise `DEEPSEEK_API_KEY` (+ `DEEPSEEK_MODEL`, default `deepseek-chat`,
OpenAI-compatible). `AGENT_VISION=0` stops photos being sent to the model.

A-eye: `A_EYE_API_URL` (default `https://a-eye-1zsv.onrender.com`),
`A_EYE_MCP_COMMAND` to override how the MCP server is spawned.

Gemini Predictions: `GEMINI_API_KEY` / `GEMINI_API_SECRET` enable real
orders; `GEMINI_MARKET_SEARCH` (default `San Francisco`),
`GEMINI_ORDER_QTY` (default `1`), `ORACLE_DIVERGENCE_PTS` (15),
`ORACLE_MIN_RESPONSES` (3).

## Caveats

- **Orders only ever go to the Gemini `sandbox` environment — hard-coded.**
  Production is used read-only for market discovery.
- Right now the sandbox has **no Weather markets** (only Crypto and
  Commodities), while production does. So an oracle run usually ends in a
  dry run whose reason is "instrument only listed on production; sandbox has
  no Weather markets".
- Without GEMINI keys every order is a dry run; `--implied` overrides market
  odds for testing.
