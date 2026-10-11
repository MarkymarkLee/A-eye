import "server-only";
import { Client } from "xrpl";
import runSnapshot from "../data/xrpl-vault-run.json";
import {
  XRPL_DEVNET_WSS,
  isVaultRun,
  simulatedVaultView,
  vaultViewFromRun,
  type VaultRun,
  type VaultView,
} from "./xrpl-lending";

const LIVE_TIMEOUT_MS = 4000;

type LiveVault = NonNullable<Parameters<typeof vaultViewFromRun>[1]>["vault"];
type LiveLoan = NonNullable<Parameters<typeof vaultViewFromRun>[1]>["loan"];

function isEntryNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const data = "data" in error ? error.data : undefined;
  if (typeof data === "object" && data !== null && "error" in data) {
    return data.error === "entryNotFound" || data.error === "entry_not_found";
  }
  return error instanceof Error && /entryNotFound|entry_not_found/i.test(error.message);
}

async function readLive(client: Client, run: VaultRun): Promise<{
  vault: LiveVault;
  loan: LiveLoan;
  closeTimeIso: string;
}> {
  const [vaultResponse, ledgerResponse] = await Promise.all([
    client.request({ command: "vault_info", vault_id: run.vault_id, ledger_index: "validated" }),
    client.request({ command: "ledger", ledger_index: "validated", transactions: false }),
  ]);
  const vault = vaultResponse.result.vault;
  let loan: LiveLoan = null;
  try {
    const response = await client.request({
      command: "ledger_entry",
      index: run.loan_id,
      ledger_index: "validated",
    });
    const node = response.result.node as {
      PrincipalOutstanding?: string;
      TotalValueOutstanding?: string;
    };
    loan = {
      PrincipalOutstanding: node.PrincipalOutstanding,
      TotalValueOutstanding: node.TotalValueOutstanding,
    };
  } catch (error) {
    if (!isEntryNotFound(error)) throw error;
  }
  const ledger = ledgerResponse.result.ledger as { close_time_iso?: string } | undefined;
  if (!ledger?.close_time_iso) throw new Error("validated_close_time_missing");
  return {
    vault: {
      AssetsTotal: vault.AssetsTotal ?? "0",
      AssetsAvailable: vault.AssetsAvailable ?? "0",
      shares: { OutstandingAmount: vault.shares.OutstandingAmount },
    },
    loan,
    closeTimeIso: ledger.close_time_iso,
  };
}

export async function loadVaultView(): Promise<VaultView> {
  if (!isVaultRun(runSnapshot)) return simulatedVaultView();
  const run = runSnapshot;
  if (process.env.XRPL_VAULT_LIVE === "0") return vaultViewFromRun(run);

  const deadline = Date.now() + LIVE_TIMEOUT_MS;
  let client: Client | undefined;
  let deadlineReached = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    client = new Client(process.env.XRPL_LENDING_WSS ?? XRPL_DEVNET_WSS);
    const liveRead = (async () => {
      await client!.connect();
      if (deadlineReached) {
        if (client!.isConnected()) await client!.disconnect();
        throw new Error("xrpl_live_timeout");
      }
      return readLive(client!, run);
    })();
    const live = await Promise.race([
      liveRead,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("xrpl_live_timeout")), LIVE_TIMEOUT_MS);
      }),
    ]);
    return vaultViewFromRun(run, live);
  } catch {
    return vaultViewFromRun(run);
  } finally {
    deadlineReached = true;
    if (timeout) clearTimeout(timeout);
    if (client?.isConnected()) {
      const remaining = Math.max(0, deadline - Date.now());
      await Promise.race([
        client.disconnect().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, remaining)),
      ]);
    }
  }
}
