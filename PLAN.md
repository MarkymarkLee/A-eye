# A-eye — Plan: crowdsourced, location-verified answers for AI agents

## Context
AI agents can search the web, but they can't see what's happening at a physical place right now ("Is there a line at the coffee cart?", "Is the park flooded?", "Is this store open?"). A-eye lets an agent ask a question tied to a location through an **MCP server**. People nearby get the question in a **mobile web app (PWA)**, take a photo **in the app**, and answer. We check their GPS and the photo. Once enough answers come in, the agent gets back **the percentage for each answer, how many people answered, and a link to a gallery of all photos**. Everyone with a verified answer is entered in a **raffle for a fixed prize**, which the agent pays for when it asks the question.

The build is a hackathon MVP for **B@BHacks 2.0**. The judges reward technical novelty, creativity, functionality and social proof. They penalize thin backends and hard-coded functionality. We can enter one General track plus any number of sponsor tracks, so each sponsor is wired in where it fits the product naturally.

### Sponsor fit (from `~/Downloads/B@BHacks 2.0 Tracks + Judges _ Notion.pdf`)
| Track | How A-eye uses it | Tier |
|---|---|---|
| **General: Most Creative** (or Technical) | Core product: agents hire nearby humans as "eyes" | Core |
| **AUSD + x402** ($1.5k) | Agents pay the question bounty per request through **x402 (HTTP 402)** in **AUSD on Base Sepolia** using ERC-3009 gasless transfers. The raffle winner is paid in AUSD. | Core |
| **YZi Labs** ($1.5k + EASY interview) | "Agents that transact and can be trusted" + "Agent wallets". Any chain is allowed, so we enter the same project with no extra work. | Free |
| **Gemini Prediction API** ($1.5k) | "Human oracle" demo agent: it finds a Gemini prediction market that people on the ground can observe (e.g. weather), asks the crowd, compares the human % with market odds, and places a **sandbox** trade. | Core-stretch |
| **Context.dev** ($750) | Adds place context to each question (what business or POI is here, hours, site), and a **"web says X / humans say Y"** baseline so agents see when the web is stale | Stretch 1 |
| **ElevenLabs** ($250) | Reads the question aloud (TTS) and accepts spoken answers (STT) so people can answer hands-free while walking | Stretch 1 |
| **Ripple XRPL** ($1.5k) | Optional second payout rail: **RLUSD** on XRPL testnet, the raffle pot held in **XRPL Escrow**, and an **XRPL Credential** issued to verified observers | Stretch 2 |

## Architecture
```
 AI agent (Claude Code / Desktop / demo agent)
        │  MCP (stdio)
        ▼
 packages/mcp  ── x402-fetch + agent wallet (AUSD, Base Sepolia) ──►  apps/web  /api/* (Next.js, one Node server)
                                                                     │   ├─ x402 middleware (pay-per-question)
 Humans (phone browser, PWA) ─── HTTPS ─────────────────────────────►│   ├─ submission checks (geo + time + dup)
                                                                     │   ├─ close + raffle + payout (on read + on max_responses)
                                                                     ▼
                                     SQLite (node:sqlite, local file) · S3 bucket for photos
                                     Chains: Base Sepolia (AUSD) · [XRPL testnet]
                                     APIs: Context.dev · ElevenLabs · Gemini Predictions sandbox
```

### Hosting
SQLite is a local file, so the app runs as **one long-running Node server**, not serverless (no Vercel). For dev and the demo, run it on a laptop and expose it over HTTPS with a tunnel (phones need HTTPS for camera and GPS). If we need it always on, deploy the same server to a host with a persistent disk (Fly.io volume, Railway volume, Render disk, or a small VM). Photos are in S3 either way.

### Monorepo layout (npm workspaces, TypeScript everywhere)
- `apps/web`: Next.js 16 (App Router) + Tailwind v4 + MapLibre (CARTO basemap tiles); PWA manifest (service worker later). Hosts both the human UI and the HTTP API.
- `packages/mcp`: stdio MCP server (`@modelcontextprotocol/sdk`). The agent runs it with `AGENT_PRIVATE_KEY` and `A_EYE_API_URL`. It calls the API through `x402-fetch` (viem wallet), so payment happens without the agent having to do anything extra.
- `packages/shared`: zod schemas and types shared by the API and the MCP server (question, results, submission).
- `apps/demo-agent`: a Claude agent script (Anthropic SDK tool-runner) that connects to the A-eye MCP and the Gemini Predictions MCP/SDK for the "human oracle" demo.
- `apps/web/lib/store.ts`: SQLite schema (created on boot) and queries. `apps/web/lib/storage.ts`: S3 photo storage (MinIO via `S3_ENDPOINT` locally; falls back to `.data/uploads` when `S3_BUCKET` is unset).

