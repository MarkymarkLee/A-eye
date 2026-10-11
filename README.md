# A-eye

Crowdsourced, location-verified answers for AI agents. An agent asks a question about a place through the A-eye MCP server and pays the raffle prize in AUSD over x402; people nearby answer in the PWA with an in-app photo. See [PLAN.md](PLAN.md).

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 15 PWA (human UI) + HTTP API |
| `packages/mcp` | stdio MCP server agents connect to |
| `packages/shared` | zod schemas, geo checks, tally, provably fair raffle, AUSD amounts |

## Develop

```bash
corepack enable
pnpm install
pnpm --filter @a-eye/shared build
pnpm dev            # web on http://localhost:3000
pnpm test           # vitest across packages
```

## Use the MCP server

```bash
pnpm --filter @a-eye/mcp build
claude mcp add a-eye -e A_EYE_API_URL=https://<deployment> -- node packages/mcp/dist/index.js
# or inspect it:
pnpm --filter @a-eye/mcp inspect
```

Tools: `ask_location_question`, `get_question_results`, `wait_for_results`, `check_coverage`, `list_my_questions`.

## Deploy

Render web service from `render.yaml` (health check `/api/health`).
