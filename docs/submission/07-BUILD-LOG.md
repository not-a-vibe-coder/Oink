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
