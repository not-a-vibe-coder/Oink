# OINK — Architecture

## 1. Repository shape

Single repository, two deployables. Mirrors TENDER's layout so the port is mechanical.

```
oink/
├── AGENTS.md                  # working agreement for the rewriting AI
├── docs/                      # these documents
├── backend/                   # Bun + Express + Postgres API
│   ├── db/migrations/         # 001_..., numbered SQL, forward-only
│   ├── src/
│   │   ├── config.ts          # env → typed config
│   │   ├── db/                # pg pool + migration runner
│   │   ├── lib/
│   │   │   ├── tokens.ts      # xStocks + base currency registry (ported)
│   │   │   ├── crypto.ts      # server-side AES-GCM envelope for TOTP secrets
│   │   │   └── totp.ts        # RFC 6238 verify
│   │   ├── middleware/
│   │   │   ├── session.ts     # opaque session cookie → wallet
│   │   │   └── rateLimit.ts   # per-tag and per-IP throttles
│   │   ├── routes/
│   │   │   ├── health.ts
│   │   │   ├── enroll.ts      # wallet creation
│   │   │   ├── auth.ts        # unlock / recover / session
│   │   │   ├── tags.ts        # availability, lookup, directory
│   │   │   ├── wallet.ts      # balances, portfolio value
│   │   │   ├── elections.ts   # portfolio allocation
│   │   │   ├── assets.ts      # token registry + prices
│   │   │   ├── transfer.ts    # quote, build-tx, submit, confirm
│   │   │   ├── invoices.ts    # pay links + Solana Pay
│   │   │   └── activity.ts    # history
│   │   ├── services/
│   │   │   ├── jupiterService.ts   # ported
│   │   │   ├── electionEngine.ts   # ported from dualQuoteEngine
│   │   │   ├── txBuilder.ts        # ported
│   │   │   ├── feePayer.ts         # NEW: sponsored co-signing
│   │   │   └── rpc.ts              # Solana connection + submit/confirm
│   │   ├── app.ts
│   │   └── index.ts
│   └── tests/
└── src/                       # TanStack Start frontend
    ├── routes/                # file-based routing
    ├── components/
    ├── lib/
    │   ├── crypto/            # NEW: Argon2id, HKDF, AES-GCM, BIP39, keystore
    │   ├── wallet/            # NEW: in-memory key session, auto-lock, signing
    │   ├── oink-server-fns.ts # server functions wrapping the API (ported pattern)
    │   └── ...
    ├── server/oink-api.ts     # server-only fetch to the API host (ported pattern)
    └── styles.css             # design tokens
```

---

## 2. Runtime topology

```
Browser (the only place a private key is ever plaintext)
  │
  │  same-origin RPC (TanStack Start server functions)
  ▼
Frontend SSR runtime  ──server-side fetch──►  Oink API (Bun + Express)
                                                  │
                                                  ├─► PostgreSQL  (ciphertext, tags, elections, receipts)
                                                  ├─► Solana RPC  (balances, submit, confirm)
                                                  └─► Jupiter API (quotes, swap instructions)
```

**Why server functions instead of direct browser→API calls:** carried over from TENDER
(`src/lib/tender-server-fns.ts` + `src/server/tender-api.ts`). It removes CORS entirely and
keeps the API host out of the client bundle. Keep this pattern.

**The one exception:** cryptographic operations (Argon2id, AES-GCM, BIP39, signing) run in
the browser only, in `src/lib/crypto/**`. They never touch a server function.

---

## 3. Trust boundaries

| Component | Sees | Never sees |
| :--- | :--- | :--- |
| Browser | password, `encKey`, `authKey`, mnemonic, private key | — |
| SSR runtime | `authKey` (in transit, to relay), ciphertext | password, `encKey`, private key |
| API server | `authKey` (hashes it, discards), ciphertext, TOTP secret (encrypted at rest) | password, `encKey`, private key, mnemonic |
| Database | `argon2(authKey)`, ciphertext + nonce, KDF params, encrypted TOTP secret | password, `encKey`, `authKey`, private key, mnemonic |

