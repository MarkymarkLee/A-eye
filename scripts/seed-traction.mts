import { AUSD, CreateQuestionInput } from "@a-eye/shared";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { agentPrivateKey, createPayingFetch, paymentTxFromHeaders } from "../packages/mcp/src/payments.ts";

const API = process.env.A_EYE_API_URL ?? "https://a-eye-1zsv.onrender.com";
const CHOU = { lat: 37.8716, lng: -122.2536 };
const COURTYARD = { lat: 37.8713, lng: -122.2532 };
const SEEDS = [
  { ...CHOU, place_label: "Chou Hall", radius_m: 200, question: "Is the snack table stocked right now?", options: ["Fully stocked", "Running low", "Picked clean"], prize_usd: 0.15, closes_in_minutes: 45, max_responses: 5 },
  { ...CHOU, place_label: "Chou Hall", radius_m: 250, question: "How long is the line at the coffee cart?", options: ["No line", "Under 5 min", "5 to 15 min", "Over 15 min"], prize_usd: 0.15, closes_in_minutes: 60, max_responses: 5 },
  { ...CHOU, place_label: "Chou Hall", radius_m: 200, question: "Is the main hall more than half full?", options: ["Packed", "About half", "Mostly empty"], prize_usd: 0.1, closes_in_minutes: 90, max_responses: 6 },
  { ...COURTYARD, place_label: "Haas courtyard", radius_m: 250, question: "Is the Haas courtyard sunny right now?", options: ["Full sun", "Partly sunny", "Shady or cloudy"], prize_usd: 0.1, closes_in_minutes: 120, max_responses: 5 },
  { ...CHOU, place_label: "Chou Hall", radius_m: 200, question: "Are there free power outlets in the main hacking room?", options: ["Plenty", "A few", "None left"], prize_usd: 0.1, closes_in_minutes: 75, max_responses: 6 },
  { ...CHOU, place_label: "Chou Hall", radius_m: 200, question: "Is there an open table for a team of 4 in Chou Hall?", options: ["Yes, easy", "Took some looking", "Nope"], prize_usd: 0.2, closes_in_minutes: 150, max_responses: 4 },
  { ...CHOU, place_label: "Chou Hall", radius_m: 200, question: "Is the Wi-Fi fast enough to push to GitHub?", options: ["Fast", "Slow but works", "Barely"], prize_usd: 0.1, closes_in_minutes: 100, max_responses: 6 },
  { ...CHOU, place_label: "Chou Hall", radius_m: 250, question: "Is anyone handing out sponsor swag right now?", options: ["Yes, go now", "Some left", "All gone"], prize_usd: 0.25, closes_in_minutes: 30, max_responses: 3 },
  { ...CHOU, place_label: "Chou Hall", radius_m: 200, question: "How loud is the main hacking room?", options: ["Library quiet", "Chatty", "Party loud"], prize_usd: 0.05, closes_in_minutes: 180, max_responses: 8 },
  { ...CHOU, place_label: "Chou Hall", radius_m: 250, question: "What's the vibe at B@BHacks right now?", options: ["Locked in", "Snack break", "Demo panic", "Napping"], prize_usd: 0.05, closes_in_minutes: 180, max_responses: 8 },
  { ...COURTYARD, place_label: "Haas courtyard", radius_m: 300, question: "Can you see the Campanile from the Haas courtyard?", options: ["Clear view", "Hazy", "Can't see it"], prize_usd: 0.05, closes_in_minutes: 150, max_responses: 4 },
];

const MICRO_AUSD = 1_000_000;
const chain = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
});

function parseArgs(args: string[]) {
  let live = false;
  let only: Set<number> | undefined;
  let maxSpend = 2;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--live") {
      live = true;
    } else if (arg === "--only") {
      const value = args[++i];
      if (!value) throw new Error("--only requires comma-separated 1-based seed indices");
      const indices = value.split(",").map((part) => Number(part));
      if (indices.some((index) => !Number.isInteger(index) || index < 1 || index > SEEDS.length)) {
        throw new Error(`--only indices must be between 1 and ${SEEDS.length}`);
      }
      only = new Set(indices);
    } else if (arg === "--max-spend") {
      const value = Number(args[++i]);
      if (!Number.isFinite(value) || value < 0) throw new Error("--max-spend must be a non-negative number");
      maxSpend = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { live, only, maxSpend };
}

function validateSeeds() {
  return SEEDS.map((seed, index) => {
    if (seed.options.length < 2 || seed.options.length > 5) throw new Error(`Seed ${index + 1}: options must number 2–5`);
    if (seed.closes_in_minutes < 30 || seed.closes_in_minutes > 180) {
      throw new Error(`Seed ${index + 1}: closes_in_minutes must be 30–180`);
    }
    if (seed.max_responses < 3 || seed.max_responses > 8) throw new Error(`Seed ${index + 1}: max_responses must be 3–8`);
    if (seed.prize_usd < 0.05 || seed.prize_usd > 0.25) throw new Error(`Seed ${index + 1}: prize_usd must be 0.05–0.25`);
    return CreateQuestionInput.parse({ ...seed, min_responses: 1 });
  });
}

function toUnits(amount: number): bigint {
  return BigInt(Math.round(amount * MICRO_AUSD));
}

