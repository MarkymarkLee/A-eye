# A-eye — Plan: crowdsourced, location-verified answers for AI agents

## Context
AI agents can search the web, but they can't see what's happening at a physical place right now ("Is there a line at the coffee cart?", "Is the park flooded?", "Is this store open?"). A-eye lets an agent ask a question tied to a location through an **MCP server**. People nearby get the question in a **mobile web app (PWA)**, take a photo **in the app**, and answer. We check their GPS and the photo. Once enough answers come in, the agent gets back **the percentage for each answer, how many people answered, and a link to a gallery of all photos**. Everyone with a verified answer is entered in a **raffle for a fixed prize**, which the agent pays for when it asks the question.

The build is a greenfield hackathon MVP for **B@BHacks 2.0** (the repo has only README.md). The judges reward technical novelty, creativity, functionality and social proof. They penalize thin backends and hard-coded functionality. We can enter one General track plus any number of sponsor tracks, so each sponsor is wired in where it fits the product naturally.

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
 packages/mcp  ── x402-fetch + agent wallet (AUSD, Base Sepolia) ──►  apps/web  /api/* (Next.js on Vercel)
                                                                     │   ├─ x402 middleware (pay-per-question)
 Humans (phone browser, PWA) ─── HTTPS ─────────────────────────────►│   ├─ submission checks (geo + time + dup)
                                                                     │   ├─ close + raffle + payout (cron)
                                                                     ▼
                                     Supabase: Postgres+PostGIS · Auth · Storage · Realtime
                                     Chains: Base Sepolia (AUSD) · [XRPL testnet]
                                     APIs: Context.dev · ElevenLabs · Gemini Predictions sandbox
```

### Monorepo layout (pnpm workspaces, TypeScript everywhere)
- `apps/web`: Next.js 15 (App Router) + Tailwind + Leaflet/MapLibre; PWA manifest + service worker. Hosts both the human UI and the HTTP API.
- `packages/mcp`: stdio MCP server (`@modelcontextprotocol/sdk`). The agent runs it with `AGENT_PRIVATE_KEY` and `A_EYE_API_URL`. It calls the API through `x402-fetch` (viem wallet), so payment happens without the agent having to do anything extra.
- `packages/shared`: zod schemas and types shared by the API and the MCP server (question, results, submission).
- `apps/demo-agent`: a Claude agent script (Anthropic SDK tool-runner) that connects to the A-eye MCP and the Gemini Predictions MCP/SDK for the "human oracle" demo.
- `supabase/migrations`: SQL schema, PostGIS, RLS, storage bucket.

## Data model (Supabase / Postgres + PostGIS)
- `profiles(id → auth.users, display_name, evm_address, xrpl_address, payout_rail)`
- `agents(id, wallet_address unique, label, created_at)`: created on first paid request, keyed by the x402 payer address
- `questions(id, agent_id, prompt, options jsonb[2..6], allow_free_text, location geography(Point), radius_m, place_context jsonb, web_baseline jsonb, prize_amount, currency, payment_tx, min_responses, max_responses, closes_at, status open|closed|settled, seed_commit, market_ref jsonb, created_at)`, with a GIST index on `location`
- `submissions(id, question_id, user_id, option_index, free_text, image_path, image_sha256 unique, location geography, accuracy_m, distance_m, captured_at, status accepted|rejected, reject_reason)`, with unique `(question_id, user_id)`
- `raffles(question_id pk, seed_reveal, entropy_block_hash, winner_submission_id, payout_tx, payout_rail)`
- RPC `nearby_questions(lat, lng, max_km)` uses `ST_DWithin`. Storage bucket `submissions` is private, and the gallery serves signed URLs.

## MCP server tools (`packages/mcp/src/index.ts`)
1. `ask_location_question({ lat, lng, radius_m=150, question, options[], allow_free_text?, prize_usd=1, min_responses=3, max_responses=20, closes_in_minutes=30 })`: POSTs `/api/questions`, which returns 402. x402-fetch signs an ERC-3009 AUSD authorization, retries, and the call returns `{ question_id, payment_tx, gallery_url, place_context, web_baseline }`.
2. `get_question_results({ question_id, include_images=true })`: returns `{ status, responses, tally: [{option, count, pct}], gallery_url, evidence: [{ answer, free_text, image_url, distance_m, captured_at }], web_baseline, raffle: {winner, payout_tx, seed_commit, seed_reveal} }`. When `include_images` is set, the tool also returns the photos (downscaled to about 512 px) as **MCP `image` content blocks** paired with each answer. A multimodal agent can then look at the evidence and check the percentages itself, not just follow a link.
3. `wait_for_results({ question_id, timeout_s })`: long-polls until the question closes or the timeout hits, then returns the same results. This lets the agent block without busy-looping.
4. `check_coverage({ lat, lng })`: number of observers active nearby in the last N minutes, so the agent knows whether asking is likely to work.
5. `list_my_questions()`

Also expose the same endpoints as plain REST with x402 (any HTTP agent can pay), plus an optional `webhook_url` that is called when a question closes.

## Human app (`apps/web`)
- `/`: map of open questions near you (browser geolocation, `nearby_questions` RPC, Supabase Realtime for new questions), with prize and time left on each pin. A QR code on the demo slide links here.
- `/q/[id]/answer`: the question (with 🔊 ElevenLabs TTS), place context, **in-app camera only** (`getUserMedia` → canvas → JPEG; no gallery uploads), option buttons, optional 🎙️ voice answer (ElevenLabs STT). On submit the app sends the image, `{lat,lng,accuracy}` from `watchPosition`, and `captured_at`.
- `/q/[id]`: public **gallery and results page** (the link returned to agents). Live tally bars over Realtime, photo grid, web-vs-human comparison, the raffle seed commit and reveal, and the payout tx link.
- `/me`: sign in with Supabase magic link, set the payout wallet (EVM address, optionally XRPL), list my entries and winnings.

## Submission checks (`apps/web/app/api/questions/[id]/submissions/route.ts`)
**No AI judging.** Humans are the source of truth. A-eye only checks that the person was actually there. The **asking agent** gets every photo next to every answer, so it can audit the evidence itself.
1. Auth required, one submission per user per question, and the question must be open.
2. **Geo checks**: `accuracy_m ≤ 75`, `ST_Distance(submission, question) ≤ radius_m + accuracy_m`, `|captured_at − server_now| ≤ 2 min`. If a check fails, the submission is rejected with a clear message ("you're 420 m away"). The server stores the distance for the gallery.
3. **Proof of capture**: in-app camera only (no file picker), with a SHA-256 hash of the image bytes stored so duplicate photos are rejected, plus the capture timestamp and distance shown on each photo.
4. The image is uploaded to Storage, the row is inserted, and a Realtime broadcast goes out. Once `max_responses` is reached, the question is closed.
Limitation to state honestly: browser GPS can be spoofed. The in-app-only camera, the timestamp window and duplicate-hash checks raise the cost of cheating, and the agent can see the photos to judge for itself. A production version would add device attestation and reputation scores.

## Close → tally → raffle → payout (`apps/web/lib/settle.ts`, run by Vercel Cron every minute + on max_responses)
- Close a question when `closes_at` has passed or `max_responses` is reached. Tally every **accepted** (geo-verified) submission. If `min_responses` isn't met, refund the agent (AUSD transfer back) and mark the question `expired`.
- **Provably fair raffle**: when the question is created, generate `server_seed` and store `seed_commit = sha256(seed)`. At close, `winner = H(seed ‖ latest Base Sepolia block hash ‖ question_id) mod N` over accepted submissions sorted by id. Reveal the seed and block hash on the gallery page so anyone can recheck the draw (include a "verify" snippet).
- **Payout**: the treasury wallet (viem) transfers `prize_amount × (1 − 10% platform fee)` AUSD to the winner's `evm_address` on Base Sepolia, and the tx hash is stored. Stretch 2: if `payout_rail = xrpl`, pay RLUSD on XRPL testnet instead. The pot is locked in an XRPL `EscrowCreate` at question creation and released with `EscrowFinish` to the winner. Issue an XRPL `CredentialCreate` "A-eye Verified Observer" after 3 accepted submissions.

## Sponsor integrations, concretely
- **x402 + AUSD**: `apps/web/middleware.ts` uses the x402 Next middleware on `POST /api/questions` with a dynamic price equal to the requested prize. Asset: the AUSD contract on Base Sepolia (address from the Agora deployments docs; use the Agora Docs MCP). **Hour-1 risk check**: confirm the x402 facilitator accepts AUSD as a custom ERC-3009 asset on Base Sepolia. If it doesn't, write a small self-hosted verifier that checks and submits the `transferWithAuthorization` ourselves. Get faucet AUSD for the agent and treasury wallets.
- **Context.dev** (`lib/context.ts`): when a question is created, run a reverse lookup or search for the coordinates and nearby POI (name, hours, website), and ask the Answers API the question itself. Store both as `place_context` and `web_baseline`, then show them to humans and return them to the agent.
- **ElevenLabs** (`app/api/tts`, `app/api/stt`): server-side proxy so the key stays secret. TTS for the question, STT for free-text answers.
- **Gemini Predictions** (`apps/demo-agent`): the agent lists sandbox markets (`@gemini-markets/sdk`), picks one that can be observed near us (weather, an event), asks A-eye, waits, compares the human % with the implied odds, and places a sandbox order if they diverge. The market id is stored in `questions.market_ref`, and the gallery page shows "Market: 62% · Humans: 85%".

## Build order (hackathon milestones)
0. **First action after approval**: copy this plan into the repo as `/Users/mark/coding/hackathons/A-eye/PLAN.md` and commit it ("Add project plan"), before any code is written.
1. **Skeleton (~2h)**: pnpm monorepo, Next.js app deployed to Vercel early (camera and geolocation need HTTPS), Supabase project and migrations, shared zod schemas.
2. **Core loop without payments (~4h)**: create-question API, map, answer page with camera and geo, submission checks (geo, time window, duplicate hash), gallery with Realtime, MCP server (`ask`/`get`/`wait`). Test end to end with MCP Inspector and a real phone.
3. **Money (~3h)**: x402 + AUSD on question creation, treasury wallet, settle cron, provably fair raffle, AUSD payout, refunds.
4. **Demo agent + Gemini (~2h)**.
5. **Stretch 1 (~2h)**: Context.dev enrichment and ElevenLabs voice.
6. **Stretch 2 (~3h)**: XRPL RLUSD payout rail, Escrow, Credentials.
7. **Polish and social proof**: seed real questions around the venue, get other hackers to answer (judges count traction), record a backup demo video, write the README with an architecture diagram.

## Verification
- **Unit**: geo distance and accuracy rules, raffle determinism (same seed + block hash → same winner; verify snippet matches), tally math, zod schemas (vitest).
- **API/MCP**: run `npx @modelcontextprotocol/inspector` against `packages/mcp`. Call `ask_location_question`, confirm the 402 → paid → 201 flow and that the AUSD transfer appears on the Base Sepolia explorer.
- **E2E on devices**: on the Vercel preview URL, two phones near the location submit photos. Also test one far away (expect a reject) and one resubmitting the same image (expect a duplicate reject). Watch the gallery update live. Force a close, check the tally, the revealed seed and block hash recompute the same winner, and the payout tx confirms.
- **Agent demo**: Claude Code with the MCP configured asks "Is there a line at the coffee cart outside the venue?". Judges scan the QR code and answer, The agent receives the percentages, the photos as image blocks it can inspect itself, the gallery link and the raffle result. Then run the Gemini oracle agent.

## Live demo script (~3 min)
Agent asks → x402 payment tx on screen → judges' phones get the question → photos stream into the gallery → question closes → agent prints "78% yes (9 humans), gallery: …" → raffle reveal → winner's wallet receives AUSD live → Gemini agent: "crowd disagrees with market, placing sandbox order."
