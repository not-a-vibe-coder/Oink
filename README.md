# Oink

![CI](https://github.com/OWNER/OINK/actions/workflows/backend.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.x-000000?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Solana](https://img.shields.io/badge/Solana-mainnet--beta-9945FF?logo=solana&logoColor=white)

Oink is a self-custodial Solana wallet with tag-based identity, password + TOTP recovery, and receive-side portfolio elections over tokenized stocks.

## How it works

| Create | Receive | Elect | Recover |
| --- | --- | --- | --- |
| Claim `@tag`, set a password and authenticator. | Accept Solana payments by tag or address. | Choose the portfolio incoming payments settle into. | Restore on another device with tag + password + TOTP. |

## Security model

| Location | Holds | A database breach exposes |
| --- | --- | --- |
| Browser | Password, mnemonic entropy, `encKey`, decrypted private key | Nothing directly; the private key never leaves the browser plaintext. |
| API | Ciphertext, server-encrypted TOTP secret, password-proof hash | Ciphertext and expensive-to-brute-force password material, never a decrypting key. |
| Database | Ciphertext, keystore metadata, sessions, elections | No mnemonic, private key, password, or `encKey`. |

## Repository structure

```text
src/                TanStack Start wallet application
backend/            Bun, Express, PostgreSQL API
backend/db/         Forward-only migrations
docs/               Product, security, and build specifications
```

## Getting started

```bash
bun install
cd backend && bun install
copy .env.example .env
copy backend/.env.example backend/.env
cd backend && bun run migrate && bun run dev
```

In a second terminal, run `bun run dev` from the repository root. Production secrets and a fresh PostgreSQL database are required before running the API in production.

## API

| Prefix | Purpose |
| --- | --- |
| `/health` | Deployment health check |
| `/api/v1` | Wallet enrollment, authentication, balances, elections, transfers, invoices |

There is no `/api/v2`.

## Roadmap

0. Scaffold · 1. Browser crypto core · 2. Enrollment and unlock · 3. Balances and receive · 4. Elections · 5. Send and settlement · 6. Invoices and rebalance · 7. Security surface and polish · 8. Hardening and mainnet · 9. Optional Oinkbot.

## Tech stack

TanStack Start, React 19, Tailwind v4, Bun, Express, PostgreSQL, Solana, Jupiter.