## Data model (SQLite, photos in S3)
No PostGIS: location is `lat`/`lng` columns with an index, filtered by bounding box in SQL and exact great-circle distance in code. JSON fields are stored as text. Photos are private S3 objects, and results return presigned URLs (1 hour).
- `observers(id, display_name, evm_address, created_at)`: the person answering. Identity is a cookie for now; add `xrpl_address`, `payout_rail` with Stretch 2.
- `agents(id, wallet_address unique, label, created_at)`: created on first paid request, keyed by the x402 payer address (milestone 3; today questions carry an `agent_label`).
- `questions(id, agent_label, prompt, options json[2..6], allow_free_text, place_label, lat, lng, radius_m, prize_amount, currency, min_responses, max_responses, closes_at, created_at, status open|closed|settled|expired, seed, seed_commit, web_baseline json)`, indexed on `(lat, lng)` and `(status, closes_at)`. To add later: `payment_tx`, `place_context`, `market_ref`.
- `submissions(id, question_id, observer_id, option_index, free_text, image_key, image_sha256 unique, lat, lng, accuracy_m, distance_m, captured_at)`, with unique `(question_id, observer_id)`. Rejected attempts are returned to the user but not stored.
- `raffles(question_id pk, seed_reveal, entropy_block_hash, entropy_block_number, winner_submission_id, payout_tx)`

## MCP server tools (`packages/mcp/src/index.ts`)
1. `ask_location_question({ lat, lng, radius_m=150, question, options[], allow_free_text?, prize_usd=1, min_responses=3, max_responses=20, closes_in_minutes=30 })`: POSTs `/api/questions`, which returns 402. x402-fetch signs an ERC-3009 AUSD authorization, retries, and the call returns `{ question_id, payment_tx, gallery_url, place_context, web_baseline }`.
2. `get_question_results({ question_id, include_images=true })`: returns `{ status, responses, tally: [{option, count, pct}], gallery_url, evidence: [{ answer, free_text, image_url, distance_m, captured_at }], web_baseline, raffle: {winner, payout_tx, seed_commit, seed_reveal} }`. When `include_images` is set, the tool also returns the photos (downscaled to about 512 px) as **MCP `image` content blocks** paired with each answer. A multimodal agent can then look at the evidence and check the percentages itself, not just follow a link.
3. `wait_for_results({ question_id, timeout_s })`: long-polls until the question closes or the timeout hits, then returns the same results. This lets the agent block without busy-looping.
4. `check_coverage({ lat, lng })`: number of observers active nearby in the last N minutes, so the agent knows whether asking is likely to work.
5. `list_my_questions()`

Also expose the same endpoints as plain REST with x402 (any HTTP agent can pay), plus an optional `webhook_url` that is called when a question closes.

## Human app (`apps/web`)
- `/`: map of open questions near you (browser geolocation, bounding-box query plus haversine distance, polling for new questions), with prize and time left on each pin. A QR code on the demo slide links here.
- `/q/[id]/answer`: the question (with 🔊 ElevenLabs TTS), place context, **in-app camera only** (`getUserMedia` → canvas → JPEG; no gallery uploads), option buttons, optional 🎙️ voice answer (ElevenLabs STT). On submit the app sends the image, `{lat,lng,accuracy}` from `watchPosition`, and `captured_at`.
- `/q/[id]`: public **gallery and results page** (the link returned to agents). Live tally bars (polling), photo grid, web-vs-human comparison, the raffle seed commit and reveal, and the payout tx link.
- `/me`: identity is a browser cookie for now, set the payout wallet (EVM address, optionally XRPL), list my entries and winnings.

