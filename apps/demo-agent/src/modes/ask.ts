import { runAgent, type ToolHandler } from "../agent.js";
import type { LlmConfig } from "../config.js";
import type { McpBridge } from "../mcp-bridge.js";
import { formatRaffle, formatSummary, parseResults, type ParsedResults } from "../results.js";
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";

export type AskArgs = {
  question: string;
  lat: number;
  lng: number;
  minutes: number;
  prize: number;
  radius: number;
};

const SYSTEM = `You are an agent that answers questions by asking humans on the ground through the A-eye tools.

Steps:
1. Call check_coverage for the location.
2. Call ask_location_question with the question and 2-4 crisp options (put yes/no first when natural). Use the field names from the tool schema and the provided lat/lng/radius/prize/closing window.
3. Call wait_for_results with timeout_s = the requested window plus 60 seconds (max 1800). If the question is still open when it returns, call it again until the status is closed or settled.
4. Look at the returned photos when present, then answer concisely and cite the gallery link.`;

export async function runAskMode(llm: LlmConfig, bridge: McpBridge, args: AskArgs, log: (l: string) => void) {
  const tools = await bridge.openAiTools();
  let latest: ParsedResults | undefined;
  const handlers: ToolHandler[] = tools.map((definition: ChatCompletionFunctionTool) => ({
    definition,
    run: async (toolArgs) => {
      const res = await bridge.callTool(definition.function.name, toolArgs);
      const name = definition.function.name;
      if (name === "get_question_results" || name === "wait_for_results") {
        latest = parseResults(res.text) ?? latest;
      }
      return { text: res.text, images: res.images };
    },
  }));

  const timeoutS = Math.min(args.minutes * 60 + 60, 1800);
  const user = `Question: ${args.question}
Location: lat ${args.lat}, lng ${args.lng} (radius ${args.radius} m)
Bounty: ${args.prize} AUSD · close in ${args.minutes} minutes · wait timeout_s ${timeoutS}`;

  const answer = await runAgent({
    client: llm.client,
    model: llm.model,
    vision: llm.vision,
    system: SYSTEM,
    user,
    tools: handlers,
    log,
  });

  const out: string[] = [answer];
  if (latest) {
    out.push("", formatSummary(latest), formatRaffle(latest));
  }
  return out.join("\n");
}
