# MCP and payments

Connecting agents over MCP, x402 over MCP, and AUSD on Base Sepolia.

## MCP

Install dependencies and build the stdio server:

```bash
npx -y npm@11 install && npm run build -w a-eye-mcp
npx @modelcontextprotocol/inspector -e A_EYE_API_URL=http://localhost:3000 node packages/mcp/dist/index.js
```

The standalone package is `a-eye-mcp`; install it with `npx -y a-eye-mcp`. It defaults to the hosted A-eye API. Hosted Streamable HTTP MCP is also available at `https://a-eye-1zsv.onrender.com/mcp`.

Claude Code can connect to the hosted MCP server through the repository plugin marketplace:

```text
/plugin marketplace add PeytonLi/A-eye
/plugin install a-eye@a-eye
```

For local stdio configuration, `args` must be the absolute path to `packages/mcp/dist/index.js`. The same `mcpServers` JSON works for Claude Desktop (`claude_desktop_config.json`), Claude Code (`.mcp.json` in the project), and Cursor (`.cursor/mcp.json` or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "a-eye": {
      "command": "node",
      "args": ["/path/to/A-eye/packages/mcp/dist/index.js"],
      "env": { "A_EYE_API_URL": "https://a-eye-1zsv.onrender.com" }
    }
  }
}
```

### Hosted MCP (Streamable HTTP)

The web app serves the same MCP tools at `/mcp` (`https://a-eye-1zsv.onrender.com/mcp`). The route builds the tools with the same `createServer` factory as the stdio server and dispatches API calls in-process to the Next route handlers, so there is no HTTP round trip to itself. Each request gets a fresh stateless server and transport (no `mcp-session-id`). Legacy SSE isn't served; SSE-only clients can bridge with `npx mcp-remote https://a-eye-1zsv.onrender.com/mcp`. `/agents` has one-click links and copyable configs.

```bash
claude mcp add --transport http a-eye https://a-eye-1zsv.onrender.com/mcp
```

- Cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=a-eye&config=<base64 of {"url":"https://a-eye-1zsv.onrender.com/mcp"}>`
- VS Code: `vscode:mcp/install?<url-encoded {"name":"a-eye","type":"http","url":"https://a-eye-1zsv.onrender.com/mcp"}>`
- Windsurf (`~/.codeium/windsurf/mcp_config.json`): `{"mcpServers":{"a-eye":{"serverUrl":"https://a-eye-1zsv.onrender.com/mcp"}}}`
- Claude.ai: Customize > Connectors > Add custom connector, paste the URL, choose No sign in. ChatGPT: enable developer mode, add a custom MCP server with the URL and No authentication.
- Claude Desktop: download `/downloads/a-eye.mcpb` from `/agents` (built by `npm run build -w a-eye-mcp` with `@anthropic-ai/mcpb`), or use the `npx -y a-eye-mcp` config above.

**Identity (no sign-up).** `list_my_questions` returns questions stored under the caller's agent id, resolved per request: a non-empty trimmed `x-a-eye-agent` header (max 64 chars), then `Authorization: Bearer <key>`, then `?key=<key>`; keys become `key:<first 24 hex chars of sha256(key)>` (the raw key is never stored). If none is supplied, the fallback is `anon:<first 16 hex chars of sha256(client IP)>`. Paid questions are stored under the same id, so they show up in `list_my_questions`.

**Rate limit.** `A_EYE_MCP_RATE_LIMIT` requests per minute per client IP (default 60, `0` disables). Over the limit, `/mcp` returns HTTP 429 with `Retry-After` and a JSON-RPC error.

**Payments over MCP (x402).** With `ALLOW_UNPAID_QUESTIONS=1`, `ask_location_question` and `peek_results` run free. Otherwise the remote endpoint follows the [x402 MCP transport](https://github.com/coinbase/x402/tree/main/typescript/packages/mcp) (`@x402/mcp`):

1. The first call returns a tool result with `isError: true`, `structuredContent` = the x402 `PaymentRequired` object (`x402Version`, `accepts`: exact AUSD on `eip155:84532`), and the same JSON as the first text block (plus a human-readable hint).
2. The client signs the payment and retries the same tool call with the `PaymentPayload` in `params._meta["x402/payment"]`.
3. The server verifies and settles through the facilitator (the same `withX402Payment` path as `POST /api/questions`) and returns the result with the settlement receipt in `_meta["x402/payment-response"]`.

With `@x402/mcp`, `wrapMCPClientWithPayment(client, x402Client)` handles this automatically. Register `ExactEvmScheme` for `eip155:84532` and allow AUSD with `setSpendControls`, since AUSD isn't a default x402 token. The stdio server keeps paying over HTTP with `AGENT_PRIVATE_KEY`.

Tools include `ask_location_question`, `get_question_results` (with photos as image blocks), `peek_results` (paid interim results), `wait_for_results`, `compare_market` (live Gemini odds vs the crowd with recorded sandbox trades), `check_coverage`, and `list_my_questions`. Each evidence item carries `observer_reputation` — the observer's agreement rate with the crowd on past closed questions plus their answer count — so agents can weight answers.

Option strings must be distinct, and `prize_usd` must be from 0.01 to 500. Without a wallet, questions are stored under `A_EYE_AGENT_LABEL` (default `mcp-agent`); on an unpaid server, set a unique label or `list_my_questions` shows every unpaid MCP agent's questions. Paying agents are identified by their wallet address. `A_EYE_MCP_MAX_IMAGES` caps attached evidence images (default 8), and `wait_for_results` accepts `timeout_s` from 0 to 1800 seconds.

### Payments: x402 and AUSD on Base Sepolia

When a treasury is configured and unpaid mode is disabled, `POST /api/questions` uses [x402](https://x402.org) v2. It requests an exact payment in AUSD on `eip155:84532`, with the amount derived from `prize_usd`. The x402 facilitator verifies and settles the payment to the treasury; the question records the payer and payment transaction. Treasury payouts and refunds use the facilitator by default, so the treasury does not need Base Sepolia ETH for gas. Set `A_EYE_PAYOUT_RAIL=direct` to try direct transfers instead; if facilitator settlement fails, the service also falls back to a direct transfer, which does require treasury ETH. At settlement, the treasury pays the raffle winner 90% of the gross pot, or refunds a paid question that expires without enough answers. `ALLOW_UNPAID_QUESTIONS=1` bypasses question and peek payment challenges.

While a question is open and paywalling is active, the free results API and gallery hide the tally and evidence to prevent herding. Agents can call `GET /api/questions/:id/peek` or the MCP `peek_results` tool to pay for interim results. `A_EYE_PEEK_PRICE_USD` sets the AUSD price (default `$0.02`; set it to `0` to disable the paywall). Paid peek fees add to the gross raffle pot, and the winner receives 90% of the prize plus peek revenue, rounded to cents. Final results are free after close. If a question expires, only its original prize is refunded; peek fees remain with the treasury.

Optional `webhook_url` on `POST /api/questions` receives one POST of the final results JSON when the question settles or expires. Destinations must resolve only to public HTTP(S) addresses. `A_EYE_SETTLE_SWEEP_MS` sets the background expiry sweep interval in milliseconds (default `30000`; set to `0` to disable), and `A_EYE_PUBLIC_URL` supplies the public origin used for result links when no request origin was stored.

The MCP server can pay automatically when `AGENT_PRIVATE_KEY` or `A_EYE_AGENT_PRIVATE_KEY` is set. It signs an ERC-3009 authorization, retries the request with the x402 payment header, and returns the facilitator transaction as `payment_tx`. `A_EYE_MAX_PAYMENT_USD` caps an agent payment (default 25). Without a wallet, a paid question request fails with a payment error.

```json
"env": {
  "A_EYE_API_URL": "https://a-eye-1zsv.onrender.com",
  "AGENT_PRIVATE_KEY": "0x..."
}
```

For testnet wallet funding and balances, run `npx tsx scripts/fund-wallets.mts`. A live x402 integration test is available with `X402_E2E=1` in `apps/web/lib/x402.e2e.test.ts`; it requires funded test wallets and treasury configuration.
