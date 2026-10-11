import type {
  Coverage,
  CreateQuestionInput,
  CreateQuestionResponse,
  QuestionResults,
  QuestionSummary,
} from "@a-eye/shared";

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
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(new URL(path, this.baseUrl).toString(), {
      ...init,
      headers: { "content-type": "application/json", "x-a-eye-agent": this.agentLabel, ...init?.headers },
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        body && typeof body === "object" && "error" in body ? String(body.error) : `${res.status} ${res.statusText}`;
      throw new ApiError(res.status, message);
    }
    return body as T;
  }

  askQuestion(input: CreateQuestionInput) {
    return this.request<CreateQuestionResponse>("/api/questions", { method: "POST", body: JSON.stringify(input) });
  }

  getResults(questionId: string) {
    return this.request<QuestionResults>(`/api/questions/${encodeURIComponent(questionId)}`);
  }

  coverage(lat: number, lng: number) {
    return this.request<Coverage>(`/api/coverage?lat=${lat}&lng=${lng}`);
  }

  async listMyQuestions() {
    return (await this.request<{ questions: QuestionSummary[] }>("/api/questions/mine")).questions;
  }

  async fetchImage(url: string): Promise<{ data: string; mimeType: string } | null> {
    const res = await this.fetchImpl(url);
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType };
  }
}
