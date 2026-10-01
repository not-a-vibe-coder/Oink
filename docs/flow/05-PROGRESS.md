# Build progress

## Phase 1 — technical foundation

Ten commits cover the combined plan, product specification, shared contracts, exact amounts, settings validation, purchase lifecycle, integration audit, API/data specification, customer validation checklist, and baseline repair.

Baseline after frozen-lockfile dependency installation: `bun test` — 71 passed, 47 skipped, zero failed. Database integration tests skip without a disposable test database. Backend `bun run check` passed. Fixed a pre-existing missing direct `tweetnacl` dependency used by the browser key-session module. Frontend typecheck/build are being checked separately.

Customer interviews remain pending. Live stock routes, licensed equity reference data, and provider eligibility remain Phase 3 gates. No completed interviews or investment execution are claimed. Phase 2 proceeds with the explicitly unvalidated USDC-only MVP and the specifications recorded here.

## Phase 2 — income intake and allocation

Ten commits implement exact allocation, forward-only migration 008, settings storage, finalized chain verification, referenced payment links, transactional allocation, API routes, typed frontend access, Income/public payment screens, and integration verification.

Implemented workflow: save an income plan at `/app/income`, create a USDC payment link, pay through the referenced Solana Pay request, submit the transaction signature for verification, and allocate received income from the recipient's Income page. Purchase amounts are reserved in accounting and remain USDC; no Bell trade is executed.

### Verification

- Main suite: 76 passed, 54 skipped, zero failures. Skips include optional database suites; Flow database tests were run separately.
- Disposable local PostgreSQL: migrations 001–008 applied successfully; five Flow HTTP/database integration tests passed. RPC fixtures exercise receipt verification without claiming a live transfer.
- Concurrent duplicate allocation returns the same payment, while distinct concurrent payments create separate, correctly funded reservations.
- Stale settings, unauthenticated requests, foreign-account allocation, incorrect credit, insufficient backing, signature reuse, and non-conserving records are rejected.
- Frontend and backend TypeScript checks passed.
- ESLint passed for the new frontend modules and routes.
- Production build passed; existing Vite/plugin and bundle-size notices remain informational.

### Setup

Run the existing backend migration command with the intended local database configured. Configure `FLOW_USDC_MINT` for devnet or another non-mainnet environment; it must be the intended six-decimal USDC mint. Mainnet-beta uses the canonical USDC mint. Match `SOLANA_NETWORK` and the RPC endpoint. Set `APP_URL` to the frontend origin so generated payment links resolve correctly.

For database regression checks, use a disposable migrated PostgreSQL database and set `DATABASE_URL` and `TEST_DATABASE_URL` to the same URL, then run `bun test backend/tests/flow.integration.test.ts`. The suite writes two test wallets and cleans them up; do not point it at a live user database.

### Remaining gates

Customer interviews, live wallet payment confirmation, browser interaction checks, and live stock execution have not been performed. Phase 3 must verify supported trading routes and usable order sizes. Licensed equity reference data is still unavailable. Flow reservations do not prevent spending from another wallet client. Any future execution must recheck backing and user authorization.

## Phase 3 — Bell quotes and execution decisions

Ten commits cover the execution specification, shared contracts, exact policy arithmetic, quote migration, Swap v2 adapter, instrument allowlist, quote persistence, protected API access, order briefs, and regression verification.

Verified: two policy tests and two PostgreSQL quote/API integration tests passed. Frontend/backend type checks and targeted frontend lint passed. Read-only live $10 mainnet builds returned routes for SPYx, AAPLx, and NVDAx; no signing or spending was performed. Deferred orders remain in USDC, and required premium checks return unavailable because no dependable equity reference feed is configured.

See `docs/bell/01-EXECUTION-SPEC.md` and `docs/bell/02-LIVE-ROUTES.md`. Phase 4 can now extend the verified quote workflow with durable attempts and local signing. Mainnet quote availability is not a guarantee of a successful trade.

## Phase 4 — authorized execution and lifecycle

Ten commits implement durable attempts, guarded transaction assembly, simulation/backing checks, local-signature validation, submission recorded before broadcast, finalized reconciliation, explicit retry/cancel, account-owned APIs, browser approval/signing, and regression verification.

The Income screen now offers quote review, simulated trade review, inline wallet unlock, explicit local signing, finalized receipt checks, reset/cancel, and retained execution history. It shows completed, reserved, and released investment amounts separately from the immutable original allocation. The user supplies SOL for network fees and account creation; execution is capped at an estimated 0.01 SOL debit. No new server signing key was introduced.

### Verification

- Main suite: 84 passed, 63 skipped, zero failures. Optional database integration suites skip without test configuration.
- Disposable PostgreSQL: Flow (5 tests), Bell quotes (2), and Bell execution lifecycle (3) passed in separate runs. Migrations through 010 applied successfully.
- Lifecycle checks cover simulation rejection, unsigned submission rejection, immutable preparation, concurrent duplicate submit, signature saved before broadcast, lost network responses, RPC outages retaining reservations, proved blockhash expiry, manual retry, finalized successful fill, idempotent reconciliation, completed-order rejection, cancellation, and receipt history.
- Dedicated instruction/signature/receipt tests reject altered routes and messages, wrong-wallet signatures, missing ownership evidence, and failed transaction evidence. Actual receipt mismatches are surfaced rather than treated as a new order.
- Frontend/backend TypeScript checks, targeted frontend lint, and production build passed.

### Remaining pilot gates

No mainnet funds were spent. Live evidence covers read-only routes; transaction execution uses deterministic mocked chain evidence and local PostgreSQL. Browser interaction checks with a funded wallet, customer interviews, provider eligibility review, and a reliable equity reference feed remain before a public pilot. Required premium checks remain unavailable. Phase 5 covers those pilot and hackathon submission tasks.
