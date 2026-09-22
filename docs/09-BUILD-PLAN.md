# OINK — Build Plan

Nine phases. Each has a definition of done that can actually be checked. **Do not start a
phase until the previous one's acceptance criteria pass.** The demo is built on devnet and
only moved to mainnet-beta in Phase 8.

---

## Phase 0 — Scaffold

**Follow `11-SCAFFOLD-GUIDE.md` step by step.** It is the full twelve-step version of this
phase, with the exact files, configs and CI jobs. In summary:

1. New git repository and remote; directory structure
2. Frontend scaffold — explicit `vite.config.ts` (no lovable wrapper), Tailwind v4 theme with
   the Oink palette, router, `server.ts` / `start.ts`, landing page; copy `components/ui/**`
3. Backend scaffold — `config.ts` with `requiredSecret`, `app.ts` with a CORS allowlist and
   the extended log redaction, health route, pool, migration runner, `001_wallets.sql`
4. Crypto module skeleton with **failing** Phase 1 tests
5. `.gitignore`, two CI workflows, LICENSE, README, CONTRIBUTING, SECURITY
6. Provision the new Postgres database; confirm the migration runner connects

**Done when:** `bun run dev` serves the landing page, `GET /health` returns `ok` against the
new database, the Phase 1 crypto tests fail for the right reason (`not implemented`), and
`git ls-files` shows no `.env` and no keypair.

---

## Phase 1 — Crypto core (browser)

Build `src/lib/crypto/**` with **tests first**. This is the foundation; a bug here is fund
loss, and it is far cheaper to get right in isolation than inside a wizard.

1. `mnemonic.ts` — generate, validate, entropy round-trip
2. `derive.ts` — SLIP-0010 `m/44'/501'/0'/0'`; verify against a known Phantom test vector
3. `argon.ts` + worker — Argon2id at the specified parameters, with progress
4. `kdf.ts` — HKDF split
5. `keystore.ts` — AES-256-GCM seal/open with AAD

**Done when:**

- A known 12-word test vector derives the expected Solana address (cross-check against
  Phantom or `solana-keygen`)
- `seal` then `open` round-trips with the right password and throws with a wrong one
- Tampering with the AAD (a different tag) makes `open` throw
- Argon2id at `m=65536, t=3, p=1` completes in the worker without blocking the main thread

---

## Phase 2 — Enrollment and unlock, end to end

1. Migration `001_wallets.sql`
2. Backend: `lib/crypto.ts`, `lib/totp.ts`, `lib/argon.ts`, `middleware/rateLimit.ts`,
   `middleware/session.ts`, `routes/enroll.ts`, `routes/auth.ts`, `routes/tags.ts`
3. Frontend: `/create` wizard (5 steps), `/unlock`, `/unlock/restore`, `key-session.ts`

**Done when:**

- A user creates a wallet end to end and lands on an empty `/app` showing their tag and address
- Logging out, clearing all site data, and unlocking on a different browser profile with
  tag + password + TOTP restores the same public key
- A wrong password, a wrong code, and an unknown tag all return the identical error
- TOTP replay is rejected
- Secret-phrase recovery restores the same public key, replaces the password and
  authenticator, and revokes existing sessions
- A signature from a different keypair is rejected by `auth/recover/complete`
- Two concurrent `enroll/complete` calls for the same tag produce exactly one success
- The lockout ladder fires at 5, 10 and 20 failures
- `grep -ri "authKey\|mnemonic\|ciphertext" backend/logs` finds nothing

---

## Phase 3 — Balances and receive

1. Migration `002_elections.sql`; default 100% USDC on enrollment
2. Port the token registry; build `routes/assets.ts`
3. `services/rpc.ts` — balances and prices with caching
4. `routes/wallet.ts`; `/app` home; `/app/receive` with the address QR

**Done when:**

- Sending devnet SOL and devnet USDC to the address from an external wallet shows up in
  `/app` within one refresh, with a correct USD value
- The QR scans correctly in Phantom mobile
- The holdings list renders icons and underlying tickers from the registry

---

## Phase 4 — Elections

1. `routes/elections.ts` with the 10000-bps invariant and revisions
2. `/app/election` editor ported from TENDER's `Elections.tsx`
3. The allocation bar with token colours

**Done when:**

- An election saves, reloads correctly, and rejects a set summing to 99% or 101% with a clear
  message naming the sum
- Duplicate mints and unknown mints are rejected
- The public `GET /api/v1/tags/:tag` shows the election

---

## Phase 5 — Send and settlement

This is the hackathon's centrepiece. Budget the most time here.

1. Port `electionEngine.ts` and `txBuilder.ts`
2. `services/feePayer.ts` with budget enforcement; migration `003_transfers.sql`
3. `routes/transfer.ts` — quote, build, submit, history
4. `/app/send` and `/app/activity`

**Done when:**

