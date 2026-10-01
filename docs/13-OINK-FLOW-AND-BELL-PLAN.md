# Oink Flow + Bell — Product and Hackathon Plan

Status: proposed product direction, pending customer validation and technical specification.
Created: October 1, 2026.

This document records the brainstorming decision to combine Oink Flow and Bell into one product. It preserves Oink's existing security requirements. The user subsequently authorized implementation of Phases 1 and 2 in ten commits each; later phases remain outside that build scope.

## 1. Product thesis

**Turn income into your chosen portfolio, with cash reserves and execution limits built in.**

Oink Flow is the customer-facing product: users receive payments, maintain a cash reserve, and allocate surplus income to investments they choose.

Bell is the execution engine: it checks whether proposed investment purchases meet the user's price, slippage, and quote-quality limits before they execute.

Build one product with one primary workflow. A standalone Bell trading terminal is a potential later product, not part of the initial submission. The final name remains open.

## 2. First customer and problem

Start with freelancers and contractors who already receive USDC on Solana and manually divide income between near-term spending and investments.

The hypothesis is that these users want to:

- Keep a chosen amount available in cash.
- Invest surplus income according to their own allocation.
- Avoid buying tokenized assets at prices outside their limits.
- Understand what happened to each payment without reconciling multiple tools.

These needs have not yet been validated. Do not assume that walletless onboarding, invoicing, stock access, or recurring buys alone provide differentiation.

## 3. Roles of the two components

| Component | Responsibility | User question |
| --- | --- | --- |
| Oink Flow | Payment intake, cash target, allocation calculation, pending purchases, and receipts | Where should this income go? |
| Bell | Executable quotes, execution checks, transaction preparation, and result comparison | Does this purchase meet my rules now? |

The wallet is supporting infrastructure. The product's main value is the income-to-portfolio workflow.

## 4. Example user journey

Illustrative amounts, not an investment recommendation:

1. A freelancer sets a cash target of 1,000 USDC and chooses an allocation for surplus income.
2. Their eligible cash balance is 800 USDC when a 500 USDC payment arrives.
3. Oink Flow reserves 200 USDC to fill the cash shortfall.
4. The remaining 300 USDC becomes the proposed investment budget, before applicable costs.
5. Bell requests executable quotes for the selected assets and evaluates them against the user's limits.
6. Purchases that meet the limits can execute with the required user authorization.
7. Amounts assigned to rejected or unavailable purchases remain in USDC and appear as pending investments.
8. A receipt shows the payment, cash allocation, completed purchases, fees, and pending amounts with reasons.

**Receiving a payment must succeed independently of whether investment execution is available.** A deferred purchase must not be presented as a failed payment.

## 5. Cash and allocation rules

For the MVP, the cash target means a user-defined nominal USDC balance. It does not automatically estimate expenses or guarantee purchasing power.

At allocation time:

- Cash shortfall = max(0, target cash balance − eligible available cash).
- Cash allocation = min(net available payment, cash shortfall).
- Investment budget = net available payment − cash allocation.
- Divide the investment budget using user-selected weights that total 100%.

Define eligible cash precisely in the implementation specification. Cash already reserved for pending investments must not be counted twice or spent by competing allocations. Recheck balances before execution and serialize or otherwise protect concurrent allocation operations.

Use integer token units and explicit rounding rules. Disclose applicable fees before authorization. Small residual amounts remain in USDC.

Pending investment amounts remain visible, cancellable, and available under a clearly defined policy. For the MVP, retries require user approval; no background authority to spend user funds is assumed.

## 6. Bell execution policy

Bell should evaluate a specific order, rather than merely display market information.

For each proposed purchase, show:

- Verified token mint, issuer, and instrument identity.
- Input amount and quoted output.
- Expected execution price and known costs.
- Quote expiry and relevant liquidity or price-impact information when available.
- Reference equity price, source, timestamp, and market-session status when available.
- The user's limits and a pass, defer, or unavailable result with a reason.

Execution gates should include an allowlisted asset, a current executable quote, transaction simulation, configured slippage limits, and any supported premium limit.

A closed underlying market makes its latest price historical. A difference from Friday's close is not proof of mispricing or an executable arbitrage. If a required reference price is missing or stale, Bell must not claim it verified a current premium. The specification must define whether that policy defers the purchase or allows execution under other explicitly accepted limits.

Requote and recheck when necessary before signing. Quote comparison alone cannot guarantee the final fill; use enforceable transaction limits where supported and compare the confirmed result with the approved quote.

## 7. Hackathon MVP

Include:

- One customer workflow: receive USDC income and allocate it.
- A payment link and an existing supported wallet flow.
- A user-defined cash target.
- A small allowlisted asset universe, initially up to three tokenized stock or ETF assets.
- User-defined surplus allocation weights.
- One routing integration, initially Jupiter if technical feasibility is confirmed.
- Bell quote checks and clear execution decisions.
- User-approved investment execution.
- Pending investments with manual retry and cancellation.
- Receipts tying each payment to its allocation and confirmed transactions.

