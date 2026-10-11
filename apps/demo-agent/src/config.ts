import OpenAI from "openai";

export type LlmConfig = {
  client: OpenAI;
  model: string;
  vision: boolean;
  provider: "openai" | "deepseek";
};

export const DEFAULT_A_EYE_API_URL = "https://a-eye-1zsv.onrender.com";

export function aEyeApiUrl(): string {
  return process.env.A_EYE_API_URL ?? DEFAULT_A_EYE_API_URL;
}

/**
 * Pick an LLM. OpenAI wins when OPENAI_API_KEY is set; otherwise DeepSeek.
 * AGENT_VISION=0|1 overrides the provider default.
 */
export function loadLlm(): LlmConfig {
  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: process.env.OPENAI_MODEL ?? "gpt-4.1",
      vision: visionOverride() ?? true,
      provider: "openai",
    };
  }
  if (process.env.DEEPSEEK_API_KEY) {
    // deepseek-chat (currently aliased to deepseek-flash) accepts image_url parts.
    return {
      client: new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: "https://api.deepseek.com",
      }),
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      vision: visionOverride() ?? true,
      provider: "deepseek",
    };
  }
  throw new Error(
    "No LLM configured: set OPENAI_API_KEY or DEEPSEEK_API_KEY.",
  );
}

function visionOverride(): boolean | undefined {
  const v = process.env.AGENT_VISION;
  if (v === "1") return true;
  if (v === "0") return false;
  return undefined;
}
