# XRPL

The Testnet payout rail and the Devnet Bounty Credit Vault. Developer feedback is in the [README](../README.md#xrpl-developer-feedback).

## XRPL: escrowed pots, RLUSD payouts, on-ledger reputation (Testnet)

Observers who pick **RLUSD (XRP Ledger)** on `/me` are paid on the XRP Ledger Testnet. The XRPL rail combines five ledger features into one flow: the agent's prize is committed up front, the winner is paid in a dollar stablecoin, the platform fee is taken in the same atomic step, and the observer's track record lives on the ledger, not in our database.

### Primitive map

| Step in the A-eye flow | XRPL primitive | What it does |
| :-- | :-- | :-- |
| Agent posts a paid question | **Escrow** (`EscrowCreate`, XRP) | Locks the gross prize (quoted from the XRP/RLUSD AMM plus a 10% buffer) with `FinishAfter`/`CancelAfter`, so the pot is publicly committed before anyone answers. |
| Raffle picks an XRPL-rail winner | **Batch** (XLS-56, `tfAllOrNothing`) | A single transaction runs `EscrowFinish`, the winner payout, and the platform-fee `Payment`. Either all three succeed or none does. |
| Winner payout | **RLUSD** + **AMM** cross-currency `Payment` | `Amount` = RLUSD IOU (net prize), `SendMax` = released XRP minus the fee. The ledger converts XRP to RLUSD through the XRP/RLUSD AMM in the same payment. Winners with no RLUSD trust line receive XRP instead. |
| Question expires unanswered | **Escrow** (`EscrowCancel`) | Refunds the pot to the treasury. |
| Observer onboarding on `/me` | **Batch** (`TrustSet` + `MPTokenAuthorize`) | Signed in the browser with a local test wallet. One atomic transaction adds the RLUSD trust line and opts in to the reputation token. |
| Each accepted answer | **Multi-Purpose Token** `AEYE` ("A-eye Verified Answers") | Asset scale 0, non-transferable, XLS-89 metadata. The issuer mints 1 AEYE per accepted answer, grouped into `tfIndependent` Batches, so the observer's reputation is portable and verifiable on-ledger. |
| After N accepted answers | **Credentials** (`CredentialCreate` / `CredentialAccept`) | Issuer grants the "A-eye Verified Observer" credential, and the observer accepts it from `/me`. |

**Why XRP escrow + AMM instead of RLUSD TokenEscrow:** `TokenEscrow` is enabled on Testnet, but the RLUSD Testnet issuer (`rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`) does not set `asfAllowTrustLineLocking`, so RLUSD cannot be escrowed. We keep the commitment in XRP and deliver RLUSD at settlement through the AMM, all inside the same Batch, so the winner still receives dollars atomically.

**Fallback:** if Batch fails (a `tem*`/`temDISABLED` result, a submit error, or any inner result other than `tesSUCCESS`), settlement falls back to sequential `EscrowFinish` → payout (RLUSD via the AMM, or XRP) → fee `Payment`. Each step is persisted, so retries are idempotent. Results show `settle_mode` (`batch` or `sequential`) and an explorer link for each transaction.

Amendments checked live on Testnet (`feature` RPC): `BatchV1_1`, `fixBatchV1_2`, `TokenEscrow`, `fixTokenEscrowV1`, `MPTokensV1`, `Credentials` are all enabled.

### Run the Testnet demo

```sh
npm run xrpl:setup -- --role treasury   # faucet wallet + RLUSD trust line + RLUSD liquidity; writes .env.xrpl.local (gitignored)
npm run xrpl:setup -- --role issuer     # credential + reputation-token issuer
npm run xrpl:setup -- --role observer   # a test observer wallet
npm run xrpl:demo                       # onboarding Batch → escrow → settlement Batch → AEYE mint → credential
```

The demo prints every transaction hash, including each inner Batch transaction, with a `testnet.xrpl.org` link. It never prints seeds. To enable the rail in the app, set `XRPL_TREASURY_SEED` and `XRPL_ISSUER_SEED`. Optional variables: `XRPL_FEE_ADDRESS` (defaults to the issuer), `XRPL_REP_MPT_ID` (reuse an existing AEYE issuance), and `XRPL_XRP_PER_USD` (fixed rate instead of the AMM quote).

### Explorer proof (Testnet)

Live run of `npm run xrpl:demo` on 2026-10-11. Every transaction below is validated `tesSUCCESS`. The settlement Batch and its three inner transactions are all in ledger 21463486.

| Step | Transaction |
| :-- | :-- |
| AEYE reputation MPT issuance | [`014781A9…9AFA`](https://testnet.xrpl.org/mpt/014781A9938471C652D0E54540BF792FC0E72163C0389AFA) |
| Observer onboarding Batch (`TrustSet` + `MPTokenAuthorize`) | [`1EE0680F…746D`](https://testnet.xrpl.org/transactions/1EE0680FFFF4BFB3C6DF74D54DEAC711945BE390319A324B0C9966A9E501746D) |
| Pot escrow, 3.904394 XRP gross (`EscrowCreate`) | [`B43663E8…6A79`](https://testnet.xrpl.org/transactions/B43663E81BA899A46F18736787E551550A13B58F8DD75A4DC12DE445C3B26A79) |
| **Settlement Batch** (`tfAllOrNothing`) | [`3FF5ECC8…C228`](https://testnet.xrpl.org/transactions/3FF5ECC8955A2A1344A8BC4F4BDE93C7B5EE7DE1C00EED40D685AD2BB346C228) |
| ↳ inner `EscrowFinish` | [`0EE93565…D8AE`](https://testnet.xrpl.org/transactions/0EE93565DB15AE79A83500BDDD0EF246887A711C49FDCD648025865DB4A9D8AE) |
| ↳ inner payout: 0.9 RLUSD delivered via the AMM (`SendMax` 3.513955 XRP) | [`B36DD939…91C8F`](https://testnet.xrpl.org/transactions/B36DD9391BE3EEE8AADB20BBDA375DF4BE1FC86DB65C761A81A4836695691C8F) |
| ↳ inner platform fee, 0.390439 XRP | [`3BBBCDB7…EE53`](https://testnet.xrpl.org/transactions/3BBBCDB7A7AF6BC569C6E6FB26FF4607A7A810E9DA9AA28DE30CC36BC16CEE53) |
| 3 AEYE reputation points minted | [`416EAF8D…07A6`](https://testnet.xrpl.org/transactions/416EAF8D578DC93B92AC4CAE9B1578D7D43C0769E17D5D5F179EB27E7F5F07A6) |
| Verified Observer `CredentialCreate` / `CredentialAccept` | [`651724D8…12D0`](https://testnet.xrpl.org/transactions/651724D83351EC2F097649BFAE0655C1865BC0DFA5DC9B14A11C7265D10F12D0) / [`AC4CEAF2…CDAE`](https://testnet.xrpl.org/transactions/AC4CEAF27D0ECFE0938BB04E6EAF6F1EC108445B47C9806E846717321B68CDAE) |

At the end of the run the observer holds 0.9 RLUSD and 3 AEYE.

## Bounty Credit Vault (XRPL Lending, Devnet)

The `/vault` page demonstrates an XRP credit pool that funds an AI agent's human-observer bounty. The agent borrows from an A-eye loan broker, escrows a bounty pot for the observer, repays the loan with interest, and the depositor redeems vault shares with yield at maturity.

| Role | Vault flow |
| --- | --- |
| A-eye broker | Creates the closed-ended vault, sets loan-broker terms, and provides cover. |
| Depositor | Deposits XRP during subscription and withdraws their shares at maturity. |
| Sponsor | Deposits alongside the depositor and stays invested after redemption. |
| AI agent / borrower | Co-signs the loan, funds the bounty escrow, and repays principal plus interest and fees. |
| Human observer | Receives the escrowed XRP bounty when the escrow is finishable. |

Run the end-to-end Devnet flow with:

```bash
npm run xrpl:vault
```

The script funds fresh broker, depositor, sponsor, borrower, and observer wallets, then saves their seeds to the ignored `.env.xrpl.local` file with mode `0600`. Keep that local file private; it is not part of the snapshot or commit. The script creates the vault, configures the broker and cover, deposits 20 XRP each from the depositor and sponsor during subscription, waits for the investment phase, opens a counterparty-signed loan, escrows and releases the observer bounty, repays and deletes the loan, and withdraws only the depositor's shares after redemption. The sponsor remains invested so the live vault continues to show the remaining assets and share price. It records the run at `apps/web/data/xrpl-vault-run.json` and prints a Devnet explorer link for every submitted transaction. Set `XRPL_LENDING_WSS` to override the Devnet WebSocket endpoint.

1. Create a closed-ended XRP vault and configure A-eye's loan broker and cover.
2. The depositor and sponsor each deposit 20 XRP during subscription; wait for the investment phase.
3. Counter-sign a 20 XRP loan, escrow 5 XRP for the observer, then release that bounty.
4. Repay the loan and close it; after redemption, withdraw only the depositor's shares while the sponsor stays in.

The flow requires `SingleAssetVault`, `LendingProtocol`, and `LendingProtocolV1_1`; the recipe is Devnet-only because these amendments are not enabled on XRPL Testnet. The vault must be closed-ended: an open vault does not permit the required loan-broker configuration. If the node is unreachable or any required amendment is disabled, the script prints the planned steps as a dry run and exits successfully without creating wallets or writing a snapshot.

The `/vault` page resolves data in this order: live validated-ledger data (four-second timeout), the committed run snapshot if live reads fail, then a simulated plan when the snapshot is invalid or absent. Set `XRPL_VAULT_LIVE=0` to force the recorded snapshot.

Latest committed Devnet run: the depositor withdrew **20,000,035 drops** from a **20,000,000-drop** deposit, for **35 drops of yield**. The sponsor remains invested with **20,000,035 drops** across **20,000,000 shares**, at a live share price of `1.00000175` drops per share.

| Step | Devnet transaction |
| --- | --- |
| Vault create | [EF636129](https://devnet.xrpl.org/transactions/EF63612970AD08408D70376D2D02A9278F3948F29198C6315456A9BECCD0F191) |
| Loan broker set | [B91F264C](https://devnet.xrpl.org/transactions/B91F264C35D132752B5F6AEA91CD7BC8910BFC421CFE4CAA1572B86334815ECB) |
| Cover deposit | [7D0A3D96](https://devnet.xrpl.org/transactions/7D0A3D965330EE974153EA974A37BD44132DEE0A059FEDC4BC73117CCC9F0007) |
| Depositor deposit | [F949E8EB](https://devnet.xrpl.org/transactions/F949E8EB000B33D2CC25869A3B14A7D3F95E9D47F93160D9A547E59C097C6256) |
| Sponsor deposit | [2D8CEED3](https://devnet.xrpl.org/transactions/2D8CEED32A785162446220BC0346B76D6FF57FFABE821E17E323CFDDA9A94574) |
| Counterparty-signed loan set | [82F77415](https://devnet.xrpl.org/transactions/82F77415FBA8FDE5CE2925F642A0797789B8343827164065870D7438C1223FE7) |
| Bounty escrow | [A1AD2944](https://devnet.xrpl.org/transactions/A1AD294476DC0B112776CE9E06AD6CB9CF16BC781F60F72D17DFBF8568B5E22B) |
| Bounty paid to observer | [7AED6F22](https://devnet.xrpl.org/transactions/7AED6F22AF805CF01A897569E31E2BD5139593DF2C675172E5410B8A5CA9C3DF) |
| Loan repayment | [064BDF7E](https://devnet.xrpl.org/transactions/064BDF7EE35AA5B78A5C99621EF4B31E3C36FADED219BBC9EDC7A05ED330299F) |
| Loan delete | [021E1E6C](https://devnet.xrpl.org/transactions/021E1E6C8858E42B23B7409F004636174CEB967DB1603F7B75AD9FA34FB2E382) |
| Vault withdraw | [6A29B073](https://devnet.xrpl.org/transactions/6A29B0735D21EF8E01EE33761929285EA5608150B5B671F86C1653E6B85B220E) |
