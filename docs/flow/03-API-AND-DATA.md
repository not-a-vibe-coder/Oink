# Flow API and persistence

All account endpoints use the existing session. Errors use `{error, message, details:null}`. Fail closed if the database or chain is unavailable.

| Endpoint under /api/v1/flow | Purpose                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- |
| GET /settings               | Default or saved target, weights, and revision                                     |
| PUT /settings               | Validated replacement, with expected revision to prevent lost updates              |
| POST /preview               | Preview an amount against fresh balances and outstanding reservations              |
| POST /invoices              | Create a USDC invoice with a unique Solana reference                               |
| GET /invoices/:id           | Public payment instructions, no account secrets                                    |
| POST /invoices/:id/confirm  | Verify a finalized referenced USDC transfer; mark received without relying on Bell |
| POST /invoices/:id/allocate | Recipient-session request; allocate verified received income once                  |
| GET /payments               | Recipient payment and allocation history                                           |

Confirmation accepts a transaction signature, never an asserted amount or balance. Verify success, mint, decimals, destination, reference, and exact net amount. A transaction may fund only one invoice. Permit confirming a late real receipt: expiration prevents new payments being requested, but must not erase funds actually received.

Allocation is separate from receipt. In one SQL transaction, lock settings, verify fresh backing, lock invoice, compute allocation, snapshot settings, and insert payment plus purchase intents. A unique invoice constraint makes repeated allocation idempotent. No investment signing or cancellation endpoint until Phase 4.

## Tables

- flow_settings: account primary key, cash target integer numeric, weights JSON, revision.
- flow_invoices: recipient account and wallet, amount, unique reference, expiry, payment signature, receipt slot/time.
- flow_payments: unique invoice, allocation amounts, settings snapshot, signature, creation time.
- flow_purchases: payment and asset, reserved amount, lifecycle state; unique asset per payment.

Constraints enforce non-negative amounts, positive purchase amounts, supported states, and payment conservation. Settings revisions are optimistic concurrency controls; reservation mutations serialize on the settings row. Global signature uniqueness prevents reuse across invoices.

Finalized balances include the received payment. Before-payment eligible cash = current balance − active reservations − payment amount, floored at zero. Insufficient backing for payment plus existing reservations rejects allocation, while leaving its received status intact. Account funds outside Flow remain spendable: reservations are not escrow.

## Bell extensions (Phases 3 and 4)

All endpoints below require the recipient session and account ownership.

| Endpoint under /api/v1/flow  | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| GET /purchases               | Orders with immutable quote and current safe attempt summary                |
| POST /purchases/:id/quote    | Check explicit execution policy against a fresh Jupiter build               |
| POST /purchases/:id/prepare  | Simulate and persist the exact unsigned plan for the supplied quote ID      |
| POST /attempts/:id/submit    | Verify a locally signed transaction; persist signature before one broadcast |
| POST /attempts/:id/reconcile | Check finalized execution or authoritative expiry evidence                  |
| POST /purchases/:id/retry    | Explicitly reset an unsubmitted or proven failed order for fresh review     |
| POST /purchases/:id/cancel   | Release an unspent reservation without moving tokens                        |
| GET /receipts                | Safe attempt history including finalized actual amounts and fees            |

Migrations 009 and 010 add immutable quotes and durable execution attempts. No secret signing keys or signed transaction payloads are persisted; request logs redact signedTransaction. Original payment allocation snapshots remain immutable. Submitted orders keep reservations and block further allocation/preparation until reconciliation. A successful fill releases its USDC reservation; a failed order retains it until explicit retry or cancellation.