function formatTable(rows: Array<{ index: number; prompt: string; place: string; radius: number; options: number; prize: number; closes: number; max: number; action: string }>) {
  console.log("Index | Prompt                                              | Place          | Radius | Options | Prize | Closes | Max | Action");
  for (const row of rows) {
    console.log(
      `${String(row.index).padStart(5)} | ${row.prompt.padEnd(52)} | ${row.place.padEnd(14)} | ${String(row.radius).padStart(6)} | ${String(row.options).padStart(7)} | ${row.prize.toFixed(2).padStart(5)} | ${String(row.closes).padStart(6)} | ${String(row.max).padStart(3)} | ${row.action}`,
    );
  }
}

async function readBalance(address: `0x${string}`): Promise<bigint> {
  return chain.readContract({
    address: AUSD.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

function responseError(status: number, body: unknown): string {
  return `${status} ${typeof body === "string" ? body : JSON.stringify(body)}`;
}

async function main() {
  const { live, only, maxSpend } = parseArgs(process.argv.slice(2));
  const validated = validateSeeds();
  const selected = validated
    .map((input, index) => ({ input, index }))
    .filter(({ index }) => !only || only.has(index + 1));
  const key = agentPrivateKey();
  if (live && !key) throw new Error("Live posting requires A_EYE_AGENT_PRIVATE_KEY");

  const response = await fetch(`${API}/api/questions`);
  const openBody = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(openBody?.questions)) {
    throw new Error(`GET ${API}/api/questions failed: ${responseError(response.status, openBody)}`);
  }
  const openPrompts = new Set(
    openBody.questions
      .map((question: { prompt?: unknown }) => (typeof question.prompt === "string" ? question.prompt.trim().toLowerCase() : null))
      .filter((prompt: string | null): prompt is string => prompt !== null),
  );
  const planned = selected.map(({ input, index }) => ({
    input,
    index,
    skip: openPrompts.has(input.question.trim().toLowerCase()),
  }));
  const toPost = planned.filter(({ skip }) => !skip);
  const plannedSpend = toPost.reduce((sum, { input }) => sum + input.prize_usd, 0);
  const plannedSpendUnits = toPost.reduce((sum, { input }) => sum + toUnits(input.prize_usd), 0n);
  const maxSpendUnits = toUnits(maxSpend);
  if (plannedSpendUnits > maxSpendUnits) {
    throw new Error(`Planned spend ${plannedSpend.toFixed(2)} AUSD exceeds --max-spend ${maxSpend} AUSD`);
  }

  formatTable(
    planned.map(({ input, index, skip }) => ({
      index: index + 1,
      prompt: input.question,
      place: input.place_label ?? "",
      radius: input.radius_m,
      options: input.options.length,
      prize: input.prize_usd,
      closes: input.closes_in_minutes,
      max: input.max_responses,
      action: skip ? "SKIP" : "POST",
    })),
  );
  console.log(`Total to post: ${plannedSpend.toFixed(2)} AUSD (${toPost.length} question${toPost.length === 1 ? "" : "s"})`);

  if (!live) console.log("DRY RUN — pass --live to post");

  let agent: `0x${string}` | undefined;
  if (key) {
    agent = privateKeyToAccount(key).address;
    const balance = await readBalance(agent);
    console.log(`Agent ${agent} · AUSD balance ${formatUnits(balance, 6)}`);
    if (live && balance < plannedSpendUnits) {
      throw new Error(`Agent AUSD balance ${formatUnits(balance, 6)} is below planned spend ${plannedSpend.toFixed(2)}`);
    }
  }

  if (!live) return;
  const { fetch: pay } = createPayingFetch(key!, { maxPaymentUnits: 250_000n });
  const posted: Array<{ id: string; prompt: string; prize_usd: number; tx: string | null }> = [];

  for (let i = 0; i < toPost.length; i += 1) {
    const { input } = toPost[i]!;
    try {
      const result = await pay(`${API}/api/questions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-a-eye-agent": "a-eye-hackathon-seed" },
        body: JSON.stringify(input),
      });
      const body = await result.json().catch(() => null);
      if (!result.ok) {
        console.error(`Failed to post "${input.question}": ${responseError(result.status, body)}`);
      } else {
        const id = body?.question_id;
        if (typeof id !== "string") {
          console.error(`Posted "${input.question}" but response did not include question_id: ${JSON.stringify(body)}`);
        } else {
          const tx = (typeof body.payment_tx === "string" ? body.payment_tx : null) ?? paymentTxFromHeaders(result.headers);
          posted.push({ id, prompt: input.question, prize_usd: input.prize_usd, tx });
          console.log(`Posted ${id} · ${input.question} · ${tx ? `https://sepolia.basescan.org/tx/${tx}` : "(no payment tx)"}`);
          console.log(`${API}/q/${id}`);
        }
      }
    } catch (error) {
      console.error(`Failed to post "${input.question}": ${error instanceof Error ? error.message : String(error)}`);
    }
    if (i < toPost.length - 1) await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  const balanceAfter = await readBalance(agent!);
  console.log(`Agent AUSD balance after: ${formatUnits(balanceAfter, 6)}`);
  console.log(JSON.stringify(posted));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
