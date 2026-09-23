# OINK — Environment, Secrets & Deployment

New GitHub repository, new database, new hosting. **Nothing is shared with TENDER** —
not the repo, not the database, not the API keys, not the fee wallet.

---

## 1. Frontend `.env`

```bash
# Server-side only. The API is called from server functions, never the browser.
OINK_API_URL=https://api.<domain>
OINK_API_FALLBACK_URL=https://<service>.onrender.com

# Public (bundled). Keep this list minimal — anything here is visible to users.
VITE_APP_URL=https://<domain>
VITE_SOLANA_NETWORK=devnet          # devnet while building; mainnet-beta for the demo
VITE_SOLANA_EXPLORER=https://solscan.io
VITE_PRIVY_APP_ID=                  # public; without it linking and /admin sign-in show as off

# Server-side. Same value as the backend's: lets the API trust the browser IP this proxy
# forwards. Without it every user shares Vercel's IP for rate limits and lockouts.
OINK_PROXY_SECRET=
```

Deliberately **not** in the frontend env: the RPC URL (reads go through the API so the RPC
key is not public), any secret, any key.

---

## 2. Backend `.env`

```bash
NODE_ENV=production
PORT=3001
APP_URL=https://<domain>                 # CORS allowlist + invoice links
DATABASE_URL=postgresql://...

# Solana
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://...               # a paid RPC; the public endpoint will rate-limit you
SOLANA_RPC_FALLBACK_URL=https://api.devnet.solana.com

# Jupiter
JUPITER_API_URL=https://api.jup.ag/swap/v1
JUPITER_PRICE_API_URL=https://api.jup.ag/price/v3
JUPITER_API_KEY=

# --- SECRETS. 32 random bytes, base64. Rotating these has consequences. ---
OINK_KMS_KEY=          # seals TOTP secrets at rest. LOSING THIS LOCKS EVERY USER OUT OF 2FA
OINK_DECOY_KEY=        # HMAC seed for deterministic decoy challenges
OINK_SESSION_SECRET=   # session token hashing pepper
OINK_ARGON_PEPPER=     # server-side pepper for auth_key_hash

# Fee sponsorship. A hot, low-balance, rotatable keypair.
FEE_PAYER_SECRET_KEY=            # base58 secret key
FEE_SPONSOR_ENABLED=true
FEE_SPONSOR_MAX_TX_PER_DAY=20
FEE_SPONSOR_MAX_LAMPORTS_PER_DAY=50000000     # 0.05 SOL per tag
FEE_SPONSOR_GLOBAL_LAMPORTS_PER_DAY=2000000000

# Protocol fee. Zero for the hackathon; the code path stays.
OINK_FEE_BPS=0
OINK_FEE_WALLET=

# Settlement defaults
DEFAULT_SLIPPAGE_BPS=100
SAFE_SETTLE_PRICE_IMPACT_PCT=3

# Must equal the frontend's OINK_PROXY_SECRET (see §1).
OINK_PROXY_SECRET=

# Privy proves email and X ownership for linking and admin sign-in (docs/12). Optional:
# without these, those endpoints answer 503 NOT_CONFIGURED and everything else works.
PRIVY_APP_ID=
PRIVY_VERIFICATION_KEY=   # ES256 public key (PEM) from the Privy dashboard; "
" escapes are fine
ADMIN_EMAILS=             # comma-separated; the only addresses that can sign in to /admin

# Held payments: paying an email or X account that has no Oink wallet (docs/12 §5, §6).
# Without the four Privy values those sends answer NOT_CONFIGURED; everything else works.
PRIVY_APP_SECRET=         # Privy dashboard > App settings > API keys. Secret
PRIVY_AUTHORIZATION_KEY=  # Keys & quorums > new key: the private key, shown once. The refund signer. Secret
PRIVY_SIGNER_ID=          # the same key's ID; it is added as the holding wallets' only additional signer
RESEND_API_KEY=           # payment emails; a sending-only key is enough. Secret
EMAIL_FROM=Oink <onboarding@resend.dev>   # needs a domain verified in Resend to reach anyone but you
X_BEARER_TOKEN=           # optional: without it, paying an X account not on Oink is refused
HELD_PAYMENT_HOURS=48

# Phase 2 only
X_BOT_ENABLED=false
X_CLIENT_ID=
X_CLIENT_SECRET=
X_OAUTH_REDIRECT_URI=https://api.<domain>/api/v1/x/link/callback
GROQ_API_KEY=
```

