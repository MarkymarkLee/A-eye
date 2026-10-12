# Development

Layout, local setup, pages and API, and push notifications.

## Layout

- `apps/web`: Next.js 16 app, HTTP API, observer experience, and live dashboard.
- `packages/mcp`: stdio MCP server used by agents.
- `packages/shared`: shared request schemas and API types.
- `apps/demo-agent`: standalone ask and Gemini Predictions oracle demos.
- `apps/web/lib/store.ts`: SQLite schema, question/submission operations, settlement, and raffle.
- `scripts/xrpl-*.ts` and `apps/web/lib/xrpl.ts`: the optional XRPL Testnet rail (escrow, Batch settlement, RLUSD, MPT reputation, credentials).

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

### Push notifications

Observers can opt in to "new question near you" web push (installable PWA + `/sw.js`). Generate VAPID keys once with `npm run vapid:keys` and set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` on Render — with none set, push is a silent no-op. Subscriptions are stored server-side with a coarse (~110 m) location, and one subscription hears about at most one question every 3 minutes (`PUSH_MIN_INTERVAL_SECONDS`).

## Architecture notes

The Gemini oracle attaches `market_ref` (provider, contract, `implied_yes`) to each question; the gallery and `/live` show live odds, the crowd comparison, and recorded sandbox trades. The answer flow reads questions aloud and accepts spoken answers through the ElevenLabs TTS/STT proxy routes. See [Architecture](../README.md#architecture) for the diagram.
