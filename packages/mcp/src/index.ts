import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AEyeApi } from "./api.js";
import { paymentFromEnv } from "./payments.js";
import { createServer } from "./server.js";

const configuredBaseUrl = process.env.A_EYE_API_URL;
const baseUrl = configuredBaseUrl && !configuredBaseUrl.startsWith("${")
  ? configuredBaseUrl
  : "https://a-eye-1zsv.onrender.com";
const payment = paymentFromEnv();
// A paying agent is identified by its x402 payer address, so list_my_questions uses that.
const agentLabel = payment?.address ?? process.env.A_EYE_AGENT_LABEL ?? "mcp-agent";
const server = createServer(new AEyeApi(baseUrl, payment?.fetch ?? fetch, agentLabel, Boolean(payment)));
await server.connect(new StdioServerTransport());
console.error(
  `a-eye MCP server running on stdio (API: ${baseUrl}; ${payment ? `paying x402 from ${payment.address}` : "no AGENT_PRIVATE_KEY, paid calls will fail"})`,
);