Generate a secret: `openssl rand -base64 32`

### Boot assertions

The server **refuses to start** in production when any of `DATABASE_URL`, `OINK_KMS_KEY`,
`OINK_DECOY_KEY`, `OINK_SESSION_SECRET`, `OINK_ARGON_PEPPER` is missing or shorter than 32
bytes decoded. Fail loudly at boot, never silently fall back to a default. TENDER's
`config.ts` uses `|| ""` defaults throughout — **do not copy that pattern for secrets.**

---

## 3. Key custody and rotation

| Secret | If lost | If leaked | Rotation |
| :--- | :--- | :--- | :--- |
| `OINK_KMS_KEY` | Every user's TOTP becomes undecryptable; users get back in only by restoring from their 12-word phrase | An attacker with DB read can compute TOTP codes — but still needs the password | Re-encrypt every `totp_secret_enc` under a new key in one migration job. Support two keys during the window |
| `OINK_DECOY_KEY` | Decoys change; harmless | Tag enumeration becomes possible again | Rotate freely |
| `OINK_SESSION_SECRET` | All sessions invalid; users re-unlock | Session forgery | Rotate on suspicion; it just logs everyone out |
| `OINK_ARGON_PEPPER` | **No one can unlock.** This one is fatal | Offline attack on `authKey` hashes | Rotate only with a re-hash-on-next-unlock scheme |
| `FEE_PAYER_SECRET_KEY` | Sponsorship stops; users fund their own SOL | Attacker drains the float only — never user funds | Rotate immediately, move the float, update env |

Back these up outside the hosting provider. **A lost `OINK_ARGON_PEPPER` or `OINK_KMS_KEY`
is an outage that no amount of code fixes.**

---

## 4. Hosting

Mirroring TENDER's working setup, which is proven:

| Piece | Service | Notes |
| :--- | :--- | :--- |
| Frontend | Vercel or Cloudflare | TanStack Start SSR. Set `OINK_API_URL` as a server-side env var |
| Backend | Render, paid always-on instance | Cold starts break the unlock flow's rate limiting and feel broken to users |
| Database | Neon, Supabase or Render Postgres | Needs `pg_cron` or an external scheduler for the hygiene job |
| RPC | Helius or Triton | The public endpoint is not viable for balance polling |
| Secrets | The host's secret manager | Never in the repo, never in a `.env` that is committed |

### CORS

Replace TENDER's open `app.use(cors())` with:

```ts
app.use(cors({
  origin: [process.env.APP_URL, ...(dev ? ["http://localhost:3000"] : [])],
  credentials: true,
}));
```

`credentials: true` is required for the session cookie. An open CORS policy plus a
credentialed cookie is a real vulnerability, not a style preference.

### Headers

Set on every response: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera,
microphone and geolocation, plus the CSP from `02-WALLET-AND-AUTH-SPEC.md` §9.

---

## 5. New repository

```bash
cd C:\Users\USER\oink
git init
git add .
git commit -m "Initial commit: Oink wallet"
gh repo create <owner>/oink --private --source=. --push
```

Keep TENDER's `.gitignore` and add:

```
.env
.env.*
!.env.example
*.key
fee-payer*.json
```

**Never commit:** a keypair JSON, a `.env`, a database dump, or a seed phrase in a test
fixture. Add a pre-commit grep for `SECRET_KEY`, `PRIVATE_KEY`, and 64-character base58
strings.

CI (port `.github/workflows/backend.yml`): typecheck, lint, `bun test`, build. Add a job that
fails if `argon2id` parameters in the source differ from the documented values — cheap
insurance against someone lowering them to make tests faster.

---

## 6. Monitoring

- Uptime check on `GET /health` at one minute
- Alert when the fee payer balance drops below 0.2 SOL
- Alert on a spike in `login_attempts` failures (credential stuffing)
- Alert on any `500` from `/transfer/submit`
- Log, with no key material: tag, action, signature, duration, outcome

---

## 7. Demo preparation

1. Fund the fee payer with about 1 SOL on mainnet
2. Create two demo tags with different elections (one equities-heavy, one stable-heavy)
3. Pre-record the create-wallet flow — Argon2id takes about a second and live demos are unkind
4. Have a second device ready to show recovery with tag + password + TOTP. **This is the
   demo moment**: destroy the browser profile on stage and bring the wallet back with three
   pieces of information and no secret phrase typed
5. Keep a fallback devnet build one click away
