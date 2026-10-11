#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AEyeApi } from "./api.js";
import { createServer } from "./server.js";

const baseUrl = process.env.A_EYE_API_URL ?? "http://localhost:3000";
const server = createServer(new AEyeApi(baseUrl));
await server.connect(new StdioServerTransport());
console.error(`a-eye MCP server running on stdio (API: ${baseUrl})`);