## Submission checks (`apps/web/app/api/questions/[id]/submissions/route.ts`)
**No AI judging.** Humans are the source of truth. A-eye only checks that the person was actually there. The **asking agent** gets every photo next to every answer, so it can audit the evidence itself.
1. An observer identity is required (cookie today), one submission per observer per question, and the question must be open.
2. **Geo checks**: `accuracy_m ≤ 75`, `distance(submission, question) ≤ radius_m + accuracy_m`, `|captured_at − server_now| ≤ 2 min`. If a check fails, the submission is rejected with a clear message ("you're 420 m away"). The server stores the distance for the gallery.
3. **Proof of capture**: in-app camera only (no file picker), with a SHA-256 hash of the image bytes stored so duplicate photos are rejected, plus the capture timestamp and distance shown on each photo.
4. The image is uploaded to S3 and the row is inserted. Once `max_responses` is reached, the question is closed.
Limitation to state honestly: browser GPS can be spoofed. The in-app-only camera, the timestamp window and duplicate-hash checks raise the cost of cheating, and the agent can see the photos to judge for itself. A production version would add device attestation and reputation scores.

## Close → tally → raffle → payout (`settle()` in `apps/web/lib/store.ts`)
Runs when any request touches a question whose `closes_at` has passed, and when `max_responses` is reached. A conditional `UPDATE ... WHERE status = 'open'` claims the question, so a winner is never drawn twice. Add a `setInterval` sweep in the server if questions need to close with no traffic.
- Close a question when `closes_at` has passed or `max_responses` is reached. Tally every **accepted** (geo-verified) submission. If `min_responses` isn't met, refund the agent (AUSD transfer back) and mark the question `expired`.
- **Provably fair raffle**: when the question is created, generate `server_seed` and store `seed_commit = sha256(seed)`. At close, `winner = H(seed ‖ latest Base Sepolia block hash ‖ question_id) mod N` over accepted submissions sorted by id. Reveal the seed and block hash on the gallery page so anyone can recheck the draw (include a "verify" snippet).
- **Payout**: the treasury wallet (viem) transfers `prize_amount × (1 − 10% platform fee)` AUSD to the winner's `evm_address` on Base Sepolia, and the tx hash is stored. Stretch 2: if `payout_rail = xrpl`, pay RLUSD on XRPL testnet instead. The pot is locked in an XRPL `EscrowCreate` at question creation and released with `EscrowFinish` to the winner. Issue an XRPL `CredentialCreate` "A-eye Verified Observer" after 3 accepted submissions.