Exclude from the initial submission:

- A complete standalone trading terminal.
- Autonomous strategies, delegated trading, and background retries.
- Leverage, lending, copy trading, or AI investment advice.
- Stock issuance and issuer onboarding.
- Fiat payment rails or bank withdrawals.
- Multi-chain support and a broad payroll administration platform.
- New wallet-authentication infrastructure beyond what the workflow needs.

## 8. Existing Oink assets and necessary changes

Potential reuse includes the design system, invoice and payment-link surfaces, allocation components, asset metadata, Jupiter integration, transaction-building utilities, and wallet infrastructure.

This is a reuse inventory, not a claim that those modules have been tested or are production-ready.

The main behaviour change is from fixed inbound mix settlement to **cash-first allocation with independently deferrable purchases**. Oink's current atomic settlement approach must be reviewed before adapting it. Do not claim the complete multi-step workflow is atomic if payment receipt and investment execution occur in separate transactions.

Preserve existing requirements for browser-held private keys, non-custodial signing, integer amounts, transaction validation, and fee-payer limits. Any new authority model requires a separate specification and review under `AGENTS.md`.

Reuse Oink's visual language after the product flow is settled: white surfaces, fine ledger rules, dominant financial figures, restrained colour, and generous spacing. Screen designs are not decided by this document.

## 9. Technical feasibility checks before committing scope

Confirm:

- Which allowlisted assets have usable live routes at the intended order sizes.
- Access, cost, licensing, and freshness of underlying equity reference data.
- Which execution limits the selected transaction route can enforce.
- How the existing invoice flow records successful payment independently of purchases.
- How pending allocations are reserved, retried, cancelled, and reconciled without duplicate spending.
- Applicable asset-provider eligibility and distribution requirements for the intended users.
- Mainnet availability of the required assets; clearly label simulated or devnet portions if used.

If dependable reference data is unavailable, narrow Bell's claim to quote, slippage, and execution checks. Do not fabricate a verified premium feature.

## 10. Customer validation

Before expanding implementation, interview five freelancers or contractors already receiving USDC and, if accessible, five active tokenized-stock traders.

For income recipients, ask them to walk through their last payment: what stayed in cash, what was invested, which tools they used, and what they would trust the product to execute.

For traders, ask about their last tokenized-stock trade, execution checks, unexpected costs, and whether the proposed order brief changes a real decision.

Strong evidence includes a user configuring a real allocation, using a payment link, completing an authorized purchase, or returning for another payment. Compliments alone are weak evidence.

Proceed with the combined direction if income recipients want the allocation workflow and Bell contributes a useful execution decision. If customers only want basic stock buying, reconsider the differentiation. If traders want Bell independently, record that demand for a later terminal rather than widening the MVP immediately.

## 11. Five build phases

Working deadline: October 12, 2026. Verify the official submission cutoff and timezone before scheduling delivery.

Complete each phase's exit criteria before starting dependent work in the next phase. Customer validation continues throughout the build. Dates are provisional targets, not evidence that a phase is complete.

### Phase 1 — Product specification and foundation

Target: October 1–2.

Goal: establish a feasible scope and the foundation for the combined workflow.

- Validate the income-allocation problem with prospective users.
- Audit existing Oink payment, wallet, mix, and transaction modules for reuse.
- Confirm asset routes, reference-data access, and enforceable execution limits.
- Specify cash accounting, reservation rules, fees, rounding, and purchase states.
- Specify the database and API changes, including idempotency and reconciliation.
- Agree on the core screens and reuse Oink's design tokens and components after the design discussion.
- Establish the development environment and confirm the existing baseline checks.

Exit criteria: the MVP specification identifies supported assets, integrations, custody boundaries, cash semantics, and failure behaviour; baseline verification results are recorded; any unavailable reference-data feature is explicitly removed or narrowed.

### Phase 2 — Payment intake and cash-first allocation

Target: October 3–5.

Goal: turn a confirmed USDC payment into a reliable cash allocation and proposed purchases.

- Adapt payment links and invoices to record receipt independently of investing.
- Build settings for the cash target and surplus allocation weights.
- Implement integer allocation calculations and explicit rounding.
- Persist payment records, purchase intents, and USDC reservations.
- Protect concurrent payments and duplicate payment notifications.
- Build the allocation preview and payment status interface.

Exit criteria: a confirmed payment is recorded once, correctly fills the cash shortfall, and creates funded purchase intents for the remainder; duplicate and concurrent processing cannot reserve the same funds twice; payment receipt still works when trading is unavailable.

### Phase 3 — Bell quotes and execution decisions

Target: October 6–7.

Goal: decide whether each proposed purchase satisfies the user's execution policy.

