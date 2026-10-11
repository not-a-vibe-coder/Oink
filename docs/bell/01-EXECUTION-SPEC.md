# Bell quote and execution specification

Phases 3 and 4 extend Flow with one user-approved purchase at a time. Each phase uses ten commits, continuing the earlier build structure. Existing key custody and signing requirements remain authoritative.

## Quote policy

Use Jupiter Swap v2 `/build` with explicit fixed slippage and ExactIn USDC purchases. Allowlist SPYx, AAPLx, NVDAx from the existing canonical registry. Bell uses mainnet assets only; a devnet request returns an unavailable decision. Read-only live $10 requests for all three assets returned routes on October 1, 2026; that validates quotes at that size, not fills or all order sizes.

Policy: maximum slippage 1–500 basis points (default 50), optional maximum execution price in integer micro-USDC per token, optional maximum reported price impact in basis points, and optional premium cap. Premium cap (October 11, 2026 update): the reference is Pyth's regular-session US equity feed (`Equity.US.SPY/USD`, `AAPL`, `NVDA`; pinned IDs, symbol re-checked against Hermes metadata). Hermes has required an API key for prices since its August 2026 upgrade, so the cap needs `PYTH_API_KEY`; feed metadata (the holiday-aware trading schedule) is public and drives a regular / extended / closed session badge on every quote. The token-to-share factor is each xStock mint's Token-2022 scaled-UI-amount multiplier read on-chain at quote time; the stored f64 is converted to its exact rational, and the new multiplier applies once its effective timestamp passes (live values on October 11 were about 1.0009–1.0057, not 1). The worst-case per-share price is input ÷ (minimum output × multiplier), compared with BigInt cross-multiplication against the reference's lower confidence bound. The cap applies only when the session is regular, the price was published within 60 seconds of the quote, the confidence interval is within 2%, and the multiplier is valid; otherwise the decision is `REFERENCE_UNAVAILABLE` and the order is deferred. Extended-hours status is approximated as 04:00–20:00 ET on a trading day; extended-hours prices are not used. No invented price feed.

Worst-case token price uses input amount divided by minimum output, including token decimal scaling. Compare rational quantities using BigInt. Preserve the quote, policy, decision, expiry, route, and instrument metadata. Quotes expire after 30 seconds; check again after fetching and before signing/submission. An expired quote requires a new brief and explicit review.

## Execution and custody

Prepare the server transaction only from a stored passing quote belonging to this account and purchase. The user remains the sole signer and fee payer: no new server key, sponsorship, or delegated trading. Preview known network fee and simulated wallet SOL debit; reject unsupported instructions, signers, and an unexpected USDC spend or token destination. Verify the Jupiter route instruction encodes the approved input, expected output, and slippage. Simulate before returning a transaction.

Persist the unsigned transaction, its message hash, original blockhash validity, simulation results, and quote snapshot. The browser reviews this exact plan and signs locally. Revalidate the complete message and Ed25519 signature before broadcast. Recheck backing, account ownership, policy, quote expiry, and blockhash validity at submit.

Persist the deterministic transaction signature and submitted state BEFORE network broadcast. A duplicate submit returns/reconciles the same attempt; it never signs or creates another trade. After a crash or RPC error, submitted remains reserved. Reconcile the original signature. A finalized success records actual input/output, network fee, SOL balance change, and whether execution matched the approved limits. A finalized failure or an expired blockhash with an authoritative finalized absence check permits a manual retry. A missing or incomplete RPC answer does not prove failure.

Serialize all reservation and attempt changes on the account settings row. While any purchase is submitted, block new allocation or execution until reconciliation; finalized balances must not release or double-count funds from an unresolved trade. Retry builds a fresh quote and requires a fresh signature. Cancellation is allowed only before submission or after a proven failed/expired attempt. Cancel releases the unspent accounting reservation; it does not move funds.

## Receipts and UI

Income history retains immutable original allocations while individual purchases show pending, deferred, approved, submitted, confirmed, failed, or cancelled. Display completed, reserved, and released USDC separately. Link approved quote, attempt, actual fill, and payment signatures. Refresh/reconcile submitted attempts explicitly; never auto-sign or blindly resend. Each purchase can complete independently of other purchases and of payment receipt.

## Limits

Network fee and account rent use SOL supplied by the user. Quote fees do not include an invented platform fee. Reserves are accounting records, not escrow; spending through other wallet clients can still reduce backing. Mainnet broadcasting is implemented but is not exercised with real user funds during development. Customer interviews and provider eligibility review remain external launch gates.

## Route encoding evidence

The current live build uses Jupiter `route_v2` with the input amount, quoted output, slippage, and zero fee fields in its instruction header. Guard its discriminator, exact amounts, token programs, wallet authority, and destination accounts. The [generated route_v2 decoder](https://docs.rs/jupiter-solana-client/latest/src/jupiter_solana_client/generated/instructions/route_v2.rs.html) matches the live build header. Reject unsupported route formats. Minimum output is conservatively rounded down from quoted output and encoded slippage; provider rounded display thresholds are not treated as a stronger on-chain guarantee.
