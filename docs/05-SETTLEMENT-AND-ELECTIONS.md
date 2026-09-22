# OINK — Settlement Engine, Elections & Fees

This is the part of TENDER worth keeping intact. The code in
`C:\Users\USER\tender\backend\src\services\` already works; the job is to port it, delete the
EVM twin, and adapt handles to tags.

---

## 1. The election contract

An election is a set of rows for one tag:

```
[{ symbol: "SPYx", mint: "Xso...", basisPoints: 6000 },
 { symbol: "USDC", mint: "EPjF...", basisPoints: 4000 }]
```

Invariants, enforced in both the API and the DB:

1. Active rows for a tag sum to **exactly 10000** basis points
2. Between 1 and 10 rows
3. No duplicate mints
4. Every mint resolves in the token registry
5. The default election for a brand-new wallet is **100% USDC**

An update deactivates the previous set and inserts the new one in one transaction, then
writes an `election_revisions` snapshot. Ported from TENDER's
`backend/src/routes/handles.ts` `PUT /:handle/elections`.

---

## 2. Token registry

Port `backend/src/lib/rwaTokens.ts` to `backend/src/lib/tokens.ts` **unchanged in data**:

- `SOL` and `USDC` as base currencies
- `FEATURED_SOLANA_STOCKS` — the curated set the pickers open on
- The full xStocks registry (several hundred symbols, `GOOGLx` through the long tail)
- `resolveSolanaToken(mintOrSymbol)` and `findSolanaToken(query)` helpers

Rename the exported types from `SolanaTokenInfo` to `OinkToken` if you like, but **do not
retype the data by hand** — copy the file. It is the single most expensive artefact in the
source project to reproduce.

Frontend mirror: `src/types/token.ts` keeps the same shape. The old `src/types/rail.ts` and
`src/lib/rail-normalize.ts` are deleted — there is only one rail now, so no normalisation
layer is needed. Read the v1 shapes directly.

---

## 3. Quote engine

Port `backend/src/services/dualQuoteEngine.ts` to `backend/src/services/electionEngine.ts`
and simplify:

- **Keep:** `parseTokenUnits`, `formatTokenUnits`, `calculatePortfolioElectionQuotes`, the
  per-leg slippage cap, and the USDC safe-settle fallback
- **Keep:** `jupiterService.ts` verbatim (quote + swap-instructions fetch)
- **Drop:** `relayService.ts` and the whole dual-provider comparison. Relay existed for
  cross-chain routing that Oink does not do. Jupiter alone is the v1 venue.
- **Drop:** every `v2/` file (Uniswap V4 on Robinhood Chain)

### Leg construction

```
totalIn (base units of the input mint)
  for each election row:
    legIn = totalIn * basisPoints / 10000          # integer math, no floats
  distribute the remainder from integer division to the largest leg
  for each leg:
    if legMint == inputMint  -> direct transfer leg, no swap
    else                     -> Jupiter quote(inputMint -> legMint, legIn, slippageBps)
    if priceImpactPct > cap  -> re-quote to USDC, mark safeSettled: true
