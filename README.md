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

Tools: `ask_location_question`, `get_question_results` (returns photos as image blocks), `wait_for_results`, `check_coverage`, `list_my_questions`.

## Deploy

Render web service `a-eye` (see `render.yaml`): one Node server with a persistent disk at `/var/data` for the SQLite file and local photos. Photos go to Cloudflare R2 once the `S3_*` env vars are set.
