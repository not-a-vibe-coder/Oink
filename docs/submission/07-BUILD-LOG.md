# Build log

## 2026-10-11 — Task 0: baseline (passed)

- `git pull --ff-only`: passed (`Already up to date`).
- `bun install --frozen-lockfile` at the repository root: passed; no dependency changes.
- `bun install --frozen-lockfile` in `backend/`: passed; no dependency changes.
- `bun run verify:flow` with
  `TEST_DATABASE_URL=postgresql://jackdotsol@127.0.0.1:55432/oink_test`: passed: root
  TypeScript check, backend TypeScript check, targeted ESLint, production build, `bun test`,
  plus the Flow, Bell quote, and Bell execution PostgreSQL suites.
- `bun test`: **85 passed, 63 skipped, 0 failed**. The skipped tests are database
  integration suites, as expected when no `TEST_DATABASE_URL` is configured.

### Audit result

Passed. The machine initially had no local Postgres or container runtime, so PostgreSQL 16.4
was built into `/private/tmp/oink-postgres` and a fresh, disposable trust-authenticated
instance was initialized at `127.0.0.1:55432`; neither the server nor its data lives in the
repository. In addition to the three database suites invoked by `verify:flow`, the complete
database audit passed:

- `DATABASE_URL=$TEST_DATABASE_URL bun test backend/tests/*.integration.test.ts`:
  **51 passed, 0 failed** across Flow, Bell quotes, Bell execution, held payments, identity,
  and linking/admin.

No product source changes were made. Diff reviewed: this log contains no secret, payment,
or wallet data. Follow-up: task 1 may begin.

## 2026-10-11 — Task 1: correct SpaceX alias (passed)

- Removed the unsafe `SPACEX -> SPYx` alias from `backend/src/lib/tokens.ts`. The registry's
  actual SpaceX instrument is `SPCXx`; a SpaceX text query no longer selects the unrelated
  S&P 500 ETF.
- Reviewed every remaining `SOLANA_COMMON_ALIASES` entry. Each maps a company, ticker, or
  index shorthand to its matching instrument; no frontend alias mirror exists.
- Added `backend/tests/tokens.test.ts`, covering every convenience alias plus the SpaceX,
  `SPCX`, and `SPY` regression cases.

### Audit result

Passed. `bun test backend/tests/tokens.test.ts`: **2 passed, 0 failed (30 assertions)**.
`bun run verify:flow`: passed (TypeScript, targeted lint, full unit suite, build; database
checks are intentionally skipped when `TEST_DATABASE_URL` is absent). Diff reviewed: no
custody behavior, transaction guard, amount arithmetic, or claims changed.

## 2026-10-11 — Task 3: mobile 3D visual pass (passed)

- Added five local, lazy-loaded 512px WebP illustrations from Microsoft Fluent Emoji: landing
  hero, Mix and Holdings empty states, payment-request empty state, payment-received state, and
  Bell empty/deferred/confirmed states.
- Recorded direct source URLs, MIT license, and conversion details in
  `public/illustrations/LICENSES.md`. Assets are transparent and retain the app's light/dark
  surface treatment.

### Audit result

Passed. `bunx tsc --noEmit`, targeted ESLint, and `bun run build` passed. A headless Chromium
check at 390×844 across `/`, `/app/`, `/app/mix`, and `/app/income` found no horizontal overflow.
Images have intrinsic dimensions and `loading="lazy"`; interactive controls remain existing
button/link controls (no reduced tap targets). Diff reviewed: visual assets carry no product
claims and do not change custody, signing, pricing, or payment behavior.

## 2026-10-11 — Task 2: repository hygiene (passed)

- Searched all tracked product files before moving the root clutter. `prompt.md` had no
  references and now lives in `docs/archive/foreign/`. The inspiration PDF now lives in
  `docs/archive/inspiration/`.
- Moved the standalone Vesper mockup and its MP4 into
  `docs/archive/inspiration/vesper/`. Its two referenced WOFF2 fonts moved with it and the
  archived HTML continues to resolve both fonts and its local video; no product route imports
  these files.

### Audit result

Passed. A post-move repository grep found only the archived Vesper video reference; no product
file refers to the moved files. `bun run build` passed. Diff reviewed: this is relocation only;
no runtime product, custody, amount, or security behavior changed.

## 2026-10-11 — Task 4: one journey (passed)

- Added `GET /api/v1/flow/summary` (session required, read-only): cash-reserve progress, Bell
  order counts by state, unallocated received payments, open requests and one next action.
  Shared BigInt rules live in `src/lib/flow/journey.ts`. The balance is read after the DB
  snapshot commits (no row lock held across RPC); an RPC/config failure or an unresolved
  submitted order reports the reserve as unavailable rather than estimating it.
- Home now opens with a "Payday plan" card (reserve progress, Bell open/done counts, Mix →
  Reserve first → Bell chips, one primary action deep-linking to `#plan`, `#request`,
  `#requests` or `#bell` on Income). Mix links to the payday plan; Income explains Mix vs.
  payment-link plan and links to Bell.
- `/demo` renders the same card from a simulated summary computed with the production rules.

### Audit result

