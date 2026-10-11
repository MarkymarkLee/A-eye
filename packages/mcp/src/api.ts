import type {
  Coverage,
  CreateQuestionInput,
  CreateQuestionResponse,
  MarketComparison,
  QuestionResults,
  QuestionSummary,
} from "@a-eye/shared";
import { paymentTxFromHeaders } from "./payments.js";
import { downscaleImage } from "./images.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class AEyeApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly agentLabel: string = "mcp-agent",
    private readonly paysAutomatically = false,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.requestWithHeaders<T>(path, init)).data;
  }

  private async requestWithHeaders<T>(path: string, init?: RequestInit) {
    const res = await this.fetchImpl(new URL(path, this.baseUrl).toString(), {
      ...init,
      headers: { "content-type": "application/json", "x-a-eye-agent": this.agentLabel, ...init?.headers },
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        body && typeof body === "object" && "error" in body ? String(body.error) : `${res.status} ${res.statusText}`;
      throw new ApiError(
        res.status,
        res.status === 402 && !this.paysAutomatically
          ? `${message}. Set AGENT_PRIVATE_KEY (a Base Sepolia wallet holding AUSD) so the MCP server can pay via x402.`
          : message,
      );
    }
    return { data: body as T, headers: res.headers };
  }

  async askQuestion(input: CreateQuestionInput): Promise<CreateQuestionResponse> {
    const { data, headers } = await this.requestWithHeaders<CreateQuestionResponse>("/api/questions", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ...data, payment_tx: data.payment_tx ?? paymentTxFromHeaders(headers) };
  }

  getResults(questionId: string) {
    return this.request<QuestionResults>(`/api/questions/${encodeURIComponent(questionId)}`);
  }

  marketComparison(questionId: string) {
    return this.request<MarketComparison>(`/api/questions/${encodeURIComponent(questionId)}/market`);
  }

  coverage(lat: number, lng: number) {
    return this.request<Coverage>(`/api/coverage?lat=${lat}&lng=${lng}`);
  }

  async listMyQuestions() {
    return (await this.request<{ questions: QuestionSummary[] }>("/api/questions/mine")).questions;
  }

  async fetchImage(
    url: string,
    { maxPx = 512, timeoutMs = 10_000 }: { maxPx?: number; timeoutMs?: number } = {},
  ): Promise<{ data: string; mimeType: string } | null> {
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > 15 * 1024 * 1024) return null;
    const downscaled = await downscaleImage(bytes, maxPx);
    if (downscaled) return { data: downscaled.data.toString("base64"), mimeType: downscaled.mimeType };
    if (bytes.byteLength > 1024 * 1024) return null;
    return { data: Buffer.from(bytes).toString("base64"), mimeType };
  }
}
