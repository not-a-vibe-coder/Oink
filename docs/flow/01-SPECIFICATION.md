# Flow specification

Flow receives USDC independently of Bell purchases. Existing atomic mix payments remain separate; Flow links always use a plain USDC transfer with a unique invoice reference.

## Cash accounting

All USDC amounts are decimal strings of integer micro-USDC at API/storage boundaries and BigInt during calculations. A target is nominal USDC, not a promise about expenses or purchasing power. Allocation uses a fresh finalized onchain balance and subtracts reservations and the newly received payment to derive pre-payment eligible cash. Concurrent processing locks the account settings row. Existing wallet sends can reduce backing: reservations are accounting records, not onchain escrow. Recheck backing before creating new intents and before future execution.

No platform fee is charged in Phase 2. Payers fund their own network fees. Floor each weighted purchase to integer units; retain remainder in cash. Weights total 10,000 basis points across at most three assets.

## Lifecycle

A payment is received only after chain verification, regardless of market availability. Purchase intents begin pending. Bell decisions and signing arrive in Phases 3–4; Phase 2 cannot execute investments. Reserved USDC stays in the user's wallet. No server signer gains spend authority. Configuration changes affect future payments only; preserve a settings snapshot on each allocation.

## Defaults

Flow is opt-in. Cash target starts at zero with no investment weights; unconfigured income stays in cash. No underlying equity reference-data provider is configured: premium verification is unavailable until dependable licensed data is integrated. Existing crypto/auth requirements in AGENTS.md continue to apply.

## Screens

Add an Income page to the existing application shell: cash target and weights, a payment-link creator, allocation preview, and received-payment history. Reuse existing type, spacing, forms, and ledger styles. Final art direction remains open.