```

**Never use floating-point arithmetic for amounts.** `BigInt` throughout, formatted for
display only at the edge. This rule is inherited from TENDER and matters more here because
Oink shows balances to consumers.

Default `slippageBps`: **100** (1%). Safe-settle cap on price impact: **3%**. Both
configurable per request, clamped server-side to `[10, 500]` and `[1, 10]`.

---

## 4. Transaction building

Port `backend/src/services/txBuilder.ts`. It already does the hard parts correctly:

- `resolveTokenProgramId` — detects Token-2022 mints (xStocks use it) and picks the right
  program. **Do not drop this.** Using `TOKEN_PROGRAM_ID` on a Token-2022 mint fails.
- `createAssociatedTokenAccountIdempotentInstruction` for the recipient's ATAs — the
  recipient may never have held `NVDAx` before
- Jupiter swap instruction deserialisation plus address lookup tables
- `compileToV0Message` into a `VersionedTransaction`

### Instruction budget

A multi-leg election can overflow one transaction. Rules:

- Try to fit all legs in one v0 transaction with lookup tables
- If the serialised size exceeds ~1232 bytes, split into a **plan**: an ordered array of
  transactions the client signs and submits in sequence, showing progress
- The API returns `transaction` (single) or `transactions[]` (plan); the client handles both
- Cap at 4 transactions; above that, reject the quote with a message asking the user to
  simplify the election

### Compute budget

Always prepend a `ComputeBudgetProgram.setComputeUnitLimit` and a priority fee
(`setComputeUnitPrice`). Jupiter returns suggested compute budget instructions — use them,
and add a floor so a congested network does not silently drop the transaction.

---

## 5. Payment paths

### 5.1 Oink to Oink, by tag

Sender and recipient are both known. Resolve `@tag` to a public key and an active election.
Build the multi-leg settlement, sender signs, submit. One `transfers` row with
`direction = 'send'`, both `sender_tag` and `recipient_tag` populated,
`election_applied = true`.

### 5.2 Oink to an external address

`applyElection` is forced false. A plain SPL or SOL transfer. If the sender is paying in an
asset they do not hold (say they hold `SPYx` and want to send USDC), a swap leg precedes the
transfer in the same transaction.

### 5.3 External wallet to an Oink tag

The Oink user shows a QR. Two flavours:

- **Plain address QR** — any wallet can send. Funds arrive as whatever the sender sent; no
  election is applied, because the sender never touched Oink. The app shows the arrival and
  offers a one-click "apply my election" swap afterwards.
- **Solana Pay QR from an invoice** — the invoice encodes amount, token and memo. Wallets
  that support Solana Pay transaction requests can be handed a server-built, election-applied
  transaction. Implement the plain address path first; the transaction-request path is a
  Phase 5 nicety.

### 5.4 Rebalance in place

"Apply my election to my current balance." Quote `holding -> election legs` for whatever the
user selects, one transaction, `direction = 'swap'`. This is the feature that makes the
election visible day to day and is worth building for the demo.

---

## 6. Fee sponsorship

A brand-new Oink wallet holds zero SOL and cannot pay a transaction fee or ATA rent. Without
sponsorship the onboarding story collapses at step one.

**Design**

- A dedicated `FEE_PAYER_SECRET_KEY` keypair, held server-side, funded with a small float
- It is set as the transaction's `feePayer` and **partially signs** at build time
- The user signs as the source authority; both signatures are required
- The sponsor keypair has **no authority over user token accounts** — it can only lose SOL

**Budget enforcement** (`backend/src/services/feePayer.ts`)

| Guard | Default |
| :--- | :--- |
| Per tag per day | 20 sponsored transactions |
| Per tag per day, lamports | 0.05 SOL |
| Global per day, lamports | configurable; refuse when exhausted |
| Eligibility | Only when the user's SOL balance is below the fee plus rent |

Every sponsorship writes a `fee_sponsorships` row before broadcast. When the budget is spent,
return `429 SPONSORSHIP_EXHAUSTED` and tell the user to fund a little SOL.

**Operational rules**

- Keep the float small (1 to 2 SOL). Treat the key as hot and rotatable.
- Monitor the balance; alert below a threshold.
- Never let the sponsor sign a transaction the server did not build itself.

---

## 7. Protocol fee

TENDER charged `TENDER_FEE_BPS` (15 bps) to `TENDER_FEE_WALLET`. Carry the mechanism over as
`OINK_FEE_BPS` / `OINK_FEE_WALLET`, but **default it to 0 for the hackathon** so demo numbers
are clean. Keep the code path and the config so it can be switched on.

When non-zero, the fee is taken from the input amount before the legs are computed, and shown
explicitly in the quote response as a `fee` object. Never take a fee silently.

---

## 8. Confirmation and receipts

- Submit with `sendRawTransaction({ skipPreflight: false, maxRetries: 3 })`
- Confirm with `confirmTransaction({ signature, blockhash, lastValidBlockHeight })`
- On timeout, poll `getSignatureStatus` for up to 60 seconds before declaring failure
- Write the `transfers` row only after confirmation; `ON CONFLICT (signature) DO NOTHING`
  keeps retries idempotent (ported from TENDER's `/settle/confirm`)
- A failed transaction writes `status = 'failed'` with the error so the activity feed can
  explain it

---

## 9. Price and balance reads

- Balances: `getParsedTokenAccountsByOwner` plus `getBalance` for SOL, filtered to registry
  mints, cached 10 seconds per wallet
- Prices: Jupiter price API, batched, cached 60 seconds
- Portfolio value: sum of holding value; show as of a timestamp, never as a live tick
- If the price API fails, show amounts without USD values rather than showing zeros
