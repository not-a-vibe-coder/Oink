# Oink — Rewrite Documentation

Specification set for rewriting TENDER (`C:\Users\USER\tender`) into **Oink**, a
self-custodial Solana wallet with tag-based identity, password + TOTP recovery, and
receive-side portfolio elections over tokenized stocks.

## Read in this order

| # | Document | Read it when |
| :--- | :--- | :--- |
| 00 | [Overview & Rewrite Brief](00-OVERVIEW.md) | **First, always.** Vision, hard rules, settled decisions |
| 01 | [Architecture](01-ARCHITECTURE.md) | Before touching structure. Repo shape, trust boundaries, core flows |
| 02 | [Wallet, Auth & Recovery Spec](02-WALLET-AND-AUTH-SPEC.md) | **Before writing any crypto.** The authoritative doc |
| 03 | [Data Model](03-DATA-MODEL.md) | Writing migrations |
| 04 | [API Specification](04-API-SPEC.md) | Building or calling an endpoint |
| 05 | [Settlement & Elections](05-SETTLEMENT-AND-ELECTIONS.md) | Building quotes, transactions, fees |
| 06 | [Frontend Specification](06-FRONTEND-SPEC.md) | Building screens |
| 07 | [Oinkbot on X](07-OINKBOT-X.md) | Phase 9 only. Deferred by design |
| 08 | [Porting Map](08-PORTING-MAP.md) | Every time you wonder whether a TENDER file survives |
| 09 | [Build Plan](09-BUILD-PLAN.md) | Planning work, checking a phase is done |
| 10 | [Environment & Deploy](10-ENV-AND-DEPLOY.md) | Secrets, hosting, the pre-launch gate |
| 11 | [Monorepo Scaffolding Guide](11-SCAFFOLD-GUIDE.md) | **Phase 0 only.** Hand it to the AI that creates the empty repo |
| — | [AGENTS.md](../AGENTS.md) | The working agreement. Keep it loaded |

## The three things that matter most

1. **The private key never leaves the browser in plaintext** — `02` §1-3
2. **X/Twitter is never required** — `00` §3, `07`
3. **The election engine is the hackathon thesis** — port it, do not reinvent it — `05`

## The demo moment

Destroy the browser profile on stage. Bring the wallet back on another machine with a tag, a
password and a 6-digit code. No secret phrase typed, no extension.

The 12-word phrase still exists — it is the backup, and the fallback if the password or the
authenticator is lost. It is just not what you use to log in.
