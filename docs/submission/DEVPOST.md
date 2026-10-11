# A-eye: eyes on the ground for AI agents

**Live app:** https://a-eye-1zsv.onrender.com
**Hosted MCP:** `https://a-eye-1zsv.onrender.com/mcp`
**npm:** `npx -y a-eye-mcp`
**Code:** https://github.com/PeytonLi/A-eye

Everything runs on test networks (Base Sepolia, XRPL Testnet and Devnet, Gemini sandbox). Every prize is test money.

## Inspiration

AI agents can search the web. They can't see what's happening at a real place right now.

Is there a line at the coffee cart? Is the courtyard busy? Is the Campanile visible through the fog? The web only has old reviews and opening hours. The people standing there know the answer.

We wanted any agent to be able to ask those people, pay them fairly, and get proof back.

## What it does

An AI agent asks a question about a place through our MCP server. It sets a pin, a radius, a deadline and a prize.

People nearby see the question on a map in our phone app (an installable PWA with push notifications). They walk over, take a photo inside the app, and pick an answer. No sign-up: the browser is the account.

The server checks every photo:

- It must be taken in the app's camera, not uploaded from the gallery.
- GPS accuracy must be 75 m or better, and the photo must be inside the radius.
- The capture time must be within 2 minutes of the server clock.
- A SHA-256 hash blocks duplicate photos. Location metadata is stripped from stored JPEGs.

The agent gets back percentages, every photo as evidence, and a comparison with what the web says (and, for market-linked questions, what the market says).

The agent pays the prize in **AUSD over x402**, gasless. While a question is open, results are **sealed** so answers don't herd. An agent can pay **0.02 AUSD to peek** early, and that fee goes into the pot.

At close, a **provably fair raffle** picks one answerer:
`winner = H(seed ‖ latest Base Sepolia block hash ‖ question_id) mod N`.
The seed is committed when the question is created and revealed at close. Anyone can re-run the draw from the results page. The winner gets **90% of the pot**. If nobody answers, the prize is **refunded** to the agent.

Winners choose how to get paid: AUSD on Base Sepolia, or RLUSD on the XRP Ledger. Each accepted answer also mints an on-ledger reputation token.

Pages: `/` (map), `/q/<id>` (results and evidence), `/live` (judge dashboard and money trail), `/leaderboard`, `/me` (wallet, entries, badges), `/agents` (connect an agent), `/vault` (XRPL lending demo).

## How we built it

- **App:** Next.js 16 and React, one Node server on Render. SQLite (`node:sqlite`) on a Render persistent disk. Evidence photos go to Cloudflare R2 through the S3 API, served back through `/api/images`.
- **MCP:** one tool factory (`packages/mcp/src/server.ts`) serves two transports: Streamable HTTP at `/mcp` and stdio in the `a-eye-mcp` npm package. Tools: `ask_location_question`, `peek_results`, `get_question_results`, `wait_for_results`, `compare_market`, `check_coverage`, `list_my_questions`. `/agents` has one-click installs for Cursor and VS Code, a Claude Desktop extension, and a Claude Code plugin.
- **Payments:** x402 (`@x402/core`, `@x402/evm`) with AUSD on Base Sepolia. Over MCP, an unpaid call returns the x402 `PaymentRequired` object; the client signs and retries with `_meta["x402/payment"]`. Treasury payouts and refunds also go through the facilitator as ERC-3009 authorizations.
- **XRPL:** xrpl.js on Testnet for escrow, Batch, AMM payouts in RLUSD, the AEYE MPT and Credentials. A separate Devnet script for the Single Asset Vault and Lending Protocol.
- **Gemini:** an oracle in `apps/demo-agent` using `@gemini-markets/sdk`. It compares the crowd with public market odds and places sized orders in the Gemini sandbox.
- **Context.dev:** fills in place context and a "what the web says" baseline for each question.
- **ElevenLabs:** "Read aloud" (TTS) for questions and "Say your answer" (speech-to-text) for hands-free answers.
- **UI:** Tailwind v4, Radix, MapLibre, motion. Warm, plain-language screens for non-technical people.

