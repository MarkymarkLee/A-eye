import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CreateQuestionInput, askQuestionShape, type QuestionResults } from "@a-eye/shared";
import type { PaymentPayload } from "@x402/core/types";
import { z } from "zod";
import { PaymentRequiredError, type AEyeApi } from "./api.js";

const json = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const fail = (err: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
});

async function resultsContent(
  api: AEyeApi,
  results: QuestionResults,
  includeImages: boolean,
  maxImages: number,
): Promise<CallToolResult> {
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(results, null, 2) }];
  if (!includeImages) return { content };
  const limit = Number.isFinite(maxImages) ? Math.max(0, Math.floor(maxImages)) : 8;
  const evidence = results.evidence.slice(0, limit);
  const images = await Promise.all(evidence.map((ev) => api.fetchImage(ev.image_url).catch(() => null)));
  for (const [i, ev] of evidence.entries()) {
    const img = images[i];
    if (!img) continue;
    const rep = ev.observer_reputation;
    const repText =
      rep.agreement_rate === null
        ? ", new observer (no closed questions yet)"
        : `, observer agreed with the crowd ${Math.round(rep.agreement_rate * 100)}% of the time on ${rep.scored_answers} closed questions (${rep.answer_count} answers)`;
    content.push({
      type: "text",
      text: `Evidence #${i + 1}: "${ev.answer}"${ev.free_text ? ` (${ev.free_text})` : ""}, ${ev.distance_m} m away, captured ${ev.captured_at}${repText}`,
    });
    content.push({ type: "image", data: img.data, mimeType: img.mimeType });
  }
  if (results.evidence.length > limit) {
    content.push({ type: "text", text: `+${results.evidence.length - limit} more photos not attached; see ${results.gallery_url}` });
  }
  return { content };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createServer(
  api: AEyeApi,
  {
    pollIntervalMs = 3000,
    maxImages = Number(process.env.A_EYE_MCP_MAX_IMAGES ?? 8),
    mcpPayments = false,
  }: { pollIntervalMs?: number; maxImages?: number; mcpPayments?: boolean } = {},
): McpServer {
  const server = new McpServer({ name: "a-eye", version: "0.1.0" });

  server.registerTool(
    "ask_location_question",
    {
      title: "Ask people at a location",
      description:
        "Ask a question about what is physically happening at a place right now. Verified people nearby answer with an in-app photo. You pay the raffle prize (AUSD on Base Sepolia, via x402) when asking.",
      inputSchema: askQuestionShape,
    },
    async (args, extra) => {
      try {
        if (mcpPayments) {
          const payment = extra._meta?.["x402/payment"] as PaymentPayload | undefined;
          const { response, receipt } = await api.askQuestionPaid(CreateQuestionInput.parse(args), payment);
          return {
            ...json(response),
            ...(receipt && { _meta: { "x402/payment-response": receipt } }),
          };
        }
        return json(await api.askQuestion(CreateQuestionInput.parse(args)));
      } catch (err) {
        if (mcpPayments && err instanceof PaymentRequiredError && err.paymentRequired) {
          const amount = err.paymentRequired.accepts[0];
          const units = amount && "amount" in amount ? amount.amount : amount && "maxAmountRequired" in amount ? amount.maxAmountRequired : "0";
          const hint = `Needs an x402 payment of ${Number(units) / 1_000_000} AUSD on Base Sepolia (eip155:84532). Use an x402-aware MCP client (@x402/mcp) that retries with _meta["x402/payment"], or run the a-eye-mcp stdio server with AGENT_PRIVATE_KEY.`;
          return {
            isError: true,
            structuredContent: err.paymentRequired,
            content: [
              { type: "text", text: JSON.stringify(err.paymentRequired) },
              { type: "text", text: hint },
            ],
          };
        }
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_question_results",
    {
      title: "Get question results",
      description:
        "Percent per answer, response count, gallery link, raffle info and (optionally) evidence photos downscaled to about 512 px, capped at 8 images by default. Each evidence item carries observer_reputation — how often that observer agreed with the crowd on past closed questions, plus their answer count — so you can weight answers.",
      inputSchema: {
        question_id: z.string(),
        include_images: z.boolean().default(true),
      },
    },
    async ({ question_id, include_images }) => {
      try {
        return await resultsContent(api, await api.getResults(question_id), include_images, maxImages);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "wait_for_results",
    {
      title: "Wait for results",
      description:
        "Block until the question closes or the timeout passes, then return the results. Each evidence item carries observer_reputation — how often that observer agreed with the crowd on past closed questions, plus their answer count — so you can weight answers.",
      inputSchema: {
        question_id: z.string(),
        timeout_s: z.number().int().min(1).max(1800).default(300),
        include_images: z.boolean().default(true),
      },
    },
    async ({ question_id, timeout_s, include_images }) => {
      try {
        const deadline = Date.now() + timeout_s * 1000;
        let results = await api.getResults(question_id);
        while (results.status === "open" && Date.now() < deadline) {
          await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
          results = await api.getResults(question_id);
        }
        return await resultsContent(api, results, include_images, maxImages);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "check_coverage",
    {
      title: "Check observer coverage",
      description: "How many observers were recently active near a point, so you can tell whether asking is likely to get answers.",
      inputSchema: { lat: askQuestionShape.lat, lng: askQuestionShape.lng },
    },
    async ({ lat, lng }) => {
      try {
        return json(await api.coverage(lat, lng));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_my_questions",
    {
      title: "List my questions",
      description: "Questions this agent has asked.",
      inputSchema: {},
    },
    async () => {
      try {
        return json(await api.listMyQuestions());
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}
