# A-eye demo script (3 minutes)

Two people run the demo.

- **Presenter** talks and holds a phone with the A-eye PWA open.
- **Driver** runs the laptop on the projector.

Judges answer on their own phones.

## Before the clock (T-10 min)

- [ ] Driver opens `https://a-eye-1zsv.onrender.com/api/health` and sees `"ok":true`. If not, see [Fallbacks](#fallbacks).
- [ ] Driver opens these tabs, in order:
  1. [`/live`](https://a-eye-1zsv.onrender.com/live) (projector dashboard)
  2. A terminal ready to ask the question (command below)
  3. [`/q/55c31d47dc`](https://a-eye-1zsv.onrender.com/q/55c31d47dc), an already settled question with a real payout, as a backup results page
  4. [`/vault`](https://a-eye-1zsv.onrender.com/vault)
  5. The proof links from [Proof tabs](#proof-tabs)
- [ ] Presenter's phone has the PWA open on `/` with location and camera allowed.
- [ ] The agent wallet holds AUSD on Base Sepolia. The treasury is set on Render.
- [ ] Backup video is downloaded to the laptop **and** the presenter's phone: `[BACKUP VIDEO LINK: fill in]`.
- [ ] Phone hotspot is on standby.

The ask command (repo root, agent key and LLM key in env):

```bash
npm run ask -w @a-eye/demo-agent -- "Is there a line at the coffee cart outside Chou Hall?" --minutes 3
```

Any MCP client works too: point it at `https://a-eye-1zsv.onrender.com/mcp`, or run `npx -y a-eye-mcp` with `AGENT_PRIVATE_KEY` set so it pays automatically.

## The run

| Time | Who | Clicks / does | Says |
| --- | --- | --- | --- |
| 0:00–0:20 | Presenter | Nothing yet. Projector shows `/live`. | "AI agents can search the web. They can't see what's happening at a real place right now. Is there a line? Is it open? Is it raining? A-eye gives agents eyes on the ground." |
| 0:20–0:45 | Driver | Runs the ask command. Points at the new **Agent asked** row and its x402 payment on `/live`. | "Our agent just asked a question through our MCP server. It paid the prize in AUSD over x402. It signed an authorization, so it needed no gas." |
| 0:45–1:25 | Presenter | Holds up the phone: question appears on the map. Taps it, takes a photo in the app, picks an answer. Asks judges to scan the QR on `/live` and do the same. | "Anyone nearby sees it in our phone app. You have to take the photo in the app, right now, right here. We check your GPS, the time, and that the photo isn't a copy." |
| 1:25–1:50 | Driver | Shows photos landing on `/live`. Opens the question page: it says results are sealed. In the MCP client, calls `peek_results` to buy an early look (0.02 AUSD); skip if short on time. | "Results stay sealed while the question is open, so nobody copies the crowd. An agent can pay two cents to peek early. That fee goes into the prize." |
| 1:50–2:20 | Driver | Question closes (cap or timer). Opens `/q/<id>`: tally bars, photos, **The internet** vs **People there**. Opens **How is this fair?** | "Here's the answer, with every photo as proof, next to what the web guessed. One answerer wins 90% of the pot. The draw uses a seed we committed up front plus a Base Sepolia block hash. Anyone can re-run it." |
| 2:20–2:40 | Driver | Clicks **Receipt on BaseScan** for the payout. Then the refund proof link. | "That's the winner's payout on chain. If nobody answers, the agent gets its money back automatically." |
| 2:40–2:55 | Driver | Flashes the XRPL Batch link, the Gemini order, then `/vault`. | "Winners can also take RLUSD on the XRP Ledger: escrow, AMM swap and fee in one atomic Batch. Our oracle traded on Gemini's sandbox when the crowd disagreed with the market. And on Devnet, a lending vault can front an agent its bounty." |
| 2:55–3:00 | Presenter | Back to `/agents`. | "One URL or one `npx` command, and any agent can see the world. That's A-eye." |

If the live question has not closed by 1:50, the Driver switches to tab 3 (`/q/55c31d47dc`) and says: "This one closed a few minutes ago. Same flow." Do not wait on stage.

## Proof tabs

- AUSD bounty: https://sepolia.basescan.org/tx/0xd4fff4df465e67a60ff60adb560cf739873673f5fe97eeb28dfefbb91184fe5e
- AUSD peek: https://sepolia.basescan.org/tx/0x947dde38e366ac80ab4c401e15e9f966b87ce19ac67fc0bf150d2905d205aabc
- AUSD winner payout: https://sepolia.basescan.org/tx/0x88f3a82b840fcb29c744d99bb8a97e6c22f444a35b05c146c753b0fcdaf86376
- AUSD refund: https://sepolia.basescan.org/tx/0x066fe59b98130c690bb144543625344dae3f930a822f8802ea359d5263006429
- XRPL Batch settlement: https://testnet.xrpl.org/transactions/F145294E73889FD677795FE68A47D6414EE94CE41D0ABDFCB6DBF98C047BF56B
- Gemini sandbox order `145853902277410438`: `GEMI-SOL2610112200-HI109`, 4 YES @ $0.47, filled (sample output in the README)
- XRPL Devnet vault withdraw: https://devnet.xrpl.org/transactions/6A29B0735D21EF8E01EE33761929285EA5608150B5B671F86C1653E6B85B220E

## Fallbacks

**Render is mid-deploy** (`/api/health` fails, or pages show a 502):

1. Wait up to 60 s and reload `/api/health`. A deploy usually finishes in that window.
2. Still down: play the backup video. The Presenter narrates the same lines over it.
3. The proof tabs are on BaseScan and the XRPL explorers, not Render, so they still work. Show them after the video.

**Wi-Fi fails:**

1. Driver switches the laptop to the phone hotspot. Judges keep watching the projector instead of answering.
2. No hotspot or no signal: play the backup video from the laptop's disk.
3. Projector also gone: the Presenter plays the backup video on the phone and hands it to the judges.
4. The PDF deck (`A-eye-deck.pdf`) works offline and has screenshots of every page.

**Camera or location is blocked on a judge's phone:** the app shows how to turn it back on. Don't fix it on stage. The Presenter's phone answers instead.

**The agent command fails:** post the same question from `/agents` (test-question form), or skip to tab 3.

## 30-second elevator version

> AI agents can search the web, but they can't see what's happening at a real place right now. A-eye fixes that. An agent asks a question about a place through our MCP server. People nearby get it on their phone, take a live photo, and answer. We check GPS, timing and duplicates. The agent pays the prize in AUSD over x402, with no gas. One answerer wins 90% in a draw anyone can verify, and unanswered questions are refunded. Winners can also be paid RLUSD on the XRP Ledger. It's live on Render, and any agent can connect with one URL or `npx -y a-eye-mcp`.
