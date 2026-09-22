# OINK — Product Overview & Rewrite Brief

> **Read this first.** Every other doc in `docs/` assumes the decisions on this page.

---

## 1. What Oink is

Oink is a **self-custodial Solana wallet with a human-readable tag and no seed-phrase
onboarding**. A user creates a wallet with a password and a TOTP authenticator, claims a
unique tag (e.g. `@pascal`), and can immediately:

- **Receive from other Oink users** by tag — `@pascal`
- **Receive from any normal wallet** by copying the raw Solana address or QR
- **Hold a portfolio, not a currency** — inbound payments settle atomically into the
  user's *election* (e.g. 60% `SPYx`, 30% `USDC`, 10% `GLDx`) via Jupiter, in one transaction
- **Recover the wallet from any device** with **tag + password + TOTP code** — no seed
  phrase typed at every login (the 12-word phrase is the backup, not the daily credential)

The election engine is the hackathon thesis and is carried over from TENDER unchanged in
spirit: **receivers decide what they get paid in.** Oink is the consumer wrapper that makes
that usable without an external wallet extension.

**Hackathon framing:** Solana Stocks / xStocks. The asset universe is tokenized equities
and ETFs (`SPYx`, `NVDAx`, `TSLAx`, `AAPLx`, …) plus `USDC` and `SOL`.

---

## 2. What changes from TENDER

TENDER (`C:\Users\USER\tender`) is the source project. It is a **non-custodial settlement
rail that requires an external wallet** (Phantom/Solflare via Wallet Standard, plus a second
EVM "Robinhood Chain" rail via wagmi/viem). Oink keeps the settlement thesis and throws away
the two-rail architecture and the external-wallet dependency.

| Area | TENDER | OINK |
| :--- | :--- | :--- |
| Wallet | External, Wallet Standard | **Embedded, generated in-browser, encrypted keystore** |
| Chains | Solana (v1) + Robinhood EVM (v2) | **Solana only** |
| Identity | Handle bound to a connected wallet | **Tag is the account.** Wallet is derived from enrollment |
| Auth | Sign a message with the external wallet | **Password (Argon2id) + TOTP (RFC 6238)** |
| Recovery | Whatever the external wallet does | **tag + password + TOTP**; the 12-word secret phrase is the fallback |
| X / Twitter | **Required** to use the dashboard (`XAuthGate`) | **Never required.** Optional Phase 2 for Oinkbot |
| Elections | Kept | **Kept, unchanged in concept** |
| Invoices / Pay links | Kept | **Kept** |
| API surface | `/api/v1` (Solana) + `/api/v2` (EVM) | **`/api/v1` only** |
| Frontend | Marketing site + terminal dashboard | **Wallet app first**, thin marketing shell |

### Hard deletions
Everything EVM, everything Robinhood Chain, everything rail-switching, and the mandatory X
gate. See `08-PORTING-MAP.md` for the exact file list.

---

## 3. Non-negotiable product rules

1. **The private key never leaves the browser in plaintext.** Not in a request body, not in
   a log, not in the database, not in an error message. The server stores only ciphertext.
2. **X/Twitter login is never required.** Wallet creation, receiving, sending, elections and
   recovery all work with zero social accounts. X is an *additive* Phase 2 feature for the
   Oinkbot only.
3. **A user who forgets their password loses the wallet** unless they kept the 12-word
   secret phrase. It is the only backup in the product — there are no recovery codes and no
   support channel. This must be stated plainly in the UI at enrollment, and the phrase must
   be shown once with a forced confirmation step.
4. **Tags are globally unique, immutable once claimed, and case-insensitive.**
5. **No custodial signing.** The server may *build* transactions and may *co-sign as fee
   payer*, but it never holds a user's spend authority.

---

## 4. Decisions already made (do not re-litigate)

| Decision | Choice | Why |
| :--- | :--- | :--- |
| Custody model | Client-side encrypted keystore, server holds ciphertext only | Only model where tag+password+TOTP recovery works without the server being able to steal funds |
| KDF | Argon2id → HKDF split into `encKey` / `authKey` | Server can verify the password without ever being able to decrypt |
| Cipher | AES-256-GCM via WebCrypto | Native, no extra dependency, authenticated |
| Key material | BIP39 12-word phrase → `m/44'/501'/0'/0'` Ed25519 | Phantom/Solflare-compatible; the phrase is the one backup artifact and the one recovery fallback |
| TOTP | RFC 6238, SHA-1, 6 digits, 30s, ±1 window | Works with Google Authenticator / Authy / 1Password |
| Tag format | `@tag`, `^[a-z0-9_]{3,20}$`, stored lowercase | Matches TENDER's handle rules; `$tag` accepted as input alias |
| Routing venue | Jupiter only for v1 | Relay was for cross-chain; not needed. Optional Phase 2 |
| Fee payer | Server-sponsored co-signing, capped | A brand-new wallet has 0 SOL and cannot otherwise transact |
| Stack | TanStack Start + React 19 + Tailwind v4 + shadcn; Bun + Express + Postgres | Carried over from TENDER; proven, and the port is cheaper |

---

## 5. Open decisions for the human

These are listed in `09-BUILD-PLAN.md` as gates. Defaults are given so the AI is never blocked.

1. **Fee sponsorship cap** — default: 20 sponsored transactions per tag per day, hard-stop
   at a configurable lamport budget.
2. **Mainnet vs devnet for the demo** — default: build against **devnet** for development,
   ship the demo on **mainnet-beta** with a small float.
3. **Brand palette** — a default pink/plum palette is specified in `06-FRONTEND-SPEC.md`;
   swap the token values if the human has art direction.
4. **Domain** — `oink.*`; the API lives at `api.<domain>`.

---

## 6. Document map

| File | Contents |
| :--- | :--- |
| `00-OVERVIEW.md` | This file. Vision, rules, decisions |
| `01-ARCHITECTURE.md` | System shape, repos, runtime, data flow diagrams |
| `02-WALLET-AND-AUTH-SPEC.md` | **The critical doc.** Crypto, enrollment, unlock, recovery, threat model |
| `03-DATA-MODEL.md` | Complete Postgres schema, fresh |
| `04-API-SPEC.md` | Every endpoint, request/response shapes, error codes |
| `05-SETTLEMENT-AND-ELECTIONS.md` | Election engine, Jupiter routing, send/receive paths, fee payer |
| `06-FRONTEND-SPEC.md` | Routes, screens, components, state, design tokens |
| `07-OINKBOT-X.md` | Phase 2 X integration and delegated-signing design |
| `08-PORTING-MAP.md` | File-by-file keep / adapt / drop against `C:\Users\USER\tender` |
| `09-BUILD-PLAN.md` | Phased task list with acceptance criteria |
| `10-ENV-AND-DEPLOY.md` | Env vars, new GitHub, new database, hosting |
| `../AGENTS.md` | Working agreement for the AI doing the rewrite |
