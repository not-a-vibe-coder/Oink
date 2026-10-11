# Deploy guide: mainnet-beta

Oink deploys as two services: the **API + PostgreSQL on Render** (`render.yaml`,
`backend.Dockerfile`) and the **web app on Vercel** (`vercel.json`). The Android APK
(`twa/`) wraps the Vercel URL. Bell only executes on **mainnet-beta**, so this guide targets
mainnet. Every user signs locally; neither service ever holds a user key.

> **Warning: `OINK_KMS_KEY` seals every user's authenticator (TOTP) secret.** If you lose it
> or change it, every user is locked out of 2FA and must restore with their 12-word phrase.
> Generate it once, store it in a password manager, and never regenerate secrets over a live
> deployment.

## 0. Accounts

- GitHub access to `not-a-vibe-coder/Oink`
- Render (API + Postgres; the Starter plan keeps the API awake)
- Vercel (frontend)
- Helius or another **mainnet** RPC provider (`SOLANA_RPC_URL`)
- Optional: Jupiter API key (per Jupiter's access policy), Pyth API key (Bell premium caps),
  Privy (X/email linking, admin), Resend (held-payment email)

## 1. Generate secrets (once)

```bash
bun install --frozen-lockfile
bun scripts/generate-secrets.ts        # → .secrets/oink-production.env (mode 600, gitignored)
```

It prints only the fee payer's **address** and the VAPID **public** key, never a secret.
Fund the fee payer with a small amount of SOL (e.g. 0.1). It pays only sponsored network
fees, and per-account and global daily caps apply. Move the file into your password
manager when you are done.

## 2. API on Render

1. Render → **New → Blueprint** → select the repository. This creates `oink-api` (Docker)
   and `oink-db` (PostgreSQL 16).
2. Fill the `sync: false` values (checklist below) from `.secrets/oink-production.env`.
3. Deploy. Migrations run at boot (forward-only). Check
   `https://<api>.onrender.com/health` → `{"status":"ok","network":"mainnet-beta",…}`.
   A missing or short secret makes the API **refuse to start**, by design.

### Backend env checklist (mainnet)

| Variable | Value | Required |
| --- | --- | --- |
| `NODE_ENV` | `production` (set by blueprint) | yes |
| `SOLANA_NETWORK` | `mainnet-beta` (set by blueprint) | yes, Bell refuses other networks |
| `SOLANA_RPC_URL` | your mainnet RPC URL with key | yes; must be the same network |
| `APP_URL` | the Vercel origin, e.g. `https://app.your-domain.com` | yes (CORS, links) |
| `PUBLIC_API_URL` | this API's public URL | yes for mix-settling Solana Pay links |
| `DATABASE_URL` | from `oink-db` (blueprint) | yes |
| `OINK_KMS_KEY` `OINK_DECOY_KEY` `OINK_SESSION_SECRET` `OINK_ARGON_PEPPER` | generated | yes (boot refuses without) |
| `OINK_PROXY_SECRET` | generated; **same value on Vercel** | yes (per-user rate limits) |
| `FEE_PAYER_SECRET_KEY` | generated; fund its address | yes for sponsored transfers |
| `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `VAPID_SUBJECT` | generated / `mailto:` | optional (push) |
| `JUPITER_API_KEY` | from Jupiter | optional |
| `PYTH_API_KEY` | from Pyth | optional (premium caps stay fail-closed without it) |
| `SKR_HOLDER_MIN_BASE` etc. | defaults in docs/10 | optional |
| `PRIVY_*`, `RESEND_API_KEY`, `X_BEARER_TOKEN` | see docs/10 | optional |

`FLOW_USDC_MINT` is **not** needed on mainnet: canonical USDC is selected automatically.

## 3. Web app on Vercel

1. Vercel → **Add New → Project** → import the repository (root directory = repo root).
   `vercel.json` sets the Bun install and build. Nitro auto-selects the Vercel preset.
2. Environment variables (Production):

| Variable | Value |
| --- | --- |
| `OINK_API_URL` | `https://<api>.onrender.com` (or your API domain) |
| `OINK_API_FALLBACK_URL` | same Render URL |
| `OINK_PROXY_SECRET` | identical to the backend's |
| `VITE_APP_URL` | the Vercel production origin |
| `VITE_SOLANA_NETWORK` | `mainnet-beta` |
| `VITE_SOLANA_EXPLORER` | `https://solscan.io` |
| `VITE_PRIVY_APP_ID` | optional |

3. Deploy, then set `APP_URL` on Render to the final Vercel origin (custom domain if you use
   one) and redeploy the API.
4. Check: `/` loads; `/app` installs as a PWA; `/manifest.webmanifest`, `/sw.js` and
   `/.well-known/assetlinks.json` return 200.

## 4. Android APK for the real domain

```bash
cd twa && bun install --frozen-lockfile
set -a && . ~/.oink/android/keystore.env && set +a       # created on the build machine
OINK_TWA_HOST=app.your-domain.com OINK_TWA_VERSION_CODE=2 OINK_TWA_VERSION_NAME=1.0.1 bun build-apk.ts
```

Commit the regenerated `public/.well-known/assetlinks.json` (only the host changes
the APK; the fingerprint stays the same while you use the same keystore) and redeploy Vercel.
Install the APK on an Android phone: it should open full-screen with no URL bar. Then test
sign-in, a Bell signature and "Pay with Seeker wallet". Back up `~/.oink/android/` (keystore +
password) together; see `twa/README.md`.

## 5. Smoke test on mainnet (real funds, small)

1. Create an account on the phone and save the recovery phrase.
2. Send the Oink wallet ~0.02 SOL for Bell fees (or use "Top up from Seeker wallet").
3. Income → set a plan (e.g. reserve 0, 100% SPYx) → create a $10 payment link → pay it from
   another wallet → Allocate.
4. Bell → check quote → review → sign → wait for **confirmed** → open the Solscan link.
   Record that link in `docs/submission/06-EVIDENCE.md`. That is the only evidence of a
   live fill; nothing in this repository claims one before it exists.

## Rollback and rotation

- Render and Vercel both keep previous deploys; roll back from their dashboards.
- Rotating `OINK_SESSION_SECRET` signs everyone out; rotating `OINK_PROXY_SECRET` requires
  updating both services together; **never rotate `OINK_KMS_KEY`** without a re-encryption
  migration (none exists).
- Rotate `FEE_PAYER_SECRET_KEY` freely: generate a new keypair, fund it, swap the env var.
