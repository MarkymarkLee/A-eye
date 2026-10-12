import { describe, expect, it } from "vitest";
import { runAgent, type ToolHandler } from "../src/agent.js";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

type Msg = ChatCompletionMessageParam;

function fakeClient(script: ((msgs: Msg[], tools: ChatCompletionTool[]) => unknown)[]) {
  const seen: Msg[][] = [];
  const client = {
    chat: {
      completions: {
        create: async (req: { messages: Msg[]; tools: ChatCompletionTool[] }) => {
          seen.push([...req.messages]);
          const msg = script[seen.length - 1]?.(req.messages, req.tools) ?? {
            role: "assistant",
            content: "done",
          };
          return { choices: [{ message: msg }] };
        },
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, seen };
}

const tool: ToolHandler = {
  definition: {
    type: "function",
    function: { name: "get_photo", description: "returns a photo", parameters: { type: "object" } },
  },
  run: async (args) => ({
    text: `args:${JSON.stringify(args)}`,
    images: [{ data: "QUJD", mimeType: "image/jpeg" }],
  }),
};

const toolCall = {
  id: "call_1",
  type: "function" as const,
  function: { name: "get_photo", arguments: '{"a":1}' },
};

describe("runAgent", () => {
  it("invokes the tool with parsed args and returns final text", async () => {
    let got: unknown;
    const t: ToolHandler = {
      ...tool,
      run: async (args) => {
        got = args;
        return { text: "ok" };
      },
    };
    const { client } = fakeClient([
      () => ({ role: "assistant", content: null, tool_calls: [toolCall] }),
      () => ({ role: "assistant", content: "final answer" }),
    ]);
    const out = await runAgent({
      client,
      model: "m",
      vision: false,
      system: "s",
      user: "u",
      tools: [t],
    });
    expect(got).toEqual({ a: 1 });
    expect(out).toBe("final answer");
  });

  it("adds an image user message when vision is on", async () => {
    const { client, seen } = fakeClient([
      () => ({ role: "assistant", content: null, tool_calls: [toolCall] }),
      () => ({ role: "assistant", content: "saw it" }),
    ]);
    await runAgent({ client, model: "m", vision: true, system: "s", user: "u", tools: [tool] });
    const secondCallMsgs = seen[1]!;
    const last = secondCallMsgs[secondCallMsgs.length - 1] as {
      role: string;
      content: { type: string; image_url?: { url: string } }[];
    };
    expect(last.role).toBe("user");
    expect(last.content[0]).toMatchObject({ type: "text" });
    expect(last.content[1]).toMatchObject({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,QUJD" },
    });
  });

  it("appends the omission note when vision is off", async () => {
    const { client, seen } = fakeClient([
      () => ({ role: "assistant", content: null, tool_calls: [toolCall] }),
      () => ({ role: "assistant", content: "done" }),
    ]);
    await runAgent({ client, model: "m", vision: false, system: "s", user: "u", tools: [tool] });
    const toolMsg = seen[1]!.find((m) => m.role === "tool") as { content: string };
    expect(toolMsg.content).toContain("[1 photo(s) omitted: model has no vision]");
  });

  it("returns bad-JSON errors to the model", async () => {
    const { client, seen } = fakeClient([
      () => ({
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c", type: "function", function: { name: "get_photo", arguments: "{bad" } }],
      }),
      () => ({ role: "assistant", content: "recovered" }),
    ]);
    const out = await runAgent({ client, model: "m", vision: true, system: "s", user: "u", tools: [tool] });
    const toolMsg = seen[1]!.find((m) => m.role === "tool") as { content: string };
    expect(toolMsg.content).toContain("Invalid JSON arguments");
    expect(out).toBe("recovered");
  });

  it("stops at maxSteps", async () => {
    const { client } = fakeClient(
      Array.from({ length: 5 }, () => () => ({
        role: "assistant",
        content: null,
        tool_calls: [toolCall],
      })),
    );
    const out = await runAgent({
      client,
      model: "m",
      vision: false,
      system: "s",
      user: "u",
      tools: [tool],
      maxSteps: 3,
    });
    expect(out).toContain("max tool steps (3)");
  });
});
