# Oink

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.x-000000?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Solana](https://img.shields.io/badge/Solana-mainnet--beta-9945FF?logo=solana&logoColor=white)

Oink Flow + Bell turns received USDC into a cash-first plan: fill a chosen reserve, check tokenized-stock quotes, then let the user review and sign each purchase locally. It builds on Oink’s existing encrypted Solana wallet and design.

## Review the product

Run `bun install --frozen-lockfile`, then `bun run dev --host 127.0.0.1 --port 3105` and open `/demo`. This isolated walkthrough needs no API, account or funds. Every payment and fill is explicitly simulated. The actual account workflow lives at `/app/income` and requires the backend.

- [Submission draft](docs/submission/04-SUBMISSION-DRAFT.md)
- [Pitch and demo scripts](docs/submission/03-PITCH-AND-DEMO.md)
- [Recorded simulation and screenshots](docs/submission/artifacts/README.md)
- [Reuse disclosure](docs/submission/05-REUSE-DISCLOSURE.md)
- [Build evidence](docs/flow/05-PROGRESS.md)

Live evidence covers read-only routes, not funded fills. Customer pilot, founder narration, hosted deployment and contest upload remain pending. Premium checks fail closed without equity reference data. Bell network fees and account creation use the user’s SOL.

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
