# OINK — Wallet, Authentication & Recovery Specification

> This is the most important document in the set. If any other doc contradicts it, this one
> wins. Implement it exactly; do not substitute algorithms or lower parameters.

---

## 1. Key material

The wallet is generated from a **BIP39 mnemonic**, not from a raw keypair. This gives two
independent recovery paths and makes the wallet importable into Phantom or Solflare.

| Item | Value |
| :--- | :--- |
| Mnemonic | BIP39, **128-bit entropy, 12 words**, English wordlist |
| Entropy source | `crypto.getRandomValues` (WebCrypto). Never `Math.random` |
| Seed | BIP39 seed, empty passphrase |
| Derivation path | `m/44'/501'/0'/0'` (ed25519, SLIP-0010) — the Phantom default |
| Keypair | Ed25519, via `@solana/web3.js` `Keypair.fromSeed(derived.key)` |
| Encrypted payload | The **16-byte entropy**, not the words and not the expanded seed |

Libraries: `@scure/bip39` (mnemonic), `ed25519-hd-key` for SLIP-0010 derivation,
`@solana/web3.js` for the keypair. Do not pull in the legacy `bip39` package.

---

## 2. Password key derivation

```
salt        = crypto.getRandomValues(16 bytes)          # per wallet, stored server-side
master      = Argon2id(password, salt, m, t, p) -> 32 bytes
encKey      = HKDF-SHA256(ikm=master, salt="", info="oink-enc-v1",  len=32)
authKey     = HKDF-SHA256(ikm=master, salt="", info="oink-auth-v1", len=32)
```

### Argon2id parameters (v1 — record these in the DB per wallet)

| Parameter | Value |
| :--- | :--- |
| `m` (memory) | **65536 KiB (64 MiB)** |
| `t` (iterations) | **3** |
| `p` (parallelism) | **1** |
| hash length | 32 bytes |
| version | 0x13 |

Store as `kdf_params = {"alg":"argon2id","v":19,"m":65536,"t":3,"p":1,"len":32}` so
parameters can be raised later without breaking existing wallets.

**Library:** `hash-wasm` (`argon2id`) — WASM, works in browser and Bun, no native build.
Run it in a **Web Worker** so the UI does not jank for the ~0.5-1s it takes.

**Password policy:** minimum 10 characters. Show a strength meter (`@zxcvbn-ts/core`).
Reject the top-1000 common passwords and any string containing the tag.

### Why the split

- `encKey` **never leaves the browser.** It is the only thing that can decrypt the wallet.
- `authKey` is sent to the server so the server can prove the caller knows the password —
  without gaining the ability to decrypt anything.

A server that logs `authKey` learns nothing directly usable; it would still have to run
Argon2id over a password guess space to find the password. Nevertheless: **never log
`authKey`.** It is redacted in the request logger (see §9).

---

## 3. Keystore encryption

```
nonce      = crypto.getRandomValues(12 bytes)
aad        = utf8("oink-keystore-v1|" + tag + "|" + publicKeyBase58)
ciphertext = AES-256-GCM.encrypt(key=encKey, iv=nonce, additionalData=aad,
                                 plaintext=mnemonicEntropy16)
```

- WebCrypto `SubtleCrypto` only. No hand-rolled crypto, no `crypto-js`.
- The AAD binds the ciphertext to the tag and public key, so a swapped-blob attack by a
  malicious server fails closed at decryption.
- Store `ciphertext` and `nonce` base64.

**Decryption failure means a wrong password.** Surface it as "Wrong password or code", never
as "wrong password" specifically (see §7).

---

## 4. TOTP

| Parameter | Value |
| :--- | :--- |
| Standard | RFC 6238 |
| Algorithm | HMAC-SHA1 |
| Digits | 6 |
| Period | 30 seconds |
| Accepted window | current step plus or minus 1 (90-second tolerance) |
| Secret | 20 random bytes, Base32 (RFC 4648, no padding) |
| Issuer label | `otpauth://totp/Oink:%40<tag>?secret=<b32>&issuer=Oink&algorithm=SHA1&digits=6&period=30` |