## Sponsor integrations, concretely
- **x402 + AUSD**: `apps/web/proxy.ts` (Next 16's name for middleware) uses the x402 Next middleware on `POST /api/questions` with a dynamic price equal to the requested prize. Asset: the AUSD contract on Base Sepolia (address from the Agora deployments docs; use the Agora Docs MCP). **Hour-1 risk check**: confirm the x402 facilitator accepts AUSD as a custom ERC-3009 asset on Base Sepolia. If it doesn't, write a small self-hosted verifier that checks and submits the `transferWithAuthorization` ourselves. Get faucet AUSD for the agent and treasury wallets.
- **Context.dev** (`lib/context.ts`): when a question is created, run a reverse lookup or search for the coordinates and nearby POI (name, hours, website), and ask the Answers API the question itself. Store both as `place_context` and `web_baseline`, then show them to humans and return them to the agent.
- **ElevenLabs** (`app/api/tts`, `app/api/stt`): server-side proxy so the key stays secret. TTS for the question, STT for free-text answers.
- **Gemini Predictions** (`apps/demo-agent`): the agent lists sandbox markets (`@gemini-markets/sdk`), picks one that can be observed near us (weather, an event), asks A-eye, waits, compares the human % with the implied odds, and places a sandbox order if they diverge. The market id is stored in `questions.market_ref`, and the gallery page shows "Market: 62% · Humans: 85%".

## Build order (hackathon milestones)
0. ~~Copy this plan into the repo and commit it.~~ Done.
1. **Skeleton**: ~~npm workspaces, local SQLite database, S3 photo storage, shared zod schemas.~~ Done. Still to do: HTTPS tunnel or persistent-disk host so phones can reach it.
2. **Core loop without payments (~4h)**: ~~create-question API, map, answer page with camera and geo, submission checks (geo, time window, duplicate hash), live gallery, raffle with Base Sepolia block entropy.~~ Done. Still to do: MCP server (`ask`/`get`/`wait`). Test end to end with MCP Inspector and a real phone.
3. **Money (~3h)**: x402 + AUSD on question creation, treasury wallet, AUSD payout, refunds for expired questions.
4. **Demo agent + Gemini (~2h)**.
5. **Stretch 1 (~2h)**: Context.dev enrichment and ElevenLabs voice.
6. **Stretch 2 (~3h)**: XRPL RLUSD payout rail, Escrow, Credentials.
7. **Polish and social proof**: seed real questions around the venue, get other hackers to answer (judges count traction), record a backup demo video, write the README with an architecture diagram.

## What we need to run it
Everything is set through `apps/web/.env.local` (template: `apps/web/.env.example`) unless noted. Items marked **confirm** still need checking against the sponsor's docs.

**Today (core loop): no keys required.**
- Node 22.13 or newer (for the built-in `node:sqlite`).
- Optional S3 for photos: an AWS account, a private bucket, and an IAM access key limited to `s3:PutObject` and `s3:GetObject` on that bucket. Env: `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. For local testing use MinIO and set `S3_ENDPOINT`. Without `S3_BUCKET`, photos go to `apps/web/.data/uploads`.
- HTTPS for phones: a tunnel such as `cloudflared tunnel --url http://localhost:3000` (no account needed for quick tunnels) or ngrok (free account, `ngrok config add-authtoken`).
- Map tiles: CARTO basemaps, no key (attribution shown; fine for a hackathon, not for commercial traffic).
- Raffle entropy: the public `https://sepolia.base.org` RPC. Optional `BASE_SEPOLIA_RPC_URL` (Alchemy or Infura key) if the public one rate-limits.

**Milestone 2 (MCP server)**: no keys. Each agent's MCP config sets `A_EYE_API_URL`.

**Milestone 3 (payments, x402 + AUSD on Base Sepolia)**
- **Agent wallet**: `AGENT_PRIVATE_KEY` in the MCP server's env, funded with testnet AUSD.
- **Treasury wallet**: `TREASURY_PRIVATE_KEY` on the server (pays winners and refunds), funded with testnet AUSD and Base Sepolia ETH for gas. Its address is also the x402 `payTo`.
- **AUSD contract address on Base Sepolia** (`AUSD_ADDRESS`), from Agora's deployment docs, and the AUSD faucet. **Confirm** AUSD supports ERC-3009 `transferWithAuthorization`.
- **x402 facilitator URL** (`X402_FACILITATOR_URL`). **Confirm** whether the free testnet facilitator accepts AUSD as a custom asset, or whether we need a Coinbase CDP API key, or our own verifier (then the treasury pays the settlement gas).
- Base Sepolia ETH from a faucet for both wallets.

**Milestone 4 (demo agent)**
- `ANTHROPIC_API_KEY` for the Claude agent script.
- Gemini Predictions sandbox credentials (API key and secret from a Gemini sandbox account). **Confirm** the exact SDK and auth scheme in the sponsor docs.

**Stretch 1**
- `CONTEXT_DEV_API_KEY` from Context.dev.
- `ELEVENLABS_API_KEY`, plus a voice id (`ELEVENLABS_VOICE_ID`) for TTS.

**Stretch 2 (XRPL)**
- Testnet wallets from the XRPL testnet faucet: treasury/escrow wallet and credential issuer (`XRPL_TREASURY_SEED`, `XRPL_ISSUER_SEED`).
- RLUSD testnet issuer address and a trust line from each wallet, plus testnet RLUSD. **Confirm** the faucet in Ripple's docs.
- Endpoint: `wss://s.altnet.rippletest.net:51233` (public, no key).

## Verification
- **Unit**: geo distance and accuracy rules, raffle determinism (same seed + block hash → same winner; verify snippet matches), tally math, zod schemas (vitest).
- **API/MCP**: run `npx @modelcontextprotocol/inspector` against `packages/mcp`. Call `ask_location_question`, confirm the 402 → paid → 201 flow and that the AUSD transfer appears on the Base Sepolia explorer.
- **E2E on devices**: on the tunnel URL, two phones near the location submit photos. Also test one far away (expect a reject) and one resubmitting the same image (expect a duplicate reject). Watch the gallery update live. Force a close, check the tally, the revealed seed and block hash recompute the same winner, and the payout tx confirms.
- **Agent demo**: Claude Code with the MCP configured asks "Is there a line at the coffee cart outside the venue?". Judges scan the QR code and answer. The agent receives the percentages, the photos as image blocks it can inspect itself, the gallery link and the raffle result. Then run the Gemini oracle agent.

## Live demo script (~3 min)
Agent asks → x402 payment tx on screen → judges' phones get the question → photos stream into the gallery → question closes → agent prints "78% yes (9 humans), gallery: …" → raffle reveal → winner's wallet receives AUSD live → Gemini agent: "crowd disagrees with market, placing sandbox order."
