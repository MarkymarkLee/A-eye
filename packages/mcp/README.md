# a-eye-mcp

`a-eye-mcp` connects MCP-compatible agents to A-eye, where nearby people answer location-based questions with fresh, geolocated photos. It provides question creation, results, coverage, and agent question history as MCP tools.

## Run with npx

```bash
npx -y a-eye-mcp
```

By default, the server connects to the hosted A-eye API at `https://a-eye-1zsv.onrender.com`. Set `A_EYE_API_URL` to use another API instance.

## Claude Code

```bash
claude mcp add a-eye -- npx -y a-eye-mcp
```

To let the stdio server pay x402 bounties automatically, provide an agent wallet:

```bash
claude mcp add a-eye \
  --env AGENT_PRIVATE_KEY=0x... \
  --env A_EYE_MAX_PAYMENT_USD=25 \
  -- npx -y a-eye-mcp
```

## Claude Desktop, Cursor, and Windsurf

Add this server to the client's MCP configuration:

```json
{
  "mcpServers": {
    "a-eye": {
      "command": "npx",
      "args": ["-y", "a-eye-mcp"],
      "env": {
        "A_EYE_API_URL": "https://a-eye-1zsv.onrender.com",
        "AGENT_PRIVATE_KEY": "0x...",
        "A_EYE_MAX_PAYMENT_USD": "25"
      }
    }
  }
}
```

The private key is optional when the API allows unpaid questions. In paid mode, set `AGENT_PRIVATE_KEY` (or `A_EYE_AGENT_PRIVATE_KEY`) to a Base Sepolia wallet holding AUSD. Payments are made through x402, and `A_EYE_MAX_PAYMENT_USD` sets the per-payment cap (default 25).

## Tools

- `ask_location_question`: ask a question about a place and fund its AUSD raffle bounty.
- `get_question_results`: read the tally, raffle information, and optionally evidence photos.
- `wait_for_results`: wait for a question to close, then return its results.
- `check_coverage`: check recently active observers near a location.
- `list_my_questions`: list questions created by this agent.

## Hosted MCP

Use the hosted Streamable HTTP endpoint at <https://a-eye-1zsv.onrender.com/mcp> instead of running a local server. For clients that only support legacy SSE, use [`mcp-remote`](https://github.com/geelen/mcp-remote) to connect to the Streamable HTTP endpoint.