- The secret is **generated server-side** during `POST /api/v1/enroll/start` and held in a
  short-lived `enrollments` row (TTL 15 minutes).
- At rest the secret is encrypted with a **server master key** (`OINK_KMS_KEY`, 32 bytes
  base64 in env) using AES-256-GCM with a per-row nonce. Column: `totp_secret_enc`.
- **Replay protection is mandatory.** Store `totp_last_step` (integer). Reject any code
  whose step is at or below `totp_last_step`. Update on every successful verification.
- Present the secret as both a QR code (`qrcode` package, rendered client-side from the
  otpauth URI) and a copyable Base32 string for manual entry.
- Enrollment is not complete until the user submits one valid code. This proves the
  authenticator was actually saved.

**If the authenticator is lost**, there are no bypass codes and no support channel. The
**12-word secret phrase** is the only fallback: it restores the keypair directly and lets the
user re-enroll the same tag with a new password and a new authenticator (§6). This is
deliberate — one backup artifact that users already understand, rather than two.

---

## 5. Enrollment protocol

### Step 1 — `POST /api/v1/enroll/start`

Request: `{}` (optionally `{ "tagHint": "pascal" }` for analytics only)

Response:

```json
{
  "enrollmentId": "enr_01J...",
  "totpSecret": "JBSWY3DPEHPK3PXP",
  "otpauthUri": "otpauth://totp/Oink:%40pending?secret=...&issuer=Oink",
  "expiresAt": "2026-09-14T15:15:00Z"
}
```

The server writes an `enrollments` row with the encrypted secret and a 15-minute TTL.

### Step 2 — browser-side work (no network)

1. Generate mnemonic, then entropy, seed, keypair, `publicKey`
2. Collect password, derive `master` / `encKey` / `authKey` in a worker
3. Encrypt entropy into `ciphertext` and `nonce`
4. Collect a TOTP code from the user's authenticator
5. Claim a tag, live-checked with `GET /api/v1/tags/:tag/availability`

### Step 3 — `POST /api/v1/enroll/complete`

```json
{
  "enrollmentId": "enr_01J...",
  "tag": "pascal",
  "publicKey": "7xKX...",
  "keystore": {
    "ciphertext": "base64",
    "nonce": "base64",
    "kdfSalt": "base64",
    "kdfParams": { "alg": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1, "len": 32 },
    "cipher": "AES-256-GCM",
    "version": 1
  },
  "authKey": "base64",
  "totpCode": "123456"
}
```

Server, in **one transaction**:

1. Load the enrollment, assert not expired and not consumed
2. Decrypt `totp_secret_enc`, verify `totpCode`, assert the step is above `totp_last_step`
3. Validate `tag` against `^[a-z0-9_]{3,20}$` and the reserved list (§8)
4. `INSERT INTO wallets ...` — the tag primary key gives atomic first-come-first-served; a
   unique violation returns `409 TAG_TAKEN`
5. Hash `authKey`: `auth_key_hash = argon2id(authKey, serverSalt, m=19456, t=2, p=1)`.
   Light parameters are fine here: `authKey` is already a 256-bit high-entropy value.
6. Insert the default election — **100% USDC** — matching TENDER's default
7. Mark the enrollment consumed, issue a session, return the wallet

### Step 4 — secret phrase ceremony

This is the only backup the user gets, so the ceremony is not skippable and not a footnote.

Show the 12 words once, in a numbered grid. Require the user to re-enter **3 randomly chosen
words** before the screen can be dismissed. Copy and download are offered; "I'll do this
later" is not. Then zero the array in memory.

Never send the words anywhere, never put them in `localStorage`, never render them on a page
with a shareable URL, never include them in an analytics event or an error report.

The screen must say, in plain language, what the phrase is for:

> These 12 words are your wallet. Anyone who has them can take your money, and Oink cannot
> reset them. You need them if you ever lose your authenticator app.

---

## 6. Unlock protocol

### `POST /api/v1/auth/challenge`

Request: `{ "tag": "pascal" }`

Response (always 200, always the same shape — see §7):

