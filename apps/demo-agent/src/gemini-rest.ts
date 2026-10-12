import { createHmac } from "node:crypto";

const BASE_URL = "https://api.sandbox.gemini.com";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type GeminiOrder = Record<string, unknown> & {
  orderId?: string;
  globalOrderId?: string;
  hashOrderId?: string;
  status?: string;
  filledQuantity?: string | number;
  remainingQuantity?: string | number;
  avgPrice?: string | number;
};

export type OrderSpec = {
  symbol: string;
  orderType: "limit";
  side: "buy";
  outcome: "yes" | "no";
  quantity: string;
  price: string;
  timeInForce: "good-til-cancel";
  makerOrCancel: false;
};

export function parseGeminiJson<T = unknown>(text: string): T {
  const safe = text.replace(/("(?:orderId|globalOrderId)"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"');
  return JSON.parse(safe) as T;
}

export class GeminiRestClient {
  private lastNonce = 0;
  private privateQueue: Promise<void> = Promise.resolve();
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly account: string;

  constructor(opts: {
    apiKey?: string;
    apiSecret?: string;
    account?: string;
    fetch?: FetchLike;
    now?: () => number;
  } = {}) {
    this.apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this.apiSecret = opts.apiSecret ?? process.env.GEMINI_API_SECRET ?? "";
    this.account = opts.account ?? process.env.GEMINI_ACCOUNT ?? "primary";
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  private privatePost<T>(request: string, fields: Record<string, unknown> = {}, rawFields?: string): Promise<T> {
    const run = this.privateQueue.then(async () => {
      if (!this.apiKey || !this.apiSecret) throw new Error("Gemini sandbox credentials are not configured.");
      const nonce = Math.max(Math.floor(this.now() / 1000), this.lastNonce + 1);
      this.lastNonce = nonce;
      const payload = rawFields === undefined
        ? JSON.stringify({ request, nonce, account: this.account, ...fields })
        : `{"request":${JSON.stringify(request)},"nonce":${nonce},"account":${JSON.stringify(this.account)},${rawFields}}`;
      const encoded = Buffer.from(payload).toString("base64");
      const signature = createHmac("sha384", this.apiSecret).update(encoded).digest("hex");
      const body = rawFields === undefined ? JSON.stringify(fields) : `{${rawFields}}`;
      const response = await this.fetchImpl(`${BASE_URL}${request}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-GEMINI-APIKEY": this.apiKey,
          "X-GEMINI-PAYLOAD": encoded,
          "X-GEMINI-SIGNATURE": signature,
        },
        body,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Gemini sandbox request failed (${response.status}).`);
      try {
        return parseGeminiJson<T>(text);
      } catch {
        throw new Error("Gemini sandbox returned an invalid response.");
      }
    });
    this.privateQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  placeOrder(order: OrderSpec): Promise<GeminiOrder> {
    const { quantity, ...rest } = order;
    return this.privatePost("/v1/prediction-markets/order", { ...rest, quantity });
  }

  cancelOrder(id: string): Promise<unknown> {
    if (!/^\d+$/.test(id)) throw new Error("Invalid Gemini order id.");
    return this.privatePost(
      "/v1/prediction-markets/order/cancel",
      {},
      `"orderId":${id}`,
    );
  }

  activeOrders(symbol?: string): Promise<GeminiOrder[]> {
    return this.listOrders("/v1/prediction-markets/orders/active", symbol);
  }

  orderHistory(symbol?: string): Promise<GeminiOrder[]> {
    return this.listOrders("/v1/prediction-markets/orders/history", symbol);
  }

  positions(): Promise<unknown> {
    return this.privatePost("/v1/prediction-markets/positions");
  }

  private async listOrders(request: string, symbol?: string): Promise<GeminiOrder[]> {
    const response = await this.privatePost<unknown>(request, symbol ? { symbol } : {});
    if (Array.isArray(response)) return response as GeminiOrder[];
    if (response && typeof response === "object") {
      const body = response as Record<string, unknown>;
      for (const key of ["orders", "data", "results"]) {
        if (Array.isArray(body[key])) return body[key] as GeminiOrder[];
      }
    }
    return [];
  }
}

export { BASE_URL as GEMINI_SANDBOX_BASE_URL };
