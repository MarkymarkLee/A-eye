import type OpenAI from "openai";
import type {
  ChatCompletionContentPart,
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ToolImage } from "./mcp-bridge.js";

export type ToolResult = { text: string; images?: ToolImage[] };

export type ToolHandler = {
  definition: ChatCompletionFunctionTool;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
};

export type AgentOptions = {
  client: OpenAI;
  model: string;
  vision: boolean;
  system: string;
  user: string;
  tools: ToolHandler[];
  maxSteps?: number;
  log?: (line: string) => void;
};

const MAX_IMAGES_PER_TURN = 8;

export async function runAgent(opts: AgentOptions): Promise<string> {
  const { client, model, vision, tools, log } = opts;
  const maxSteps = opts.maxSteps ?? 20;
  const byName = new Map(tools.map((t) => [t.definition.function.name, t]));
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];

  for (let step = 0; step < maxSteps; step++) {
    const resp = (await client.chat.completions.create({
      model,
      messages,
      tools: tools.map((t) => t.definition),
    })) as OpenAI.ChatCompletion;
    const choice = resp.choices[0];
    if (!choice) throw new Error("LLM returned no choices");
    const msg = choice.message;
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      return msg.content ?? "";
    }

    const turnImages: { tool: string; images: ToolImage[] }[] = [];
    for (const call of calls) {
      if (call.type !== "function") continue;
      const handler = byName.get(call.function.name);
      let result: ToolResult;
      if (!handler) {
        result = { text: `Unknown tool: ${call.function.name}` };
      } else {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch (err) {
          result = {
            text: `Invalid JSON arguments: ${err instanceof Error ? err.message : String(err)}`,
          };
          messages.push({ role: "tool", tool_call_id: call.id, content: result.text });
          continue;
        }
        log?.(`→ ${call.function.name}(${call.function.arguments})`);
        try {
          result = await handler.run(args);
        } catch (err) {
          result = { text: `Tool ${call.function.name} failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
      let text = result.text;
      const images = result.images ?? [];
      if (images.length > 0) {
        if (vision) {
          turnImages.push({ tool: call.function.name, images });
        } else {
          text += `\n[${images.length} photo(s) omitted: model has no vision]`;
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: text });
    }

    // Tool messages can't carry images, so photos ride on a follow-up user turn.
    const flat = turnImages.flatMap((t) => t.images.map((img) => ({ tool: t.tool, img })));
    if (vision && flat.length > 0) {
      const capped = flat.slice(0, MAX_IMAGES_PER_TURN);
      const parts: ChatCompletionContentPart[] = [
        { type: "text", text: `Photos returned by ${[...new Set(capped.map((c) => c.tool))].join(", ")}:` },
        ...capped.map(
          ({ img }): ChatCompletionContentPart => ({
            type: "image_url",
            image_url: { url: `data:${img.mimeType};base64,${img.data}` },
          }),
        ),
      ];
      messages.push({ role: "user", content: parts });
    }
  }
  return `Stopped: reached max tool steps (${maxSteps}) without a final answer.`;
}
