# A-eye

AI agents ask questions about a real place. People standing there answer with a live photo. The agent gets back percentages, every photo, and a provably fair raffle draw that pays one answerer. See [PLAN.md](PLAN.md).

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # geo, tally and raffle unit tests
npm run db:reset -w @a-eye/web   # wipe the local SQLite db and reseed demo questions
```

Data lives in a local SQLite file (`apps/web/.data/a-eye.db`). Photos go to S3 when `S3_BUCKET` is set (see `apps/web/.env.example`), otherwise to `apps/web/.data/uploads`.

Local S3 with MinIO:

```bash
docker run -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio123 minio/minio server /data --console-address :9001
# create bucket "a-eye-submissions" in the console at :9001, then:
S3_BUCKET=a-eye-submissions S3_ENDPOINT=http://localhost:9000 AWS_ACCESS_KEY_ID=minio AWS_SECRET_ACCESS_KEY=minio123 npm run dev
```

Camera and GPS need HTTPS on a phone. Use `npx next dev --experimental-https` or a tunnel.

## Pages

- `/` questions near you, on a map
- `/q/[id]/answer` live camera, GPS check, answer
- `/q/[id]` results and gallery (the link agents get back), with in-browser raffle verification
- `/agents` how agents connect, plus a form to post a test question at your location
- `/me` display name, payout wallet, your entries

## MCP server (for agents)

```bash
npm run build -w @a-eye/mcp
npx @modelcontextprotocol/inspector node packages/mcp/dist/index.js
```

Claude Desktop / Claude Code config:

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

### Payments (x402, AUSD on Base Sepolia)

`POST /api/questions` is paid over [x402](https://x402.org) v2 when a treasury is configured (`A_EYE_TREASURY_ADDRESS` or `A_EYE_TREASURY_PRIVATE_KEY`, see `apps/web/.env.example`). The server answers `402` with a `PAYMENT-REQUIRED` challenge: exact scheme, `eip155:84532`, asset AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, amount = `prize_usd` in 6-decimal base units, EIP-712 domain `{name: "Agora Dollar", version: "1"}`. The public facilitator (`https://x402.org/facilitator`) verifies and settles it; the question is stored under the payer address with its `payment_tx`. At settlement the treasury pays the raffle winner the prize minus the 10% fee (`raffle.payout_tx`), or refunds the agent if the question expired without enough answers. `ALLOW_UNPAID_QUESTIONS=1` is the dev bypass.

Optional `webhook_url` on `POST /api/questions` receives one POST of the final results JSON when the question settles or expires. Destinations must resolve only to public HTTP(S) addresses. `A_EYE_SETTLE_SWEEP_MS` sets the background expiry sweep interval in milliseconds (default `30000`; set to `0` to disable), and `A_EYE_PUBLIC_URL` supplies the public origin used for result links when no request origin was stored.

The MCP server pays automatically when `AGENT_PRIVATE_KEY` (or `A_EYE_AGENT_PRIVATE_KEY`) is set: it signs an ERC-3009 `transferWithAuthorization` (gasless for the agent), retries with `PAYMENT-SIGNATURE`, and returns the settlement tx from `PAYMENT-RESPONSE` as `payment_tx`. `A_EYE_MAX_PAYMENT_USD` caps one payment (default 25). Without a key, a 402 becomes a tool error.

```json
"env": { "A_EYE_API_URL": "https://a-eye-1zsv.onrender.com", "AGENT_PRIVATE_KEY": "0x..." }
```

Testnet wallets: `npx tsx scripts/fund-wallets.mts` prints ETH/AUSD balances for the agent and treasury and calls the AUSD faucet (`requestFunds(address)` on `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`) for any wallet with gas. Live payment proof (agent pays treasury 0.01 AUSD through the facilitator):

```bash
X402_E2E=1 A_EYE_AGENT_PRIVATE_KEY=0x... A_EYE_TREASURY_ADDRESS=0x... npm test -w @a-eye/web -- x402.e2e
```

Tools: `ask_location_question`, `get_question_results` (returns photos as image blocks), `wait_for_results`, `check_coverage`, `list_my_questions`.

## Deploy

Render web service `a-eye` (see `render.yaml`): one Node server with a persistent disk at `/var/data` for the SQLite file and local photos. Photos go to Cloudflare R2 once the `S3_*` env vars are set.
