# AGENTS.md — Working agreement for the Oink rewrite

You are rewriting a Solana settlement rail (TENDER) into a consumer Solana wallet (Oink).
The full specification lives in `docs/`. Read `docs/00-OVERVIEW.md` first, then the doc for
whatever phase you are on.

Source project to port from: `C:\Users\USER\tender` (read-only — never modify it).

---

## What Oink is, in one paragraph

A self-custodial Solana wallet created with a password and a TOTP authenticator rather than a
seed phrase prompt, identified by a permanent account ID (`oink-k7p2-9xqm`) and, once the user
links X, by a tag (`@pascal`). It is recoverable from any device with **account ID or tag +
password + TOTP code**. Every wallet has a *mix* — a basis-points allocation across tokenized
stocks and stablecoins — and inbound payments settle atomically into that allocation through
Jupiter. A linked email or X account can be paid even before its owner joins, through a held
payment (`docs/12-IDENTITY-ESCROW-ADMIN.md`). Built for a Solana stocks hackathon.

---

## Rules that are not up for negotiation

1. **The private key never leaves the browser in plaintext.** Not in a request, a log, a
   database column, an error message, or a monitoring breadcrumb. The server stores only
   ciphertext it cannot decrypt.
2. **Implement `docs/02-WALLET-AND-AUTH-SPEC.md` exactly.** Do not substitute algorithms,
   lower Argon2id parameters, skip the HKDF `encKey` / `authKey` split, or drop the AAD.
   If a library makes something awkward, ask — do not improvise around the spec.
3. **X/Twitter is required only to claim a tag.** Creating, receiving, sending, setting a mix,
   unlocking and recovering all work with zero social accounts. The X gate in TENDER
   (`XAuthGate.tsx`) is deleted, not ported.
4. **No custodial signing.** The server-held keys are the fee payer, which can pay fees and
   nothing else, and the Privy refund signer, which exists only on held-payment wallets and
   is policy-limited to returning funds to the sender or delivering them to the verified
   claimant (`docs/12-...` §6, approved 2026-09-23). It is never added to a user's Oink
   wallet. If a feature seems to need any other server-side key, stop and ask.
5. **No EVM.** No wagmi, no viem, no Robinhood Chain, no `/api/v2`, no rail abstraction.
6. **Amounts are `BigInt`.** Never floating point for token amounts. Format at the display
   edge only.
7. **Copy, do not retype,** anything marked COPY in `docs/08-PORTING-MAP.md` — especially
   `backend/src/lib/rwaTokens.ts` and `backend/src/services/txBuilder.ts`.

---

## How to work

- **One phase at a time**, per `docs/09-BUILD-PLAN.md`. Do not start a phase until the
  previous one's acceptance criteria actually pass.
- **Phases 1 and 2 are test-first.** Write the crypto tests before the crypto.
- **Run what you write.** Report what passed and what did not, with the output. Never call a
  phase done on the strength of unexecuted code.
- **Ask when a decision is genuinely open.** Defaults for the known open questions are in
  `docs/00-OVERVIEW.md` §5 — use them rather than blocking when the answer would not change
  the work.
- When you find a real problem with the spec, say so in a sentence or two and keep building
  under a stated assumption. Do not silently deviate.

---

## Conventions

- **Language:** TypeScript, strict. No `any` in new code except where TENDER's server-function
  serialisation genuinely requires it (it is commented where that happens).
- **Package manager:** Bun.
- **Frontend:** TanStack Start (file-based routes), React 19, Tailwind v4 with CSS tokens in
  `src/styles.css`, shadcn/ui, TanStack Query for server state, Zustand only for trivial UI
  state — **never** for anything touching keys.
- **Backend:** Bun + Express + `pg`. Routers per resource, services for logic, no ORM.
- **Migrations:** numbered, forward-only SQL in `backend/db/migrations/`.
- **Errors:** the envelope in `docs/04-API-SPEC.md` §0. Stable machine codes, user-safe
  messages, `details` null in production for anything near credentials.
- **Comments:** explain *why*, not *what*. TENDER's header comments on non-obvious modules
  (see `src/lib/rail.ts`, `src/lib/wallet/wallet-context.tsx`) are a good model — match that
  density and tone.
- **Naming:** `tag` not `handle`, `transfers` not `settlements`, `mix` not `election`,
  `accountId` for the permanent wallet identifier.

---

## Security checklist before any commit that touches auth or signing

- [ ] No key material in logs — check the redaction list in `docs/02-...` §9
- [ ] No secret has a `|| ""` fallback in `config.ts`
- [ ] Credential errors are indistinguishable from one another
- [ ] The signed transaction is re-validated against the server-built message before broadcast
- [ ] The fee payer cannot move user funds — read the built instructions and confirm
- [ ] Rate limits are applied to the endpoint you just added, if it touches credentials
- [ ] Tests cover the failure path, not only the happy path

---

## Definition of done for the whole project

A person can, on a phone, with no wallet extension and without typing a seed phrase:

create a wallet with a password and an authenticator, link X to claim `@them`, receive USDC
from a friend's Phantom, watch it settle 60/40 into `SPYx` and `USDC` because that is their
mix, send 5 USDC to `@friend`, wipe the browser, and get the whole thing back on a laptop
with their tag, password and a 6-digit code.
