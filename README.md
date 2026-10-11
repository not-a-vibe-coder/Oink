# Oink

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.x-000000?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Solana](https://img.shields.io/badge/Solana-mainnet--beta-9945FF?logo=solana&logoColor=white)

## Oink: get paid in stocks, on your phone.

Send a client a payment link. When their USDC lands and Oink verifies it on-chain, one tap
applies your **payday plan**: your cash reserve is topped up first, and the surplus becomes
orders for the tokenized stocks you chose (SPYx, NVDAx, AAPLx). **Bell** checks each order
against your limits, and nothing is bought until you sign it on your phone. Payments to your
@tag can also settle straight into your **Mix** in the payer's own transaction. There's no seed
phrase, no broker and no wallet extension: a password plus an authenticator opens an encrypted
wallet that lives in your browser.

| | What it does | Where |
| --- | --- | --- |
| **Oink** (account) | Password + TOTP encrypted browser wallet, @tags, mixes, payment links | `src/lib/crypto`, `src/lib/wallet`, `backend/src/routes/{auth,mix,invoices}.ts` |
| **Flow** (plan) | Referenced USDC intake, finalized receipt check, cash-first BigInt allocation, reservations | `src/lib/flow`, `backend/src/services/flow` |
| **Bell** (safety) | Jupiter Swap v2 quotes, policy checks, guarded assembly, local signing, persist-before-broadcast, reconciliation, retry/cancel | `src/lib/bell`, `backend/src/services/bell` |
| **Mobile** | Installable PWA, Android TWA APK, Seeker wallets via Mobile Wallet Adapter, opt-in push, SKR holder perk | `public/`, `twa/`, `src/lib/mwa`, `backend/src/services/push.ts` |

**Links**: the bracketed items are not done yet; the founder fills them in.

- Live app: **[DEMO URL — pending deploy]** · simulated walkthrough at `/demo`
- Android APK: **[APK link — pending; build with `twa/build-apk.ts`]**
- Demo video: **[pending]** · Pitch video: **[pending]** · Deck: [`docs/submission/deck/oink-deck.html`](docs/submission/deck/oink-deck.html)
- First mainnet Bell fill (Solscan): **[pending — no live fill has been made yet]**
- [Submission draft](docs/submission/04-SUBMISSION-DRAFT.md) · [Pitch and demo scripts](docs/submission/03-PITCH-AND-DEMO.md) · [Evidence](docs/submission/06-EVIDENCE.md) · [Reuse disclosure](docs/submission/05-REUSE-DISCLOSURE.md) · [Deploy guide](docs/submission/08-DEPLOY.md) · [Build log](docs/submission/07-BUILD-LOG.md)

**Custody.** The private key never leaves the browser in plaintext, and the server never
holds spend authority. In Bell, the user is the only signer and fee payer. Bell defers a
purchase, and the money stays in USDC, whenever a quote fails a limit, expires, or (with a
premium cap set) lacks fresh regular-session reference data. It never invents a price.

**Honest limits.** xStocks are not offered to US persons, and eligibility depends on the
issuer's terms in your jurisdiction. Premium caps need a Pyth API key and regular US market
hours; otherwise they fail closed. Bell users pay their own SOL network fees and account rent.
No live mainnet fill, users or revenue are claimed yet; everything shown in `/demo` is
labelled as a simulation.

## Review the product

Run `bun install --frozen-lockfile`, then `bun run dev --host 127.0.0.1 --port 3105` and open `/demo`. This isolated walkthrough needs no API, account or funds; every payment and fill is explicitly simulated. The real account workflow lives at `/app` (home "Payday plan" card → `/app/income`) and needs the backend.

## Security model

| Location | Holds                                                         | A database breach exposes                                                          |
| -------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Browser  | Password, mnemonic entropy, `encKey`, decrypted private key   | Nothing directly; the private key never leaves the browser plaintext.              |
| API      | Ciphertext, server-encrypted TOTP secret, password-proof hash | Ciphertext and expensive-to-brute-force password material, never a decrypting key. |
| Database | Ciphertext, keystore metadata, sessions, elections            | No mnemonic, private key, password, or `encKey`.                                   |

## Repository structure

```text
src/                TanStack Start wallet application
backend/            Bun, Express, PostgreSQL API
backend/db/         Forward-only migrations
docs/               Product, security, and build specifications
```

## Getting started

```bash
bun install --frozen-lockfile
(cd backend && bun install --frozen-lockfile)
cp .env.example .env
cp backend/.env.example backend/.env
# Configure a disposable database, RPC/network, APP_URL and required secrets.
(cd backend && bun run migrate && bun run dev)
```

In a second terminal, run `bun run dev` from the repository root. Production secrets and a fresh PostgreSQL database are required before running the API in production.

## API

| Prefix    | Purpose                                                                     |
| --------- | --------------------------------------------------------------------------- |
| `/health` | Deployment health check                                                     |
| `/api/v1` | Wallet enrollment, authentication, balances, elections, transfers, invoices |

There is no `/api/v2`.

## Roadmap

0. Scaffold · 1. Browser crypto core · 2. Enrollment and unlock · 3. Balances and receive · 4. Elections · 5. Send and settlement · 6. Invoices and rebalance · 7. Security surface and polish · 8. Hardening and mainnet · 9. Optional Oinkbot.

## Tech stack

TanStack Start, React 19, Tailwind v4, Bun, Express, PostgreSQL, Solana, Jupiter.

## Verification

`bun run verify:flow` checks frontend/backend types, targeted lint, unit tests, and the production build. Supply a **disposable** TEST_DATABASE_URL to additionally run the three Flow/Bell PostgreSQL suites in separate processes; they apply migrations and create/delete fixture accounts. The script keeps other optional integration suites out of that database run. It does not broadcast any transaction.

For the browser rehearsal, install Chromium with `bunx playwright install chromium`, start the frontend on port 3105, and run `bun run check:demo`. Override DEMO_BASE_URL if needed. This regenerates labelled simulation screenshots, a silent recording, and browser evidence.

For mainnet Bell, SOLANA_NETWORK must be mainnet-beta and the RPC must serve the same network; the canonical USDC mint is selected automatically. Non-mainnet Flow requires FLOW_USDC_MINT, and Bell stock execution is unavailable there. JUPITER_API_KEY is optional according to the provider’s access policy. Review [pilot steps](docs/submission/02-PILOT.md) before inviting users.
