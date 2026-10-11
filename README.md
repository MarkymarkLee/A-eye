# A-eye

A-eye lets an AI agent ask a question about a real place. Nearby people answer with a fresh, geolocated photo; the agent receives the tally, evidence gallery, and a verifiable raffle result. See [PLAN.md](PLAN.md) for the project plan.

## Layout

- `apps/web`: Next.js 16 app, HTTP API, observer experience, and live dashboard.
- `packages/mcp`: stdio MCP server used by agents.
- `packages/shared`: shared request schemas and API types.
- `apps/demo-agent`: standalone ask and Gemini Predictions oracle demos.
- `apps/web/lib/store.ts`: SQLite schema, question/submission operations, settlement, and raffle.
- `scripts/xrpl-*.ts` and `apps/web/lib/xrpl.ts`: optional, standalone XRPL testnet demos.

## Develop

Requires Node.js 22.13 or newer for the built-in `node:sqlite`.

```bash
npx -y npm@11 install
npm run dev
npm run typecheck && npm test && npm run build
```

The web app is available at `http://localhost:3000`. SQLite defaults to `apps/web/.data/a-eye.db`; photos use `apps/web/.data/uploads` unless an S3-compatible store is configured. Reset the local database and its demo seed with `npm run db:reset -w @a-eye/web`.

Camera and geolocation require HTTPS on a phone. Use an HTTPS tunnel or the hosted demo. For local S3-compatible storage, MinIO can be started with Docker; set `S3_BUCKET`, `S3_ENDPOINT`, and the matching AWS-compatible credentials before running the app.

## Pages and API

- `/`: nearby open questions.
- `/q/[id]/answer`: answer a question with the in-app camera and location check.
- `/q/[id]`: results, evidence gallery, comparisons, and raffle details.
- `/live`: live event feed and dashboard; polls `GET /api/activity?since=&limit=`.
- `/agents`: agent setup information and a test-question form.
- `/me`: observer identity, payout wallet, entries, winnings, stats and badges.
- `/leaderboard`: observer rankings for the week or all time.
- `GET /api/questions`: open questions; `POST /api/questions`: create a question.
- `POST /api/questions/[id]/submissions`: submit a photo answer.
- `GET /api/questions/[id]`: question results.
- `GET /api/activity?since=<ISO>&limit=<n>`: counters, open questions, and recent activity events.

The activity feed settles questions whose deadline has passed when polled. Questions also close immediately when they reach `max_responses`.

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

## Bounty Credit Vault (XRPL Lending, Devnet)

The `/vault` page demonstrates an XRP credit pool that funds an AI agent's human-observer bounty. The agent borrows from an A-eye loan broker, escrows a bounty pot for the observer, repays the loan with interest, and the depositor redeems vault shares with yield at maturity.

| Role | Vault flow |
| --- | --- |
| A-eye broker | Creates the closed-ended vault, sets loan-broker terms, and provides cover. |
| Depositor | Deposits XRP during subscription and withdraws their shares at maturity. |
| Sponsor | Deposits alongside the depositor and stays invested after redemption. |
| AI agent / borrower | Co-signs the loan, funds the bounty escrow, and repays principal plus interest and fees. |
| Human observer | Receives the escrowed XRP bounty when the escrow is finishable. |

Run the end-to-end Devnet flow with:

```bash
npm run xrpl:vault
```

The script funds fresh broker, depositor, sponsor, borrower, and observer wallets, then saves their seeds to the ignored `.env.xrpl.local` file with mode `0600`. Keep that local file private; it is not part of the snapshot or commit. The script creates the vault, configures the broker and cover, deposits 20 XRP each from the depositor and sponsor during subscription, waits for the investment phase, opens a counterparty-signed loan, escrows and releases the observer bounty, repays and deletes the loan, and withdraws only the depositor's shares after redemption. The sponsor remains invested so the live vault continues to show the remaining assets and share price. It records the run at `apps/web/data/xrpl-vault-run.json` and prints a Devnet explorer link for every submitted transaction. Set `XRPL_LENDING_WSS` to override the Devnet WebSocket endpoint.