- `@a` sends 10 USDC to `@b`, whose election is 60% `SPYx` / 40% `USDC`, and `@b`'s balance
  shows both assets after one confirmed transaction
- The quote preview matches what actually lands, within slippage
- A leg breaching the price-impact cap safe-settles to USDC and is labelled in the UI
- A wallet with zero SOL can still send, via fee sponsorship, and the sponsorship is recorded
- The daily sponsorship cap returns `429 SPONSORSHIP_EXHAUSTED` when exceeded
- A tampered `signedTransaction` (message differing from the built one) is rejected at submit
- Sending to a raw external address works and forces `applyElection: false`
- Activity shows both sides with the correct counterparty tag

---

## Phase 6 — Invoices, requests, rebalance

1. Migration `004_invoices.sql`, `005_social.sql`
2. `routes/invoices.ts`; `/app/invoices`; the public `/pay/:invoiceId`
3. Payment requests between tags
4. Rebalance-in-place on `/app`

**Done when:**

- An invoice link opens with no session, shows the amount and the creator's election, and can
  be paid by another Oink user
- An expired invoice cannot be paid
- Rebalance converts an existing balance to match the election in one transaction

---

## Phase 7 — Settings, security surface, polish

1. Password rotation (re-encrypt with a new salt), TOTP rotation
2. Session list and revocation; auto-lock; the optional trust-this-device toggle
3. Secret-phrase reveal/export behind password + TOTP
4. Landing page; empty states; error states; mobile pass at 375px
5. Loading skeletons; tabular figures; `prefers-reduced-motion`

**Done when:**

- A password change keeps the same public key and funds, and invalidates other sessions
- Revoking a session on device A logs out device B on its next request
- Every screen works at 375px with no horizontal scroll
- Password managers fill and save the credentials correctly

---

## Phase 8 — Hardening and mainnet

1. CSP header per `02-WALLET-AND-AUTH-SPEC.md` §9, verified with no console violations
2. CORS allowlist, not `cors()` open
3. Rate limits verified under a scripted burst
4. Log redaction audited against a real request trace
5. Secrets rotated; fee payer funded with a small float and monitored
6. Point the frontend at mainnet-beta; smoke-test with a small real amount
7. Back up the database; document the restore

**Done when:** the checklist in §"Pre-launch gate" below is fully green.

---

## Phase 9 — Oinkbot (optional, only if Phases 0-8 are done)

Per `07-OINKBOT-X.md`, Option A (staged intents) only. Migration `006_bot.sql`, X linking
from settings, the poller, the intent router, and the confirm sheet in `/app`.

---

## Pre-launch gate

Every line must be true before a real user touches this with real money.

- [ ] No private key, mnemonic, `encKey`, or password appears in any log, database column,
      error message, or network request body
- [ ] `authKey` is redacted in request logs and stored only as an Argon2id hash
- [ ] `OINK_KMS_KEY`, `OINK_DECOY_KEY` and `FEE_PAYER_SECRET_KEY` are set from a secret
      manager, never committed, and the server refuses to boot without them
- [ ] Wrong password, wrong TOTP and unknown tag are indistinguishable to a caller
- [ ] TOTP replay is rejected, and a recovery challenge cannot be replayed or reused
- [ ] Rate limits and the lockout ladder are verified, not assumed
- [ ] The signed transaction is re-validated against the server-built message before broadcast
- [ ] The fee payer cannot move user funds — verified by reading the built instructions
- [ ] Sponsorship budgets are enforced and recorded
- [ ] CSP is enforced and the app runs clean under it
- [ ] CORS is an explicit allowlist with `credentials: true`
- [ ] Session cookies are `HttpOnly; Secure; SameSite=Lax`
- [ ] The secret-phrase ceremony forces verification before it can be dismissed
- [ ] The UI states plainly, before the password is set, that a forgotten password without
      the phrase means permanent loss
- [ ] Secret-phrase recovery has been drilled end to end: forget the password, restore with
      the 12 words, set a new password and authenticator, funds intact
- [ ] A full restore drill has been done: new browser, tag + password + TOTP, funds visible
- [ ] Database backups are on and a restore has actually been tested

---

## Working rules for the AI doing this

1. **Read `02-WALLET-AND-AUTH-SPEC.md` before writing a single line of crypto.** Do not
   substitute a "simpler" algorithm, lower a parameter, or skip the HKDF split.
2. **Copy, do not retype,** anything marked COPY in `08-PORTING-MAP.md`.
3. **Write the test before the crypto.** Phases 1 and 2 are test-first; the rest are not.
4. **Never invent a custody shortcut.** If something seems to need a server-side private key
   other than the fee payer, stop and ask.
5. **One phase at a time.** Report what passed and what did not; do not claim a phase is done
   on the strength of code that has not been run.
6. **Ask when a decision is genuinely open**, using the defaults in `00-OVERVIEW.md` §5 when
   the answer does not change the work.
