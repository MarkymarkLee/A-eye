/**
 * Live AUSD proof on Base Sepolia against a running A-eye server with x402 enabled
 * (treasury key set, ALLOW_UNPAID_QUESTIONS unset). Every transfer is gasless for
 * the agent and the treasury: the x402 facilitator submits ERC-3009 authorizations.
 *
 *   A_EYE_API_URL=http://localhost:3000 npx tsx scripts/ausd-live-demo.mts
 *
 * 1. Agent pays a question bounty via x402.  2. One observer answers.
 * 3. Agent buys a peek (x402) of the sealed interim results.  4. A second observer
 * answers, hitting max_responses, so the raffle draws and the treasury pays the winner
 * (pot minus 10%).  5. A second paid question expires with no answers and is refunded.
 */
import { randomBytes } from "node:crypto";
import { AUSD } from "@a-eye/shared";
import sharp from "sharp";
import { createPublicClient, erc20Abi, formatUnits, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { agentPrivateKey, createPayingFetch, paymentTxFromHeaders } from "../packages/mcp/src/payments.ts";

const API = process.env.A_EYE_API_URL ?? "http://localhost:3000";
const configuredPayoutTimeout = Number(process.env.DEMO_PAYOUT_TIMEOUT_MS);
const DEMO_PAYOUT_TIMEOUT_MS =
  process.env.DEMO_PAYOUT_TIMEOUT_MS && Number.isFinite(configuredPayoutTimeout) && configuredPayoutTimeout >= 0
    ? configuredPayoutTimeout
    : 120_000;
let payoutFlowMissing = false;
const SPOT = { lat: 37.8716, lng: -122.2536 };
const scan = (tx: string | null | undefined) => (tx ? `https://sepolia.basescan.org/tx/${tx}` : "(none)");
const chain = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org") });
const ausd = (addr: Hex) => chain.readContract({ address: AUSD.address, abi: erc20Abi, functionName: "balanceOf", args: [addr] }).then((b) => formatUnits(b, 6));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const key = agentPrivateKey();
if (!key) throw new Error("Set A_EYE_AGENT_PRIVATE_KEY");
const { fetch: pay, address: agent } = createPayingFetch(key, { maxPaymentUnits: 1_000_000n });
const TREASURY = "0x293214291186180810902D97994c2C72fE88255A" as Hex;
const winners = [privateKeyToAccount(generatePrivateKey()).address, privateKeyToAccount(generatePrivateKey()).address];

async function balances(label: string) {
  const [a, t, w0, w1] = await Promise.all([ausd(agent), ausd(TREASURY), ausd(winners[0]!), ausd(winners[1]!)]);
  console.log(`[${label}] AUSD agent ${a} · treasury ${t} · observerA ${w0} · observerB ${w1}`);
}

async function json(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}

const questionResults = (id: string) => fetch(`${API}/api/questions/${id}`).then(json);

async function pollQuestion(
  id: string,
  label: string,
  isComplete: (result: any) => boolean,
  status: (result: any) => string | undefined,
) {
  const deadline = Date.now() + DEMO_PAYOUT_TIMEOUT_MS;
  let result = await questionResults(id);
  let nextStatusLog = Date.now() + 15_000;
  while (!isComplete(result) && Date.now() < deadline) {
    await sleep(Math.min(5_000, Math.max(0, deadline - Date.now())));
    result = await questionResults(id);
    if (!isComplete(result) && Date.now() >= nextStatusLog) {
      console.log(`   ${label} pending (status ${status(result) ?? "unknown"})`);
      nextStatusLog = Date.now() + 15_000;
    }
  }
  if (!isComplete(result)) {
    console.error(
      `   ${label} not seen within ${DEMO_PAYOUT_TIMEOUT_MS / 1000}s (status ${status(result) ?? "unknown"})`,
    );
    payoutFlowMissing = true;
  }
  return result;
}

async function ask(prize_usd: number, extra: Record<string, unknown>) {
  const res = await pay(`${API}/api/questions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-a-eye-agent": "ausd-live-demo" },
    body: JSON.stringify({ ...SPOT, question: "Is there a line at the coffee cart outside Chou Hall?", options: ["Yes", "No"], prize_usd, ...extra }),
  });
  const body = await json(res);
  return { id: body.question_id as string, tx: (body.payment_tx as string | null) ?? paymentTxFromHeaders(res.headers) };
}

async function observer(name: string, evm: string) {
  const res = await fetch(`${API}/api/me`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: name, evm_address: evm }) });
  await json(res);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  return cookie;
}

async function answer(cookie: string, id: string, option: number) {
  const jpeg = await sharp(randomBytes(64 * 48 * 3), { raw: { width: 64, height: 48, channels: 3 } }).jpeg().toBuffer();
  const form = new FormData();
  form.set("option_index", String(option));
  form.set("lat", String(SPOT.lat));
  form.set("lng", String(SPOT.lng));
  form.set("accuracy_m", "8");
  form.set("captured_at", new Date().toISOString());
  form.set("image", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "photo.jpg");
  return json(await fetch(`${API}/api/questions/${id}/submissions`, { method: "POST", headers: { cookie }, body: form }));
}

await balances("before");

console.log("\n1) Agent pays a 0.10 AUSD bounty over x402");
const q1 = await ask(0.1, { min_responses: 1, max_responses: 2, closes_in_minutes: 15 });
console.log(`   question ${q1.id} bounty tx ${scan(q1.tx)}`);

const a = await observer("Live Demo A", winners[0]!);
const b = await observer("Live Demo B", winners[1]!);
await answer(a, q1.id, 0);
console.log("2) Observer A answered");

const sealed = await json(await fetch(`${API}/api/questions/${q1.id}`));
console.log(`3) Free results: sealed=${sealed.sealed} evidence=${sealed.evidence.length} responses=${sealed.responses} peek=${JSON.stringify(sealed.peek)}`);
const peekRes = await pay(`${API}/api/questions/${q1.id}/peek`, { headers: { "x-a-eye-agent": "ausd-live-demo" } });
const peek = await json(peekRes);
const peekTx = peek.payment_tx ?? paymentTxFromHeaders(peekRes.headers);
console.log(`   peek paid=${peek.paid} tally=${JSON.stringify(peek.tally)} pot=${peek.pot_usd} tx ${scan(peekTx)}`);

await answer(b, q1.id, 1);
console.log("4) Observer B answered (max_responses reached → raffle + payout)");
const r1 = await pollQuestion(
  q1.id,
  "payout",
  (result) => Boolean(result.raffle?.payout_tx),
  (result) => result.raffle?.payout_status,
);
console.log(`   status ${r1.status}, winner ${r1.raffle.winner_observer}, payout ${r1.raffle.prize_amount} AUSD tx ${scan(r1.raffle.payout_tx)}`);

console.log("\n5) Agent pays a 0.05 AUSD bounty for a question nobody answers (min 3, closes in 1 min)");
const q2 = await ask(0.05, { min_responses: 3, max_responses: 5, closes_in_minutes: 1 });
console.log(`   question ${q2.id} bounty tx ${scan(q2.tx)}`);
await sleep(62_000);
const r2 = await pollQuestion(
  q2.id,
  "refund",
  (result) => result.ausd_flows?.some((f: { kind: string }) => f.kind === "refund") ?? false,
  (result) => result.status,
);
const refund = r2.ausd_flows?.find((f: { kind: string }) => f.kind === "refund");
console.log(`   status ${r2.status}, refund ${refund?.amount} AUSD tx ${scan(refund?.tx)}`);

console.log("\nAUSD flows:");
for (const f of [...r1.ausd_flows, ...r2.ausd_flows]) console.log(`   ${f.kind.padEnd(7)} ${String(f.amount).padStart(5)} AUSD  ${f.from_label} → ${f.to_label}  ${f.url}`);
await balances("after");
if (payoutFlowMissing) process.exitCode = 1;