- Request executable quotes for allowlisted assets through the selected route.
- Show expected output, known costs, quote expiry, and supported price-impact data.
- Integrate reference prices and market-session status only if dependable data is available.
- Implement configured slippage, quote-freshness, and supported premium checks.
- Produce pass, defer, or unavailable decisions with stable reason codes.
- Build the order brief and pre-signing approval interface.

Exit criteria: acceptable, expired, unavailable, and out-of-policy quotes produce the correct decisions; stale reference prices are labelled accurately; deferred orders cannot proceed through the approval flow without a fresh policy check.

### Phase 4 — Authorized execution and lifecycle

Target: October 8–9.

Goal: execute approved purchases and make every outcome recoverable and understandable.

- Build and simulate transactions, refresh quotes when needed, and recheck policy before signing.
- Obtain user signatures and enforce supported transaction limits.
- Broadcast, track confirmation, and reconcile actual input, output, and fees.
- Handle uncertain submission outcomes by checking chain state before retrying.
- Support partial completion across separate purchases without duplicating successful trades.
- Build pending-investment inspection, manual retry, cancellation, and reservation release.
- Produce receipts linking payments, cash allocations, purchase outcomes, and chain transactions.

Exit criteria: an approved purchase completes and reconciles; failures or deferrals leave the remaining USDC accounted for; retries cannot duplicate confirmed trades; cancellation releases only unspent reservations; receipts distinguish successful payment receipt from purchase outcomes.

### Phase 5 — Verification, pilot, and submission

Target: October 10–12.

Goal: deliver a complete, reviewable product with evidence supporting its claims.

- Verify the full payment-to-portfolio workflow and the acceptance criteria in section 12.
- Check concurrency, small amounts, expired quotes, unavailable routes, interrupted signing, and ambiguous broadcast outcomes.
- Review custody, fee sponsorship, and transaction validation against existing Oink requirements.
- Run a small pilot with real users where feasible and record actual usage and feedback.
- Polish the agreed screens using Oink's existing visual language.
- Record a demo showing cash allocation, an executed purchase, and a deferred purchase.
- Prepare the pitch, repository access, reuse disclosure, validation evidence, and submission materials.
- Reserve time for fixes and verify the official submission requirements before delivery.

Exit criteria: required checks pass with results recorded; the demonstrated workflow matches actual product behaviour; simulated portions and remaining limitations are disclosed; submission materials are complete and ready for delivery.

This schedule is provisional. Reduce asset coverage and secondary features before weakening custody, payment reliability, or transaction correctness.

## 12. Acceptance criteria

- A payment is recorded once, even when purchase execution is unavailable.
- Cash-first allocation produces correct integer amounts, including small-payment and rounding cases.
- Concurrent payments and retries cannot allocate or spend the same funds twice.
- A purchase outside configured execution limits is deferred with a clear reason.
- A quote that expires before signing is refreshed and rechecked.
- Confirmed purchases reconcile to chain results; retries do not duplicate completed purchases.
- Pending purchases can be inspected, cancelled, and retried with user approval.
- Receipts distinguish payment received, investment pending, investment completed, and execution failed.
- No user private key is sent to or held by the server in plaintext.

## 13. Submission story and competitive rationale

Suggested pitch:

> People paid in stablecoins still manage the path from income to investments manually. Oink keeps their chosen cash reserve funded, allocates surplus income, and checks each purchase against their execution limits.

The demo should show a real payment, a cash reserve filling, an acceptable purchase executing, and an unacceptable purchase remaining in USDC with a clear explanation.

The competitive case is a repeatable customer need combined with a functioning, measurable execution workflow. The product does not win simply by combining two names or offering a cleaner interface.

Measure pilot payments processed, allocation completion, deferred purchases and reasons, actual execution costs, repeat use, and customer willingness to continue using the product. Any claimed savings need a comparable executable baseline at the same time and order size.

Potential business models to test are paid allocation features, transparent execution fees, and integrations for contractor or payment platforms. Pricing and willingness to pay remain unvalidated.

Disclose reused Oink work in the hackathon submission and identify exactly what was developed during the competition. No prize outcome is guaranteed.

## 14. Research references

- [Crypto World's Fair event and deadline](https://colosseum.com/worldsfair)
- [Colosseum eligibility and judging guidance](https://colosseum.com/hackathon)
- [Colosseum submission guidance](https://blog.colosseum.com/perfecting-your-hackathon-submission/)
- [Jupiter Send documentation](https://jupiter.mintlify.app/docs/send)
- [Existing Jupiter stocks functionality](https://academy.jup.ag/lessons/xstocks-on-jupiter)
- [Noah and Jupiter payroll case study](https://solana.com/de/news/case-study-noah)
- [Streamflow payouts](https://docs.streamflow.finance/en/articles/12639121-payouts)

Research was reviewed during the October 1, 2026 brainstorming session. Recheck integration details and event rules before implementation and submission.