1. Create a closed-ended XRP vault and configure A-eye's loan broker and cover.
2. The depositor and sponsor each deposit 20 XRP during subscription; wait for the investment phase.
3. Counter-sign a 20 XRP loan, escrow 5 XRP for the observer, then release that bounty.
4. Repay the loan and close it; after redemption, withdraw only the depositor's shares while the sponsor stays in.

The flow requires `SingleAssetVault`, `LendingProtocol`, and `LendingProtocolV1_1`; the recipe is Devnet-only because these amendments are not enabled on XRPL Testnet. The vault must be closed-ended: an open vault does not permit the required loan-broker configuration. If the node is unreachable or any required amendment is disabled, the script prints the planned steps as a dry run and exits successfully without creating wallets or writing a snapshot.

The `/vault` page resolves data in this order: live validated-ledger data (four-second timeout), the committed run snapshot if live reads fail, then a simulated plan when the snapshot is invalid or absent. Set `XRPL_VAULT_LIVE=0` to force the recorded snapshot.

Latest committed Devnet run: the depositor withdrew **20,000,035 drops** from a **20,000,000-drop** deposit, for **35 drops of yield**. The sponsor remains invested with **20,000,035 drops** across **20,000,000 shares**, at a live share price of `1.00000175` drops per share.

| Step | Devnet transaction |
| --- | --- |
| Vault create | [EF636129](https://devnet.xrpl.org/transactions/EF63612970AD08408D70376D2D02A9278F3948F29198C6315456A9BECCD0F191) |
| Loan broker set | [B91F264C](https://devnet.xrpl.org/transactions/B91F264C35D132752B5F6AEA91CD7BC8910BFC421CFE4CAA1572B86334815ECB) |
| Cover deposit | [7D0A3D96](https://devnet.xrpl.org/transactions/7D0A3D965330EE974153EA974A37BD44132DEE0A059FEDC4BC73117CCC9F0007) |
| Depositor deposit | [F949E8EB](https://devnet.xrpl.org/transactions/F949E8EB000B33D2CC25869A3B14A7D3F95E9D47F93160D9A547E59C097C6256) |
| Sponsor deposit | [2D8CEED3](https://devnet.xrpl.org/transactions/2D8CEED32A785162446220BC0346B76D6FF57FFABE821E17E323CFDDA9A94574) |
| Counterparty-signed loan set | [82F77415](https://devnet.xrpl.org/transactions/82F77415FBA8FDE5CE2925F642A0797789B8343827164065870D7438C1223FE7) |
| Bounty escrow | [A1AD2944](https://devnet.xrpl.org/transactions/A1AD294476DC0B112776CE9E06AD6CB9CF16BC781F60F72D17DFBF8568B5E22B) |
| Bounty paid to observer | [7AED6F22](https://devnet.xrpl.org/transactions/7AED6F22AF805CF01A897569E31E2BD5139593DF2C675172E5410B8A5CA9C3DF) |
| Loan repayment | [064BDF7E](https://devnet.xrpl.org/transactions/064BDF7EE35AA5B78A5C99621EF4B31E3C36FADED219BBC9EDC7A05ED330299F) |
| Loan delete | [021E1E6C](https://devnet.xrpl.org/transactions/021E1E6C8858E42B23B7409F004636174CEB967DB1603F7B75AD9FA34FB2E382) |
| Vault withdraw | [6A29B073](https://devnet.xrpl.org/transactions/6A29B0735D21EF8E01EE33761929285EA5608150B5B671F86C1653E6B85B220E) |

## Demo agent

The demo agent uses the A-eye MCP server for questions and results. Its LLM needs `OPENAI_API_KEY` or `DEEPSEEK_API_KEY`; set `A_EYE_API_URL` to choose the server. Examples:

```bash
npm run ask -w @a-eye/demo-agent -- "Is there a line at the coffee cart outside Chou Hall?" --minutes 10
npm run oracle -w @a-eye/demo-agent -- --minutes 10 --dry-run
```

Oracle discovery reads Gemini sandbox and production markets, but order placement is hard-coded to the sandbox. Remove `--dry-run` only when Gemini sandbox credentials are configured and a sandbox order is intended. `npm run oracle -w @a-eye/demo-agent -- --list` lists observable contracts.

## Gemini Prediction Markets oracle

The oracle compares the local crowd's YES forecast with public Gemini prediction-market odds, then sizes any eligible trade and submits it only to Gemini's sandbox. Discovery currently targets Crypto and Commodities contracts.

```mermaid
flowchart LR
  AGENT["demo-agent oracle"] --> ODDS["Gemini public market odds"]
  ODDS --> QUESTION["A-eye question<br/>market_ref"]
  QUESTION --> HUMANS["Nearby human answers"]
  HUMANS --> RESULTS["Question results<br/>crowd YES %"]
  RESULTS --> SIZE["sizeTrade<br/>edge + bounded sizing"]
  SIZE --> ORDER["Gemini sandbox order"]
  ORDER --> CANCEL["Cancel unfilled remainder"]
  CANCEL --> RECORD["POST recorded trade to A-eye"]
  RECORD --> CARDS["/live + gallery<br/>Market vs Humans"]
```

Run against the hosted A-eye service:

```bash
A_EYE_API_URL=https://a-eye-1zsv.onrender.com npm run oracle -w @a-eye/demo-agent -- --minutes 10
```

Useful modes:

```bash
npm run oracle -w @a-eye/demo-agent -- --list
npm run oracle -w @a-eye/demo-agent -- --minutes 10 --dry-run
npm run oracle -w @a-eye/demo-agent -- --question <question-id>
npm run oracle -w @a-eye/demo-agent -- --question <question-id> --dry-run
npm run oracle -w @a-eye/demo-agent -- --positions
npm run oracle -w @a-eye/demo-agent -- --cancel-all
```

Configure `GEMINI_API_KEY` and `GEMINI_API_SECRET` for sandbox trading. Private requests use the sandbox API and the `primary` account by default; set `GEMINI_ACCOUNT` to override it. Set `A_EYE_API_URL` to select the A-eye server, and `A_EYE_TRADE_TOKEN` only when that server requires a bearer token for trade recording. Never put Gemini credentials in logs or source control.

Sizing and exposure controls:

| Control | Default | Maximum / behavior |
| --- | ---: | --- |
| Crowd divergence threshold (`ORACLE_DIVERGENCE_PTS`) | 15 points | Must also meet the minimum-response requirement |
| Minimum responses (`ORACLE_MIN_RESPONSES`) | 3 | No trade below this count |
| Minimum edge (`ORACLE_MIN_EDGE`) | 0.03 | No trade below this probability edge |
| Bankroll / Kelly fraction | $20 / 0.25 | Used to calculate a conservative stake |
| Maximum contracts (`ORACLE_MAX_CONTRACTS`) | 10 | Hard ceiling: 50 contracts |
| Maximum notional (`ORACLE_MAX_NOTIONAL_USD`) | $5 | Hard ceiling: $25 |
| Fixed quantity (`GEMINI_ORDER_QTY`) | unset | Still bounded by both hard ceilings |
| Limit price | — | Rounded to cents and clamped to $0.01–$0.99 |
| Fill wait (`ORACLE_FILL_WAIT_S`) | 10 seconds | Cancel any unfilled remainder afterward |

Other sizing inputs are `ORACLE_BANKROLL_USD` (default `$20`), `ORACLE_PRIOR_WEIGHT` (default `5`), and `ORACLE_KELLY_FRACTION` (default `0.25`). Oracle-generated trades, including dry runs and no-trade decisions, are posted to the question's trade endpoint for the comparison cards.

Sample output excerpt from a real local sandbox run:

```json
{
  "question_id": "b8770c0bb5",
  "candidate": {
    "env": "sandbox",
    "tradable": true,
    "contract_symbol": "GEMI-SOL2610112200-HI109",
    "implied_yes": 0.415,
    "buy_yes": 0.47
  },
  "sizing": {
    "action": "buy_yes",
    "divergence_pts": 58.5,
    "fair_yes": 0.7075,
    "edge": 0.2375,
    "limit_price": "0.47",
    "quantity": "4",
    "notional": 1.88
  },
  "placement": {
    "dry_run": false,
    "order_id": "145853902277410438",
    "status": "filled",
    "filled_quantity": "4",
    "cancelled_remainder": false
  }
}
```

### Push notifications

Observers can opt in to "new question near you" web push (installable PWA + `/sw.js`). Generate VAPID keys once with `npm run vapid:keys` and set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` on Render — with none set, push is a silent no-op. Subscriptions are stored server-side with a coarse (~110 m) location, and one subscription hears about at most one question every 3 minutes (`PUSH_MIN_INTERVAL_SECONDS`).

## Deploy

The Render service is [`https://a-eye-1zsv.onrender.com`](https://a-eye-1zsv.onrender.com) (configuration in `render.yaml`). It runs as one Node server and mounts a persistent disk at `/var/data` for SQLite and local uploads. Render currently sets `ALLOW_UNPAID_QUESTIONS=1`; configure a treasury and disable that flag to demonstrate x402 payments. Configure the `S3_*` environment variables to store photos in Cloudflare R2 instead of on the Render disk.

### Production runbook

`/api/health` reports `ok`, `service`, `network`, `asset`, `commit`, and `checks` for the database, disk capacity, and photo storage. Only a database failure returns 503; disk or R2 issues are reported without restarting the service.

Deploys cause roughly 1–2 minutes of downtime: disk-backed services stop the old instance before the new one boots, and Render's disk detach/attach takes about 45–60 seconds of that window. `next start` itself is ready in under a second. **Don't merge to main during the demo / judging window.** Visitors who have loaded the site before the deploy see the service worker's “A-eye will be right back” page, which reloads automatically when the service is reachable.

Run `npm run db:backup` from a Render Shell, or SSH to `srv-db5udjp42hec73a8cu0g@ssh.oregon.render.com` and run it in `/opt/render/project/src` (SSH requires a key on the Render account). List backups with `npm run db:backups`. Restore with `npm run db:restore -- backups/<file>`, then restart the service using the dashboard's “Restart service” action or `curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services/srv-db5udjp42hec73a8cu0g/restart`. The previous database is kept as `a-eye.db.pre-restore-<ts>`.

## Architecture

```mermaid
flowchart LR
  AGENT["AI agent<br/>Claude / apps/demo-agent"] --> MCP["MCP server<br/>packages/mcp · @x402/fetch auto-pay"]
  MCP -->|"POST /api/questions"| API["Next.js API<br/>apps/web · x402 gate when paid mode is enabled"]
  API -->|"verify and settle payment"| FACILITATOR["x402.org facilitator"]
  FACILITATOR -->|"AUSD payment tx to treasury"| BASE["Base Sepolia AUSD"]
  API <-->|"questions, photos, raffles"| SQLITE["SQLite<br/>Render persistent disk"]
  OBSERVER["Observer mobile web app<br/>in-app camera + geolocation"] -->|"POST submissions"| API
  API -->|"geo, freshness, duplicate-hash checks"| CHECKS["Accepted submissions"]
  API -->|"S3-compatible storage when configured"| R2["Cloudflare R2<br/>local disk fallback"]
  API --> ENRICH["Nominatim + Context.dev<br/>place lookup and web_baseline"]
  API --> ELEVEN["ElevenLabs TTS/STT proxy endpoints"]
  LIVE["/live dashboard"] -->|"polls GET /api/activity"| API
  API --> SETTLE["settle()"]
  SETTLE --> ENTROPY["Latest Base Sepolia block hash"]
  ENTROPY --> RAFFLE["Provably fair raffle"]
  RAFFLE -->|"AUSD payout or refund"| BASE
  ORACLE["demo-agent oracle mode"] <--> GEMINI["Gemini Predictions<br/>market discovery + sandbox orders"]
  ORACLE --> MCP
  XRPLS["Optional XRPL testnet scripts"] --> XRPL["RLUSD trustlines/payments<br/>XRP escrow · observer credentials"]
```

The Gemini oracle attaches `market_ref` (provider, contract, `implied_yes`) to each question; the gallery and `/live` show live odds, the crowd comparison, and recorded sandbox trades. The answer flow reads questions aloud and accepts spoken answers through the ElevenLabs TTS/STT proxy routes. XRPL helpers are a separate testnet demo, not part of the AUSD question-settlement path: RLUSD payments require a destination trustline, the escrow pot is XRP, and credential issuance/acceptance are separate operations.

## 3-minute demo runbook

**Before the clock:** For a paid demo, fund the Base Sepolia agent and treasury wallets, configure the agent's AUSD wallet and server treasury, and turn off Render's `ALLOW_UNPAID_QUESTIONS=1`. Open [`/live`](https://a-eye-1zsv.onrender.com/live) on the projector and have judges scan its QR code. If payment setup is unavailable, leave unpaid mode on and explain that no payment transaction or payout is expected. Don't merge to main within ~5 minutes of or during the demo: every deploy takes the site down for 1–2 minutes.

| Time | Demo step | Fallback |
| --- | --- | --- |
| 0:00–0:30 | Check the projector dashboard and judge phones. Confirm the question agent has its LLM key and can reach the configured MCP server. | If the agent cannot run, post a test question from `/agents`; if phones cannot scan the QR, share the question or answer URL directly. |
| 0:30–1:00 | Ask the live question with the documented command: `npm run ask -w @a-eye/demo-agent -- "Is there a line at the coffee cart outside Chou Hall?" --minutes 10`. Watch the question and, in paid mode, its payment transaction appear on `/live`. | For a shorter rehearsal, use `--minutes 1`. If the agent wallet is unavailable, use the unpaid dev mode. |
| 1:00–1:45 | Judges answer with fresh photos. Show the submissions arriving on `/live` and the evidence gallery at `/q/<id>`. | If camera or location permission fails, use another HTTPS-enabled phone; otherwise use the seeded sample gallery to explain the evidence view. |
| 1:45–2:15 | Let the question reach its response cap or deadline. The activity poll settles a question after its deadline; the gallery shows the tally and any available “Web says / Humans say” or “Market vs Humans” comparison. | If the timer has not elapsed, reach the configured response cap or continue with a settled sample question. The market comparison appears only for questions asked with a `market_ref` (oracle mode). |
| 2:15–2:35 | Reveal the raffle on `/live`; open `/q/<id>` and run the “Verify it yourself” snippet against the revealed seed, block hash, and submission IDs. | If the network entropy RPC is offline, the draw uses the disclosed `offline:<hash>` fallback entropy and remains reproducible. |
| 2:35–2:45 | Show the payout transaction on BaseScan when the question was paid, the winner has an EVM wallet, and the treasury is funded. | With no winner wallet or a failed/unfunded transfer, payout remains pending; use unpaid mode only to demo the raffle, not an on-chain payout. |
| 2:45–3:00 | Run the Gemini oracle: `npm run oracle -w @a-eye/demo-agent -- --minutes 10 --dry-run`. It compares a market with crowd YES answers and reports a sandbox-order decision. | If Gemini has no observable candidate or credentials, run `npm run oracle -w @a-eye/demo-agent -- --list` and describe the sandbox-only order path; keep `--dry-run` for a safe demo. |

The oracle command uses `--dry-run` for safety. Remove that flag only for an intentionally placed Gemini sandbox order.
