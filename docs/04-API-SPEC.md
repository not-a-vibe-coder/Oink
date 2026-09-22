# OINK — API Specification

Base: `https://api.<domain>` · Prefix: `/api/v1` · JSON in, JSON out · Bun + Express.

There is **no `/api/v2`**. The rail split from TENDER is gone.

---

## 0. Conventions

**Errors** — every failure returns the same envelope:

```json
{ "error": "TAG_TAKEN", "message": "That tag is already claimed.", "details": null }
```

`error` is a stable machine code; `message` is user-safe prose; `details` is for developers
and is `null` in production for anything touching credentials.

| Code | HTTP | Meaning |
| :--- | :--- | :--- |
| `VALIDATION_FAILED` | 400 | Bad request shape |
| `INVALID_CREDENTIALS` | 401 | Wrong password, wrong code, unknown tag — deliberately indistinguishable |
| `SESSION_REQUIRED` | 401 | No valid session cookie |
| `FORBIDDEN` | 403 | Session is for a different tag |
| `NOT_FOUND` | 404 | Resource does not exist (never used for tags during auth) |
| `TAG_TAKEN` | 409 | Tag claimed between check and commit |
| `RATE_LIMITED` | 429 | Includes `Retry-After` |
| `ELECTION_INVALID` | 400 | Basis points do not sum to 10000 |
| `QUOTE_FAILED` | 502 | Jupiter returned no viable route |
| `INSUFFICIENT_FUNDS` | 400 | Balance or rent-exemption shortfall |
| `SPONSORSHIP_EXHAUSTED` | 429 | Daily fee-payer budget used up |
| `INTERNAL` | 500 | Anything else |

**Auth** — `HttpOnly` session cookie (`oink_session`). Endpoints marked **[S]** require it.
The session never authorises moving funds; a transaction only moves when the browser signs.

**Rate limits** — per-IP and per-tag, documented per endpoint. `429` carries `Retry-After`.

---

## 1. Health

### `GET /health`
```json
{ "status": "ok", "version": "1.0.0", "network": "mainnet-beta", "timestamp": "..." }
```

---

## 2. Enrollment

### `POST /api/v1/enroll/start`
Rate limit: 10/hour/IP.

Request `{}` · Response `201`:
```json
{
  "enrollmentId": "enr_01JAX...",
  "totpSecret": "JBSWY3DPEHPK3PXP",
  "otpauthUri": "otpauth://totp/Oink:%40pending?secret=JBSWY3DPEHPK3PXP&issuer=Oink&algorithm=SHA1&digits=6&period=30",
  "expiresAt": "2026-09-14T15:15:00Z"
}
```

### `POST /api/v1/enroll/verify-totp`
Optional pre-flight so the wizard can confirm the authenticator before the user commits a
tag. Does **not** consume the enrollment.

Request `{ "enrollmentId": "...", "totpCode": "123456" }` · Response `{ "valid": true }`

### `POST /api/v1/enroll/complete`
Body as specified in `02-WALLET-AND-AUTH-SPEC.md` §5.3.

Response `201`, and sets the session cookie:
```json
{
  "tag": "pascal",
  "publicKey": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "elections": [{ "symbol": "USDC", "mint": "EPjFW...", "basisPoints": 10000, "percentage": 100 }],
  "sessionExpiresAt": "2026-09-21T15:00:00Z",
  "createdAt": "2026-09-14T15:02:11Z"
}
```

Failure modes: `409 TAG_TAKEN`, `401 INVALID_CREDENTIALS` (bad TOTP), `400 VALIDATION_FAILED`
(bad tag, reserved tag, malformed keystore), `410` on an expired or consumed enrollment.

---

## 3. Authentication

### `POST /api/v1/auth/challenge`
Rate limit: 20/hour/IP. Always `200`, even for an unknown tag (deterministic decoy).

Request `{ "tag": "pascal" }` · Response: see `02-WALLET-AND-AUTH-SPEC.md` §6.

### `POST /api/v1/auth/unlock`
Rate limit: per-tag backoff ladder plus 30/hour/IP.