```json
{
  "challengeId": "chl_01J...",
  "kdfSalt": "base64",
  "kdfParams": { "alg": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1, "len": 32 },
  "keystore": { "ciphertext": "base64", "nonce": "base64", "cipher": "AES-256-GCM", "version": 1 },
  "requiresTotp": true
}
```

For an unknown tag the server returns a **deterministic decoy** derived from
`HMAC(OINK_DECOY_KEY, tag)` so timing and shape leak nothing. The decoy is stable across
calls for the same tag. Decryption will fail client-side, which is the same observable
outcome as a wrong password.

`challengeId` has a 5-minute TTL and is single-use.

### `POST /api/v1/auth/unlock`

Request: `{ "challengeId": "chl_...", "authKey": "base64", "totpCode": "123456" }`

Server:

1. Consume the challenge (single use)
2. Verify `argon2id.verify(auth_key_hash, authKey)` — constant-time
3. Verify the TOTP step
4. On failure: record in `login_attempts`, apply backoff (§7), return
   `401 INVALID_CREDENTIALS` with no distinction between a wrong password and a wrong code
5. On success: reset the attempt counter, create a session, return
   `{ "tag": "...", "publicKey": "...", "sessionExpiresAt": "..." }`

The client then AES-GCM-decrypts locally.

### `POST /api/v1/auth/recover/*` — the secret phrase path

The path when the password **or** the authenticator is gone. It works entirely off the
12 words and needs neither the old password nor the old TOTP secret.

The phrase *is* the private key, so possession of it is already total authority over the
funds. The only thing the server adds is letting the user keep their **tag**, and it grants
that on proof of the keypair — an Ed25519 signature over a server nonce.

```
POST /api/v1/auth/recover/challenge   { "tag": "pascal" }
  -> { "challengeId": "rec_01J...",
       "message": "Oink account recovery\nTag: @pascal\nNonce: <base64>\nIssued: <iso8601>",
       "expiresAt": "..." }
```

Browser: the user types the 12 words, the client re-derives the keypair (`@scure/bip39` plus
SLIP-0010) and signs `message` with it.

```
POST /api/v1/auth/recover/complete
  {
    "challengeId": "rec_01J...",
    "signature": "base58",
    "publicKey": "7xKX...",
    "keystore": { "ciphertext", "nonce", "kdfSalt", "kdfParams", "cipher", "version" },
    "authKey": "base64",
    "totpEnrollmentId": "enr_01J...",
    "totpCode": "123456"
  }
```

Server, in one transaction:

1. Consume the challenge; assert it is not expired
2. Assert `publicKey` equals the `public_key` stored for that tag — **this is the whole
   authorisation check.** A non-matching key returns `401 INVALID_CREDENTIALS`
3. Verify the Ed25519 signature over the exact `message` with `tweetnacl`
   (`nacl.sign.detached.verify`). The helper already exists in TENDER's
   `backend/src/routes/auth.ts` as `verifySolanaSignature` — port it
4. Verify `totpCode` against the **new** enrollment's secret. The user enrolls a fresh
   authenticator during recovery through the ordinary `POST /api/v1/enroll/start`
5. Overwrite `ciphertext`, `nonce`, `kdf_salt`, `kdf_params`, `auth_key_hash`,
   `totp_secret_enc`, `totp_nonce`; reset `totp_last_step` to 0
6. **Revoke every existing session** for the tag
7. Issue a new session

The public key, the tag, the elections and the funds are all unchanged. Only the credentials
wrapped around them are replaced.

**Rate limit:** 5 recovery attempts per tag per hour, 10 per IP per hour. A failed signature
check counts against both and is recorded in `login_attempts` with `kind = 'recover'`.

**Import without a tag.** If the phrase belongs to a wallet Oink has never seen — someone
importing an existing Phantom wallet — there is no tag to reclaim. Offer ordinary enrollment
instead: the user claims a new tag and sets a password and authenticator around the imported
key. Same `enroll/complete` endpoint, with the client supplying the imported entropy rather
than generating fresh entropy.

### Sessions

- Opaque 32-byte random token, stored SHA-256-hashed in `sessions`
- Delivered as a cookie: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
- 7-day absolute expiry, 24-hour idle expiry
- The session authorizes **reading private data** (activity, invoices, saved contacts) and
  **writing elections**. It **never** authorizes moving funds — only a signature from the
  in-memory keypair does that.