An attacker with **full database read** can attempt an offline password brute-force against
the ciphertext. Argon2id with the parameters in `02-WALLET-AND-AUTH-SPEC.md` is what makes
that expensive. This is the same posture as Bitwarden/1Password and is acceptable — but it
is exactly why the parameters are not negotiable downward.

---

## 4. Core flows

### 4.1 Create wallet

```
1. POST /api/v1/enroll/start                → { enrollmentId, totpSecret, otpauthUri, expiresAt }
2. Browser: generate BIP39 mnemonic (128-bit) → seed → m/44'/501'/0'/0' → Ed25519 keypair
3. Browser: user sets password
   salt = random(16)
   master = Argon2id(password, salt, m=64MiB, t=3, p=1) → 32B
   encKey  = HKDF-SHA256(master, info="oink-enc-v1")  → 32B   [stays in browser]
   authKey = HKDF-SHA256(master, info="oink-auth-v1") → 32B   [sent to server]
   ciphertext = AES-256-GCM(encKey, nonce, mnemonicEntropy, aad)
4. Browser: user scans otpauthUri, enters a code
5. Browser: user picks a tag; live availability check
6. POST /api/v1/enroll/complete { enrollmentId, tag, publicKey, ciphertext, nonce,
                                  kdfSalt, kdfParams, authKey, totpCode }
   → server verifies TOTP, atomically claims tag, stores argon2(authKey) + ciphertext
7. Browser: show mnemonic once, force a 3-word confirmation quiz, then wipe it from memory
8. Session cookie issued. Wallet is live.
```

### 4.2 Unlock / recover on a new device

```
1. POST /api/v1/auth/challenge { tag }  → { kdfSalt, kdfParams, nonce, ciphertext, challengeId }
   (rate-limited; response is identical in shape for unknown tags to avoid enumeration —
    see 02-WALLET-AND-AUTH-SPEC.md §7)
2. Browser: derive master → encKey, authKey from the entered password
3. POST /api/v1/auth/unlock { challengeId, authKey, totpCode }
   → server verifies argon2(authKey) and the TOTP step, issues a session
4. Browser: AES-GCM-decrypt the ciphertext with encKey → mnemonic entropy → keypair
   If decryption fails the password was wrong (the server check should already have caught it)
5. Keypair lives in a module-scope variable. Auto-lock after 15 minutes idle.
```

### 4.3 Receive by tag (the election settlement)

```
Sender (Oink or external)  sends SOL / USDC / any SPL
        │
        ▼
  resolve @tag → recipient pubkey + active election (bps, sums to 10000)
        │
        ▼
  electionEngine: one Jupiter quote per leg, slippage-capped
        │
        ▼
  txBuilder: one VersionedTransaction, ATAs created idempotently,
             per-leg swap instructions, destination = recipient ATAs
        │
        ▼
  sender signs in-browser (or scans a Solana Pay QR from an external wallet)
        │
        ▼
  POST /api/v1/transfer/submit → RPC → confirm → write receipt
```

Legs that breach the slippage cap safe-settle into USDC rather than failing the whole
transaction. This behaviour is ported from TENDER and must be preserved.

### 4.4 Send

Identical machinery in reverse. The sender's holdings may be tokenized equities, so a send
of "50 USDC to @ada" from a wallet holding `NVDAx` is: quote `NVDAx → USDC`, then apply
`@ada`'s election to the USDC output. Both halves are in the same transaction where the
instruction budget allows; otherwise the UI shows a two-step plan.

---

## 5. What is deliberately absent

- No wagmi, viem, wallet-standard, or any EVM dependency
- No rail abstraction (`src/lib/rail.ts`, `rail-normalize.ts`, `RailSwitcher`)
- No `/api/v2`
- No mandatory X OAuth
- No server-side private keys except the **fee payer** (a dedicated, low-balance, rotatable
  keypair that can only pay fees, never move user funds)
