import type {
  Coverage,
  CreateQuestionInput,
  CreateQuestionResponse,
  QuestionResults,
  QuestionSummary,
} from "@a-eye/shared";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, SettleResponse } from "@x402/core/types";
import { paymentResponseFromHeaders, paymentTxFromHeaders } from "./payments";
import { downscaleImage } from "./images";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class PaymentRequiredError extends ApiError {
  constructor(
    message: string,
    readonly paymentRequired: PaymentRequired | null,
  ) {
    super(402, message);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PeekResults = QuestionResults & { paid: boolean; payment_tx: string | null };

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
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path, this.baseUrl).toString(), {
        ...init,
        headers: { "content-type": "application/json", "x-a-eye-agent": this.agentLabel, ...init?.headers },
      });
    } catch (cause) {
      const causeMessage = cause instanceof Error ? cause.message : String(cause);
      throw new ApiError(0, `Could not reach the A-eye API at ${this.baseUrl} (${causeMessage}). Check A_EYE_API_URL.`);
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      let message =
        body && typeof body === "object" && "error" in body ? String(body.error) : `${res.status} ${res.statusText}`;
      if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
        message += `: ${body.message}`;
      }
      if (body && typeof body === "object" && "issues" in body && Array.isArray(body.issues)) {
        const issues = body.issues.slice(0, 5).flatMap((issue) => {
          if (!issue || typeof issue !== "object") return [];
          const detail = issue as { path?: unknown; message?: unknown };
          if (typeof detail.message !== "string") return [];
          const path = Array.isArray(detail.path) ? detail.path.map(String).join(".") : "";
          return [`${path ? `${path}: ` : ""}${detail.message}`];
        });
        if (issues.length) message += `: ${issues.join("; ")}`;
      }
      const errorMessage =
        res.status === 402 && !this.paysAutomatically
          ? `${message}. Set AGENT_PRIVATE_KEY (a Base Sepolia wallet holding AUSD) so the MCP server can pay via x402.`
          : message;
      if (res.status === 402) {
        let paymentRequired: PaymentRequired | null = null;
        const header = res.headers.get("PAYMENT-REQUIRED");
        if (header) {
          try {
            paymentRequired = decodePaymentRequiredHeader(header);
          } catch {
            paymentRequired = null;
          }
        }
        if (
          !paymentRequired &&
          body &&
          typeof body === "object" &&
          "x402Version" in body &&
          "accepts" in body &&
          Array.isArray(body.accepts)
        ) {
          paymentRequired = body as PaymentRequired;
        }
        throw new PaymentRequiredError(errorMessage, paymentRequired);
      }
      throw new ApiError(res.status, errorMessage);
    }
    return { data: body as T, headers: res.headers };
  }

  async askQuestion(input: CreateQuestionInput): Promise<CreateQuestionResponse> {
    return (await this.askQuestionPaid(input)).response;
  }

  async askQuestionPaid(
    input: CreateQuestionInput,
    payment?: PaymentPayload,
  ): Promise<{ response: CreateQuestionResponse; receipt: SettleResponse | null }> {
    const { data, headers } = await this.requestWithHeaders<CreateQuestionResponse>("/api/questions", {
      method: "POST",
      body: JSON.stringify(input),
      ...(payment && { headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payment) } }),
    });
    return {
      response: { ...data, payment_tx: data.payment_tx ?? paymentTxFromHeaders(headers) },
      receipt: paymentResponseFromHeaders(headers),
    };
  }

  async getResults(questionId: string) {
    const results = await this.request<QuestionResults>(`/api/questions/${encodeURIComponent(questionId)}`);
    if (!Array.isArray(results?.tally) || !Array.isArray(results?.evidence)) {
      throw new ApiError(502, `Unexpected response from A-eye API for question ${questionId}`);
    }
    return results;
  }

  async peekResults(questionId: string): Promise<PeekResults> {
    return (await this.peekResultsPaid(questionId)).response;
  }

  async peekResultsPaid(
    questionId: string,
    payment?: PaymentPayload,
  ): Promise<{ response: PeekResults; receipt: SettleResponse | null }> {
    const { data, headers } = await this.requestWithHeaders<PeekResults>(
      `/api/questions/${encodeURIComponent(questionId)}/peek`,
      payment && { headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payment) } },
    );
    return {
      response: { ...data, payment_tx: data.payment_tx ?? paymentTxFromHeaders(headers) },
      receipt: paymentResponseFromHeaders(headers),
    };
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
