# Demo runbook

The submission script is in [submission/DEMO_SCRIPT.md](submission/DEMO_SCRIPT.md).

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

### Hackathon traction seed

Preview the Chou Hall and Haas courtyard question seeds against the hosted API without posting:

```bash
npx tsx scripts/seed-traction.mts
```

To post and pay for the non-duplicate questions, set `A_EYE_AGENT_PRIVATE_KEY` and explicitly pass `--live`:

```bash
npx tsx scripts/seed-traction.mts --live
```

Use `--only 1,3` to select seed indices and `--max-spend 0.1` to set the spend cap. The script skips matching open questions and enforces the cap after skips.

Printable QR poster, table tent and the hackathon invite copy live in [`docs/poster/`](poster/README.md).

The oracle command uses `--dry-run` for safety. Remove that flag only for an intentionally placed Gemini sandbox order.