Request:
```json
{ "challengeId": "chl_01J...", "authKey": "base64", "totpCode": "123456" }
```

Response `200` + session cookie:
```json
{ "tag": "pascal", "publicKey": "7xKX...", "sessionExpiresAt": "..." }
```

### `POST /api/v1/auth/recover/challenge`
Rate limit: 5/hour/tag, 10/hour/IP. Returns the message the client must sign with the keypair
restored from the 12-word secret phrase.

Request `{ "tag": "pascal" }` · Response:
```json
{
  "challengeId": "rec_01J...",
  "message": "Oink account recovery\nTag: @pascal\nNonce: <base64>\nIssued: 2026-09-14T15:00:00Z",
  "expiresAt": "2026-09-14T15:05:00Z"
}
```

### `POST /api/v1/auth/recover/complete`
Replaces the password and authenticator on proof of the keypair. Full rules in
`02-WALLET-AND-AUTH-SPEC.md` §6.

```json
{
  "challengeId": "rec_01J...",
  "signature": "base58",
  "publicKey": "7xKX...",
  "keystore": { "ciphertext": "...", "nonce": "...", "kdfSalt": "...", "kdfParams": {}, "cipher": "AES-256-GCM", "version": 1 },
  "authKey": "base64",
  "totpEnrollmentId": "enr_01J...",
  "totpCode": "123456"
}
```
Response `200` + a new session cookie. **Every previous session is revoked.** The public key,
the tag, the elections and the funds are unchanged.

Failure: `401 INVALID_CREDENTIALS` when the public key does not match the tag or the
signature does not verify — the two are indistinguishable to the caller.

### `POST /api/v1/auth/logout` **[S]**
Revokes the session. `204`.

### `GET /api/v1/auth/session` **[S]**
```json
{ "tag": "pascal", "publicKey": "7xKX...", "expiresAt": "...", "createdAt": "..." }
```

### `GET /api/v1/auth/sessions` **[S]**
Lists the wallet's active sessions (user agent, IP hash prefix, last used) so a user can see
and kill other devices.

### `DELETE /api/v1/auth/sessions/:tokenHashPrefix` **[S]**
Revokes one. `204`.

### `POST /api/v1/auth/rotate-keystore` **[S]**
Password change. The browser re-derives with a **new salt**, re-encrypts the same mnemonic
entropy, and submits the new blob together with the old `authKey` and a fresh TOTP code. The
public key does not change; funds never move.

```json
{
  "oldAuthKey": "base64",
  "totpCode": "123456",
  "keystore": { "ciphertext": "...", "nonce": "...", "kdfSalt": "...", "kdfParams": {}, "cipher": "AES-256-GCM", "version": 1 },
  "newAuthKey": "base64"
}
```
Response `200 { "rotatedAt": "..." }`. All other sessions are revoked.

### `POST /api/v1/auth/rotate-totp` **[S]**
Two-step: `start` returns a new secret and otpauth URI; `confirm` requires a code from the
new authenticator **and** the current `authKey`. Resets `totp_last_step` to 0.

### `POST /api/v1/auth/reveal-keystore` **[S]**
Returns the wallet's `keystore` blob so the settings screen can decrypt it locally and show
the 12 words. Requires `authKey` and a fresh TOTP code in the body. The server returns
ciphertext only — it still cannot read the phrase.

---

## 4. Tags

### `GET /api/v1/tags/:tag/availability`
Rate limit: 60/minute/IP.
```json
{ "tag": "pascal", "available": false, "reason": "taken" }
```
`reason` is one of `taken`, `reserved`, `invalid`, or `null` when available. No other data.

### `GET /api/v1/tags/:tag`
Public profile used to address a payment. Deliberately minimal.
```json
{
  "tag": "pascal",
  "publicKey": "7xKX...",
  "displayName": "Pascal",
  "avatarSeed": "a7f3",
  "acceptsElection": true,
  "election": [
    { "symbol": "SPYx", "mint": "Xso...", "basisPoints": 6000, "percentage": 60 },
    { "symbol": "USDC", "mint": "EPjF...", "basisPoints": 4000, "percentage": 40 }
  ],
  "createdAt": "..."
}
```
Balances are **never** exposed here.

