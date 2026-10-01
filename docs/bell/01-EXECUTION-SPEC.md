# Bell quote and execution specification

Phases 3 and 4 extend Flow with one user-approved purchase at a time. Each phase uses ten commits, continuing the earlier build structure. Existing key custody and signing requirements remain authoritative.

## Quote policy

Use Jupiter Swap v2 `/build` with explicit fixed slippage and ExactIn USDC purchases. Allowlist SPYx, AAPLx, NVDAx from the existing canonical registry. Bell uses mainnet assets only; a devnet request returns an unavailable decision. Read-only live $10 requests for all three assets returned routes on October 1, 2026; that validates quotes at that size, not fills or all order sizes.

Policy: maximum slippage 1–500 basis points (default 50), optional maximum execution price in integer micro-USDC per token, optional maximum reported price impact in basis points, and optional premium cap. Premium checks are unavailable without licensed reference data and accurate instrument conversion factors; requiring a premium cap defers execution. Market-session status stays unknown without reference evidence. No invented price feed.

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