## Challenges

- **AUSD's x402 domain.** Signing needs `name: "Agora Dollar"`, `version: "1"`. Getting this wrong fails with a confusing token-name error.
- **RLUSD can't be escrowed on Testnet.** The issuer doesn't enable trust-line locking, so TokenEscrow is out. We escrow XRP and deliver RLUSD through the AMM, inside one atomic Batch.
- **Batch results lie a little.** An outer `tesSUCCESS` doesn't mean every inner transaction succeeded. We hash and look up each inner transaction, and fall back to sequential steps if any fail.
- **Lending is Devnet-only.** The vault and loan amendments aren't on Testnet yet, and the vault must be closed-ended for the broker setup to work.
- **Gemini sandbox details.** Nonces and very large order IDs needed careful handling.
- **Context.dev allows one request at a time** on our plan, so calls are queued and retried once on a 429.
- **Honest photos.** Camera-only capture, GPS accuracy, freshness and duplicate checks all had to work on real phones, with friendly help when permissions are blocked.

## Accomplishments

- Real AUSD flows on Base Sepolia, each with a public receipt: [bounty](https://sepolia.basescan.org/tx/0xd4fff4df465e67a60ff60adb560cf739873673f5fe97eeb28dfefbb91184fe5e), [peek](https://sepolia.basescan.org/tx/0x947dde38e366ac80ab4c401e15e9f966b87ce19ac67fc0bf150d2905d205aabc), [winner payout](https://sepolia.basescan.org/tx/0x88f3a82b840fcb29c744d99bb8a97e6c22f444a35b05c146c753b0fcdaf86376), [refund](https://sepolia.basescan.org/tx/0x066fe59b98130c690bb144543625344dae3f930a822f8802ea359d5263006429).
- An atomic [XRPL Batch settlement](https://testnet.xrpl.org/transactions/F145294E73889FD677795FE68A47D6414EE94CE41D0ABDFCB6DBF98C047BF56B): escrow release, RLUSD payout and fee in one transaction.
- A filled Gemini sandbox order (`145853902277410438`, `GEMI-SOL2610112200-HI109`, 4 YES @ $0.47) driven by a crowd-vs-market gap.
- A full lending loop on XRPL Devnet: deposit, loan, bounty, repay, withdraw with yield.
- Any agent can connect with one URL or one `npx` command, with no account.

## What we learned

- x402 fits MCP well. A tool call can return "payment required", and the agent can pay and retry without a human.
- Gasless matters for agents. With ERC-3009, neither the agent nor our treasury needs ETH.
- Combining XRPL features in one Batch gives you all-or-nothing settlement for free, but you have to check the inner results yourself.
- Sealing results until close is a simple fix for herding, and paid peeks turn it into extra prize money.
- The web is often wrong about "right now." Putting the web's guess next to the crowd's answer makes that obvious.

## What's next

- Move from test networks to mainnet AUSD and RLUSD.
- Escrow RLUSD directly once the issuer enables trust-line locking.
- Run the bounty credit vault on Testnet and Mainnet when the lending amendments go live.
- Point the Gemini oracle at weather and local-event markets as the sandbox lists them.
- Grow the observer base beyond campus, with reputation (AEYE and credentials) deciding who sees the best-paying questions.

## Built with

TypeScript · Next.js 16 · React · Node.js (`node:sqlite`) · SQLite · Tailwind CSS v4 · Radix UI · MapLibre GL · OpenStreetMap / Nominatim · Model Context Protocol SDK · x402 · viem · AUSD (Agora) · Base Sepolia · xrpl.js · XRP Ledger (Testnet, Devnet) · RLUSD · Gemini Prediction Markets SDK · Context.dev · ElevenLabs · Cloudflare R2 · Web Push · Render · npm

---

## Sponsor tracks

### Best Use of AUSD (Agora)

**Agentic payments.** The buyer is an AI agent, not a person. It asks a question and pays the prize in the same MCP tool call. Treasury payouts to winners and refunds to agents are also automatic.

**x402.** Both paid actions use x402: `ask_location_question` (the prize) and `peek_results` (0.02 AUSD). On the hosted `/mcp` endpoint, payment travels in MCP `_meta`. Over HTTP, it's the standard `402 Payment Required` flow.

**Gasless ERC-3009.** The agent signs a `transferWithAuthorization`, and the x402 facilitator submits it. Treasury payouts and refunds use the same path. Nobody needs Base Sepolia ETH.

**Real-world use.** Agents pay people for fresh, verified facts about places. The money trail is public on `/live` and each results page, with a BaseScan receipt for every step: [bounty](https://sepolia.basescan.org/tx/0xd4fff4df465e67a60ff60adb560cf739873673f5fe97eeb28dfefbb91184fe5e), [peek](https://sepolia.basescan.org/tx/0x947dde38e366ac80ab4c401e15e9f966b87ce19ac67fc0bf150d2905d205aabc), [payout](https://sepolia.basescan.org/tx/0x88f3a82b840fcb29c744d99bb8a97e6c22f444a35b05c146c753b0fcdaf86376), [refund](https://sepolia.basescan.org/tx/0x066fe59b98130c690bb144543625344dae3f930a822f8802ea359d5263006429).

### Best Use of Gemini Prediction API

**Creative use.** Prediction markets price what people think will happen. A-eye adds what people nearby can see right now. Our oracle links a question to a Gemini market, then compares the crowd's YES share with the market's implied odds.

**Practical use.** When the gap is big enough (15+ points by default, at least 3 answers, and a 0.03 minimum edge), it sizes a small bet with a fractional Kelly stake under hard caps, places a limit order in the sandbox, and cancels anything unfilled. Every decision, including "no trade," is recorded and shown as **Market vs Humans** on the results page and `/live`.

**Sandbox trades.** Filled order `145853902277410438`: `GEMI-SOL2610112200-HI109`, 4 YES @ $0.47. The market implied 41.5% YES; the crowd-adjusted fair value was 70.75%, a 58.5-point divergence (sample output in [docs/gemini.md](../gemini.md)). Discovery currently targets the Crypto and Commodities contracts the sandbox lists.

### Best Use of Ripple (XRPL)

**Multiple primitives, one product.** Each XRPL feature does a job in the A-eye flow:

| Step | XRPL feature |
| --- | --- |
| Agent posts a paid question | **Escrow** (`EscrowCreate`) locks the pot up front |
| Winner is drawn | **Batch** (`tfAllOrNothing`): `EscrowFinish` + winner payout + fee `Payment` |
| Winner payout | **RLUSD** via the XRP/RLUSD **AMM** (cross-currency `Payment`) |
| Nobody answers | **Escrow** (`EscrowCancel`) refunds the pot |
| Observer onboarding on `/me` | **Batch** (`TrustSet` + `MPTokenAuthorize`) |
| Each accepted answer | **MPT** `AEYE` reputation token, non-transferable |
| After enough accepted answers | **Credentials**: "A-eye Verified Observer" |

**RLUSD.** Winners who pick RLUSD get dollars. The pot is escrowed in XRP and converted to RLUSD through the AMM in the same atomic Batch. Proof: [settlement Batch](https://testnet.xrpl.org/transactions/F145294E73889FD677795FE68A47D6414EE94CE41D0ABDFCB6DBF98C047BF56B). More links are in the "Explorer proof (Testnet)" table in [docs/xrpl.md](../xrpl.md).

**Developer feedback.** The README has a full section. In short:

- **XRPL docs MCP** was the most useful tool. Semantic search found the trust-line-locking flag and the Batch inner-result warning on the first try. Those two answers shaped our design.
- **SKILL.md** (`xrpl-payments`, `xrpl-trading`, `xrpl-agent-wallet`) was accurate on the RLUSD issuer, trust lines, `SendMax` and `delivered_amount`. It has no coverage of Batch, MPTs, TokenEscrow or Credentials, which is what we needed most.
- **Learned by experiment:** xrpl.js `autofill` doesn't set `tfInnerBatchTxn`, and you must hash each inner transaction to find its result.

### Ripple side challenge: Single Asset Vault + Lending Protocol

**Bounty Credit Vault** (`/vault`, `npm run xrpl:vault`, XRPL Devnet). An agent can borrow the bounty instead of paying it up front.

| Role | What they do |
| --- | --- |
| **Broker** (A-eye) | Creates a closed-ended Single Asset Vault, sets loan-broker terms, posts first-loss cover |
| **Depositor** | Deposits 20 XRP for vault shares, withdraws with yield at maturity |
| **Sponsor** | Deposits 20 XRP alongside and stays invested |
| **Borrower** (AI agent) | Co-signs a 20 XRP loan, escrows a 5 XRP bounty, repays with interest |
| **Observer** | Receives the escrowed bounty |

Result of the committed run: the depositor withdrew **20,000,035 drops** from a **20,000,000-drop** deposit, **35 drops of yield**.

Devnet proof: [vault create](https://devnet.xrpl.org/transactions/EF63612970AD08408D70376D2D02A9278F3948F29198C6315456A9BECCD0F191) · [loan broker set](https://devnet.xrpl.org/transactions/B91F264C35D132752B5F6AEA91CD7BC8910BFC421CFE4CAA1572B86334815ECB) · [cover deposit](https://devnet.xrpl.org/transactions/7D0A3D965330EE974153EA974A37BD44132DEE0A059FEDC4BC73117CCC9F0007) · [depositor deposit](https://devnet.xrpl.org/transactions/F949E8EB000B33D2CC25869A3B14A7D3F95E9D47F93160D9A547E59C097C6256) · [sponsor deposit](https://devnet.xrpl.org/transactions/2D8CEED32A785162446220BC0346B76D6FF57FFABE821E17E323CFDDA9A94574) · [loan set](https://devnet.xrpl.org/transactions/82F77415FBA8FDE5CE2925F642A0797789B8343827164065870D7438C1223FE7) · [bounty escrow](https://devnet.xrpl.org/transactions/A1AD294476DC0B112776CE9E06AD6CB9CF16BC781F60F72D17DFBF8568B5E22B) · [bounty paid](https://devnet.xrpl.org/transactions/7AED6F22AF805CF01A897569E31E2BD5139593DF2C675172E5410B8A5CA9C3DF) · [loan repayment](https://devnet.xrpl.org/transactions/064BDF7EE35AA5B78A5C99621EF4B31E3C36FADED219BBC9EDC7A05ED330299F) · [loan delete](https://devnet.xrpl.org/transactions/021E1E6C8858E42B23B7409F004636174CEB967DB1603F7B75AD9FA34FB2E382) · [vault withdraw](https://devnet.xrpl.org/transactions/6A29B0735D21EF8E01EE33761929285EA5608150B5B671F86C1653E6B85B220E)

It's on Devnet because `SingleAssetVault` and `LendingProtocol` aren't enabled on Testnet.

### Bonus: Context.dev

Each new question is enriched in the background: a place name and summary from Context.dev web search, and a "what the web says" answer from Context.dev answers. The results page shows **The internet** next to **People there**, and says whether they agree.

### Bonus: ElevenLabs

**Read aloud** reads the question and options with ElevenLabs TTS (cached). **Say your answer** records up to 10 seconds, transcribes it with ElevenLabs speech-to-text, and picks the matching option, so observers can answer hands-free.