### `GET /api/v1/tags/resolve?q=pas` **[S]**
Typeahead for the send screen. Max 8 results, prefix match only, `{ tag, displayName, avatarSeed }`.

---

## 5. Wallet

### `GET /api/v1/wallet` **[S]**
```json
{
  "tag": "pascal",
  "publicKey": "7xKX...",
  "solBalance": "0.0241",
  "totalValueUsd": "1240.55",
  "holdings": [
    {
      "symbol": "SPYx", "name": "S&P 500 xStock", "mint": "Xso...",
      "decimals": 8, "amount": "1.2400000", "valueUsd": "744.12",
      "priceUsd": "600.09", "iconUrl": "https://...", "underlyingTicker": "SPY"
    }
  ],
  "needsSol": false
}
```
`needsSol` is true when the SOL balance cannot cover a typical transaction; the UI uses it to
surface fee sponsorship.

### `GET /api/v1/wallet/address` **[S]**
```json
{
  "publicKey": "7xKX...",
  "solanaPayUri": "solana:7xKX...",
  "explorerUrl": "https://solscan.io/account/7xKX..."
}
```
The QR is rendered client-side from `solanaPayUri`.

---

## 6. Assets

Ported near-verbatim from TENDER's `backend/src/routes/assets.ts` and `lib/rwaTokens.ts`.

### `GET /api/v1/assets?featured=true`
```json
{
  "baseCurrencies": [ { "symbol": "SOL", "...": "..." }, { "symbol": "USDC", "...": "..." } ],
  "featured": [ { "symbol": "SPYx", "...": "..." } ],
  "count": 24
}
```

### `GET /api/v1/assets?search=nvda&limit=20&offset=0`
Returns `{ assets, total, limit, offset }` over the full xStocks registry.

### `GET /api/v1/assets/:symbolOrMint`
One `SolanaTokenInfo` plus a live USD price from the Jupiter price API.

### `GET /api/v1/assets/prices?mints=a,b,c`
Batch price lookup, 60-second server-side cache.

---

## 7. Elections

### `GET /api/v1/elections/:tag`
Public; the same array embedded in `GET /api/v1/tags/:tag`.

### `PUT /api/v1/elections` **[S]**
```json
{
  "elections": [
    { "symbol": "SPYx", "mint": "Xso...", "basisPoints": 6000 },
    { "symbol": "USDC", "mint": "EPjF...", "basisPoints": 4000 }
  ]
}
```
Rules: 1 to 10 rows, each `basisPoints` in `1..10000`, sum exactly `10000`, no duplicate
mints, every mint resolvable in the registry. Otherwise `400 ELECTION_INVALID` naming the sum.

Response: the stored set plus `revisionId`. Writes an `election_revisions` row.

---

## 8. Transfers

The three-call dance is carried over from TENDER: **quote, build, submit.** The browser signs
between build and submit.

### `POST /api/v1/transfer/quote` **[S]**
```json
{
  "recipient": "@ada",
  "fromSymbolOrMint": "USDC",
  "amountIn": "25.00",
  "applyElection": true,
  "slippageBps": 100
}
```
`recipient` accepts `@tag`, `$tag`, a bare tag, or a raw base58 address. When it is a raw
address, `applyElection` is forced to `false` — an external wallet has no election.

Response:
```json
{
  "recipient": { "kind": "tag", "tag": "ada", "wallet": "9Qv...", "displayName": "Ada" },
  "inputToken": { "symbol": "USDC", "mint": "EPjF...", "decimals": 6 },
  "totalIn": "25.00",
  "legs": [
    {
      "symbol": "NVDAx", "mint": "Xsc...", "basisPoints": 7000,
      "inAmount": "17.50", "outAmount": "0.0982", "outAmountFormatted": "0.0982 NVDAx",
      "priceImpactPct": 0.04, "route": "jupiter", "safeSettled": false
    },
    {
      "symbol": "USDC", "mint": "EPjF...", "basisPoints": 3000,
      "inAmount": "7.50", "outAmount": "7.50", "outAmountFormatted": "7.50 USDC",
      "priceImpactPct": 0, "route": "direct", "safeSettled": false
    }
  ],
  "networkFeeLamports": 15000,
  "sponsorship": { "available": true, "remainingToday": 18 },
  "quoteId": "qte_01J...",
  "expiresAt": "2026-09-14T15:05:30Z"
}
```

