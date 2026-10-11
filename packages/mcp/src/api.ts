import {
  AskQuestionResponse,
  Coverage,
  QuestionResults,
  QuestionSummary,
  type AskQuestionInput,
} from "@a-eye/shared";
import { z } from "zod";

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
  ) {}

  private async request<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(new URL(path, this.baseUrl).toString(), {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        body && typeof body === "object" && "error" in body ? String(body.error) : `${res.status} ${res.statusText}`;
      throw new ApiError(res.status, message);
    }
    return schema.parse(body);
  }

  askQuestion(input: AskQuestionInput) {
    return this.request(AskQuestionResponse, "/api/questions", { method: "POST", body: JSON.stringify(input) });
  }

  getResults(questionId: string) {
    return this.request(QuestionResults, `/api/questions/${encodeURIComponent(questionId)}/results`);
  }

  coverage(lat: number, lng: number) {
    return this.request(Coverage, `/api/coverage?lat=${lat}&lng=${lng}`);
  }

  listMyQuestions() {
    return this.request(z.array(QuestionSummary), "/api/questions/mine");
  }

  async fetchImage(url: string): Promise<{ data: string; mimeType: string } | null> {
    const res = await this.fetchImpl(url);
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType };
  }
}