### In-browser key session

- The keypair lives in a module-scope variable in `src/lib/wallet/key-session.ts`. Not in
  React state, not in a store that devtools serializes, not in `localStorage` or
  `sessionStorage`.
- **Auto-lock after 15 minutes of no user interaction**, and immediately on tab close.
- Optional "trust this device for 30 days": wrap `encKey` with a **non-extractable**
  AES-GCM `CryptoKey` generated by WebCrypto and persisted in IndexedDB. The raw key bytes
  are never readable by JS, so an XSS payload cannot exfiltrate it — it can only use it
  while the page is open. Default this **off**; make it an explicit toggle.

---

## 7. Abuse resistance

| Surface | Control |
| :--- | :--- |
| Tag enumeration | `challenge` returns a deterministic decoy for unknown tags; the availability endpoint is separately rate-limited and returns only a boolean |
| Password brute force | Per-tag: 5 failures then 1 min, 10 then 15 min, 20 then 24 h lockout. Per-IP: 30 unlock attempts per hour. Both recorded in `login_attempts` |
| TOTP brute force | Counted in the same budget; a 6-digit code with a 3-step window has 3-in-10^6 odds per attempt, which the lockout makes hopeless |
| TOTP replay | Monotonic `totp_last_step` check |
| Enrollment spam | Per-IP: 10 `enroll/start` per hour. Enrollments expire in 15 min |
| Error oracle | One error code for all credential failures: `INVALID_CREDENTIALS`. Never "no such tag", never "wrong code" |
| Timing | Always run the argon2 verify, even for a decoy challenge, against a dummy hash |

---

## 8. Tag rules

- Regex `^[a-z0-9_]{3,20}$`. Input is lowercased and a leading `@` or `$` is stripped.
- Stored lowercase; the primary key enforces uniqueness.
- **Immutable.** No rename in v1. A rename would break payment links and receipts.
- **Reserved list** (reject at claim): `admin, root, support, help, oink, oinkbot, official,
  team, system, api, www, mail, security, staff, mod, moderator, wallet, bank, treasury,
  fee, null, undefined, me, you, test`. Plus anything beginning with `oink`.
- Display as `@tag` everywhere. Accept `$tag` on paste.

---

## 9. Implementation guardrails

**Server**

- The request logger ported from TENDER (`backend/src/app.ts`) redacts `privateKey` and
  `secret`. **Extend the redaction list to:** `authKey`, `totpCode`, `ciphertext`,
  `kdfSalt`, `mnemonic`, `secretPhrase`, `password`, `totpSecret`, `otpauthUri` (it embeds
  the secret), `signature`.
- No endpoint ever returns a decrypted TOTP secret after enrollment.
- `OINK_KMS_KEY` is required at boot; refuse to start without it in production.
- Never write key material to an error message, a monitoring breadcrumb, or an audit row.

**Client**

- All crypto in `src/lib/crypto/**`. No crypto in components.
- Argon2id runs in a Web Worker; show real progress, not a fake spinner.
- Zero sensitive `Uint8Array` buffers with `.fill(0)` after use. This is best-effort — JS
  strings cannot be zeroed, which is why the password is handled as a `Uint8Array` wherever
  the API allows.
- A strict CSP is required, because XSS on this page means fund loss:
  `default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
  If a third-party analytics script cannot fit inside this, drop the analytics.
- No `dangerouslySetInnerHTML` anywhere in the app shell.

**Testing (required, not optional)**

- Round trip: enroll, encrypt, decrypt, same public key
- A wrong password fails decryption and returns `INVALID_CREDENTIALS`
- TOTP replay is rejected
- Secret-phrase recovery succeeds with a signature from the right key and fails with a
  signature from any other key
- Recovery revokes existing sessions and resets `totp_last_step`
- Tag claim race: two concurrent `enroll/complete` calls for the same tag produce exactly
  one `201`
- The decoy challenge for an unknown tag is stable and indistinguishable in shape
- Lockout thresholds fire at the documented counts