A leg whose price impact exceeds the cap is returned with `safeSettled: true` and rewritten
to USDC. This behaviour is ported from TENDER and must be preserved and surfaced in the UI.

Quotes expire in **30 seconds**; the client re-quotes automatically.

### `POST /api/v1/transfer/build` **[S]**
```json
{ "quoteId": "qte_01J...", "sponsorFee": true }
```
Response:
```json
{
  "transaction": "base64-serialized-VersionedTransaction",
  "feePayer": "FeE...",
  "partiallySigned": true,
  "lastValidBlockHeight": 301882771,
  "addressLookupTableAddresses": ["..."]
}
```
When `sponsorFee` is true the server sets the fee payer to the sponsor keypair and
**partially signs**. The client adds its own signature; it never replaces the sponsor's.

### `POST /api/v1/transfer/submit` **[S]**
```json
{ "quoteId": "qte_01J...", "signedTransaction": "base64" }
```
The server re-validates that the signed transaction matches the quote it built (same message
hash), broadcasts it, waits for confirmation, writes the `transfers` row, and returns:
```json
{ "signature": "5Pz...", "status": "confirmed", "explorerUrl": "https://solscan.io/tx/5Pz...", "transferId": 8812 }
```

**Server-side re-validation is mandatory.** Never broadcast a client-supplied transaction
whose message differs from the one the server built.

### `GET /api/v1/transfer/history?limit=20&offset=0&direction=` **[S]**
Paged `transfers` for the session's tag, with resolved counterparty tags and token metadata.

### `GET /api/v1/transfer/:signature` **[S]**
One receipt.

---

## 9. Invoices and payment requests

### `POST /api/v1/invoices` **[S]**
```json
{ "amount": "40.00", "tokenSymbol": "USDC", "memo": "Design work", "applyElection": true, "expiresInHours": 72 }
```
Response `{ "id": "inv_8fK2mQ", "payUrl": "https://<domain>/pay/inv_8fK2mQ", "solanaPayUri": "solana:...", "expiresAt": "..." }`

### `GET /api/v1/invoices/:id`
Public — the `/pay/:id` page reads it without a session.
```json
{
  "id": "inv_8fK2mQ", "creatorTag": "pascal", "recipientWallet": "7xKX...",
  "amount": "40.00", "tokenSymbol": "USDC", "memo": "Design work",
  "applyElection": true,
  "election": [{ "symbol": "SPYx", "basisPoints": 6000, "percentage": 60 }],
  "status": "pending", "expiresAt": "...", "createdAt": "..."
}
```

### `GET /api/v1/invoices` **[S]** — the creator's list
### `POST /api/v1/invoices/:id/cancel` **[S]**
### `POST /api/v1/invoices/:id/confirm` — records a payment signature against the invoice

### `POST /api/v1/requests` **[S]** — ask another tag for money
### `GET /api/v1/requests?box=in|out` **[S]**
### `POST /api/v1/requests/:id/decline` **[S]**

---

## 10. Contacts

`GET /api/v1/contacts` **[S]** · `POST /api/v1/contacts { tag, nickname }` **[S]** ·
`DELETE /api/v1/contacts/:tag` **[S]**

---

## 11. Phase 2 — bot endpoints

Do not implement before the core ships. Full design in `07-OINKBOT-X.md`.

- `GET  /api/v1/x/link/start` **[S]** — OAuth2 PKCE redirect
- `GET  /api/v1/x/link/callback`
- `DELETE /api/v1/x/link` **[S]**
- `GET  /api/v1/intents?status=pending` **[S]**
- `POST /api/v1/intents/:id/dismiss` **[S]**
- `POST /api/v1/bot/webhook` — internal, signed