Passed. `bun run verify:flow` with the disposable `TEST_DATABASE_URL`: exit 0 (types, lint
including new `src/components/flow`, build); main suite **97 passed, 65 skipped, 0 failed**.
`DATABASE_URL=$TEST_DATABASE_URL bun test backend/tests/*.integration.test.ts`: **53 passed,
0 failed** (adds summary auth, cross-account isolation, next action, and RPC-failure fail-closed
cases). Playwright at 360/390/430px on `/demo` through allocation and quotes: no horizontal
overflow; all card links/buttons ≥ 44px. Diff reviewed: no custody, signing, amount-float or
claim changes; the authenticated home card was not exercised in a browser (needs a backend
session) and is covered by type/build and API tests.

## 2026-10-11 — Task 5: Bell reference prices and market session (passed)

- **Live check (Oct 11, 19:14 UTC):** Pyth Hermes still lists regular-session feeds
  `Equity.US.SPY/USD`, `AAPL`, `NVDA` with a public, holiday-aware schedule, but every price
  request (equity and BTC alike) now returns **HTTP 401 unauthorized**. Pyth's docs confirm
  Hermes has required an API key since the August 26, 2026 Pyth Core upgrade
  (https://docs.pyth.network/price-feeds/core/upgrade/preparing). Prices are therefore used
  only with `PYTH_API_KEY`; without it the premium cap stays fail-closed.
- **Live check:** SPYx/AAPLx/NVDAx are Token-2022 mints with ScaledUiAmount multipliers
  ≈1.00571 / 1.00327 / 1.00170 (new multipliers already effective), so 1:1 would be wrong.
- Added `src/lib/bell/reference.ts` (exact f64→rational multiplier, effective-timestamp
  switch, schedule parser and ET session, BigInt premium math against the lower confidence
  bound, freshness/confidence gaps) and `backend/src/services/bell/reference.ts` (pinned feed
  IDs with symbol re-check, Bearer-authenticated price fetch, on-chain multiplier). The policy
  gains `PREMIUM_LIMIT`; a cap passes only with fresh (≤60 s), regular-session, ≤2%-confidence
  evidence and a valid multiplier, and is re-evaluated from the stored brief at prepare and
  submit. Quotes now show a session badge and, when usable, the per-share premium; the order
  form adds an optional premium limit.
- Documented `PYTH_API_KEY` / `PYTH_HERMES_URL` in `backend/.env.example` and docs/10, and
  updated docs/bell/01.

### Audit result

Passed. `bun run verify:flow` (disposable DB): exit 0; main suite **117 passed, 66 skipped,
0 failed**; Flow 7, Bell quotes 3 (new premium pass/defer case), Bell execution 3. All DB suites:
**54 passed, 0 failed**. New tests cover session (DST, weekends, holidays, half days, malformed),
multiplier (exactness, effective switch, invalid values), premium (exact floor, multiplier,
confidence, exponent sign), stale/future/missing/low-confidence/corrupt data, 401, metadata
mismatch and non-Token-2022 mints. Live smoke against mainnet without a key: session `closed`,
reason `NOT_CONFIGURED`, real multipliers read. Diff reviewed: no change to signer, instruction,
route, simulation, expiry or persist-before-broadcast guards; the key is read from env and only
sent as a header to Hermes; no prices invented. Follow-up: the founder needs a Pyth key to
enable premium caps in production.

## 2026-10-11 — Task 6: Seeker wallet via Mobile Wallet Adapter (passed)

- Added `@solana-mobile/wallet-standard-mobile@0.6.0` (the stable release from August 2026;
  0.7.0 was only four days old), `@wallet-standard/app@1.1.0` and `@wallet-standard/base@1.1.1`,
  all pinned exactly. `registerMwa` is called lazily through a dynamic import, client-only, and
  only in Android Chrome (WebViews, iOS, desktop and other Android browsers are excluded);
  every connect/sign call runs from a tap handler.
- `/income/$invoiceId`: "Connect wallet to pay" prepares a server-built, unsigned referenced
  USDC transfer (`POST /api/v1/flow/invoices/:id/transaction`, public, rate-limited). The second
  tap signs and sends in the payer's wallet, and receipt then goes through the unchanged
  `confirm` endpoint (finalized, reference, exact amount), retried for up to 2 minutes.
- `/pay/$invoiceId`: "Pay with Seeker wallet" uses the existing Solana Pay
  transaction-request endpoint (mix settlement). It now also returns `chain`, which wallets
  ignore.
- Receive: "Top up from Seeker wallet" (`POST /api/v1/flow/topup/transaction`, session
  required) sends USDC and/or SOL for Bell fees into the session's own Oink wallet.
- The builder asserts that the external wallet is the only signer and fee payer, and attaches
  the reference as a read-only non-signer. No Oink or server key is added, and the Oink account
  wallet remains the only Bell signer.

### Audit result

Passed. `bun run verify:flow` (disposable DB): exit 0, main suite **124 passed, 67 skipped,
0 failed**. All DB suites: **55 passed, 0 failed**. New tests cover the sole-signer invariant,
the reference flags, exact transferChecked amount/decimals, SOL+USDC top-up, rejection paths,
the route state (open/paid/self-pay/401/bad amounts), UA gating and transaction-request
parsing. Build passes; the MWA chunk is lazy (`SeekerWallet-*.js`, `index.browser-*.js`) and
contains no React Native code (the three pre-existing `react-native` strings come from Privy).
**Not yet exercised on an Android device**; that happens with the APK (task 10).

**Pre-existing finding (not changed here):** the legacy `POST /api/v1/invoices/:id/confirm`
is unauthenticated and marks a pending invoice paid on any claimed signature without chain
verification. The Seeker flow on `/pay` deliberately does not call it. Follow-up: verify it
on-chain, or remove it.
