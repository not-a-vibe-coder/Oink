# OINK — Account IDs, Linked Identities, Held Payments & Admin

> Extends `02-WALLET-AND-AUTH-SPEC.md`. Where the two disagree on the account identifier,
> the keystore AAD or tag claiming, this document wins; everything else in 02 stands.
> Decided with the project owner on 2026-09-23.

---

## 1. What changes, in one paragraph

A wallet is created **without a tag**. It gets a permanent, server-issued **account ID**
(`oink-k7p2-9xqm`) that identifies it for unlock and recovery. A tag is claimed later, and
only by **linking an X account through Privy** — the tag is the X username. An email can be
linked too. A linked email or X username becomes a way to be paid; paying one that has no
Oink wallet yet puts the money in a **held payment** that the recipient claims within 2 days
or that is refunded to the sender. "Elections" are renamed **mixes**. An `/admin` dashboard
shows transactions, activity and a redacted, read-only view of the database.

---

## 2. Account ID

| Item | Value |
| :--- | :--- |
| Format | `oink-` + 4 chars + `-` + 4 chars, lowercase Crockford base32 without `i l o u` |
| Regex | `^oink-[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}$` |
| Entropy | 40 bits, from `crypto.randomBytes`. Collisions are rejected by the primary key and retried |
| Issued | By `POST /enroll/start`, held on the `enrollments` row, written to `wallets` at `complete` |
| Mutable | Never. It is the primary key every other table references |

The account ID can never be a tag: tags cannot contain `-`, and anything starting with
`oink` is reserved. So one input box accepts either, and the server tells them apart by regex.

**Crypto change to 02 §3.** The AAD binds the account ID instead of the tag, because the
account ID exists before encryption and never changes, while a tag may arrive later:

```
aad = utf8("oink-keystore-v1|" + accountId + "|" + publicKeyBase58)
```

**Wallets that predate account IDs** (two existed on mainnet when this shipped) keep their
tag, receive a backfilled account ID in migration 005, and keep a keystore sealed against
`"oink-keystore-v1|" + tag + "|" + publicKey`. The client tries the account-ID AAD first and
falls back to the tag AAD only when the account has a tag; both bind the public key. A
password change or recovery re-seals under the account ID, which retires the fallback for
that wallet.

The TOTP label becomes `Oink:<accountId>`. Recovery signs
`"Oink account recovery\nAccount: <accountId>\nNonce: ...\nIssued: ..."`.
The password may not contain the account ID's random part.

**Unlock and recover** take `{ "identifier": "<tag or account id>" }`. The challenge
response adds `accountId`, which the client needs for the AAD. The decoy for an unknown
identifier derives a stable fake account ID from `HMAC(OINK_DECOY_KEY, identifier)`, so the
response shape still leaks nothing.

---

## 3. Tags come from X

- After creating a wallet, a skippable prompt offers **"Link X to claim your tag"**. The
  same action lives in Settings.
- Linking runs Privy's X OAuth in the browser. The backend verifies Privy's identity token,
  reads the X username and X user ID from it, and sets `wallets.tag = lower(username)`.
- The tag keeps the 02 §8 regex and reserved list. X handles shorter than 3 characters, or
  reserved ones, link fine but get no tag — the user is told why.
- Tags are **bound to the X user ID**. Unlinking or renaming on X keeps the tag. If a
  *different* X account later proves ownership of that handle, the tag moves to it and the
  old holder is left with their account ID. Payment links to the old tag stop resolving to
  them; receipts keep the account ID.
- X remains **optional for everything except the tag**: create, receive by address, send,
  mix, unlock and recover all work without it.

---

## 4. Linked email

Linked in Settings through Privy's email one-time code. The backend verifies the identity
token and stores the address lowercased. One email belongs to at most one wallet.

---

## 5. Paying an email or X username

The send screen accepts `@tag`, an account ID, an address, an email, or an X account written
`x:@izuu`, `x.com/izuu` or `twitter.com/izuu` (a bare `@izuu` is an Oink tag). Held payments
are SPL tokens only: the holding wallet's policy permits nothing but `TransferChecked`.

**As built.** One Privy wallet per recipient identity pools every payment to them; the
`held_payments` table, not the balance, says what belongs to whom. The policy is a plain `in`
list on `TransferChecked.destination` plus `instructionName = TransferChecked` (the Node SDK
does not wrap condition sets), updated through the policy's owner — our key. Each release is
one instruction; the destination token account is created first in a fee-payer-only
transaction. A release is recorded (signature, blockhash expiry) before broadcast; a crashed or
unseen release is resolved by asking the chain, never by resending. A worker runs every
minute: settle in-flight releases, deliver claims, refund what expired. Five failed attempts
park a payment as `failed` for an admin retry.

**Recipient has an Oink wallet with that identity linked** → an ordinary transfer to their
wallet, settled into their mix. Nothing is held.

**Recipient is not on Oink** → a **held payment**:

1. The backend asks Privy to pregenerate a user for that email (or X account) with one Solana
   wallet, if it does not already exist. The wallet carries Oink's **refund signer**
   (an additional signer) under a policy (§6).
2. The sender's browser signs an ordinary USDC transfer into that wallet. The fee payer pays
   the fee and the token-account rent, as for any sponsored transfer.
3. A `held_payments` row records sender, recipient identity, holding wallet, mint, amount,
   signature, and `expires_at = created_at + 48 hours`.
4. **Email:** Resend sends "@pascal sent you 10 USDC on Oink". If the sender has no tag it
   says "An Oink user (7xKp…3fQ)". Never the sender's email. The email links only to the app,
   carries the optional note, and states that Oink never asks for a password by email.
   **X:** no notification until the bot exists; the sender is warned to tell the recipient.

**Claim.** When a wallet links an email or X account that has pending held payments, the
backend (in one DB transaction per payment) marks each `claiming` and uses the refund signer
to move the funds from the holding wallet to the claimant's Oink wallet, fee paid by the fee
payer. v1 delivers the held token as-is; the claimant's mix is not applied to claims, because
the policy engine cannot see through Jupiter's address lookup tables.

**Refund.** A job every 5 minutes refunds held payments past `expires_at` to the sender's
wallet. `claiming` / `refunding` are row-locked states, so a claim and a refund can never both
move the same payment. Failures stay in the row and appear in the admin dashboard with a retry.

**X username lookup** needs the X user's numeric ID (Privy requires `subject` to pregenerate an
X user). That needs `X_BEARER_TOKEN`; without it, paying an X username that is not on Oink is
disabled with a clear message, and paying an X-linked Oink user still works.

---

## 6. The refund signer — the one exception to "no custodial signing"

Approved by the project owner on 2026-09-23. AGENTS.md rule 4 records it.

- One Privy **authorization key** (`PRIVY_AUTHORIZATION_KEY`), held by the backend, added
  as a signer **only on holding wallets** — never on a user's Oink wallet, which remains
  browser-held.
- Every holding wallet has a policy that allows only: SPL `TransferChecked` whose
  destination is in that wallet's **condition set**, and nothing else (no SOL transfers, no
  other programs, no message signing).
- The condition set holds the sender's token account for each pending payment, and the
  claimant's token account once their identity is verified. Items are added only by the
  claim and refund code paths.
- **What this does and does not protect.** The policy stops bugs and a partially compromised
  server (for example one that can call Privy but not change condition sets) from sending
  held funds elsewhere. It does **not** stop an attacker holding the authorization key, who
  could edit the condition set. The exposure is capped by the 48-hour window: only unclaimed
  payments from the last two days are ever at risk.

---

## 7. Mix (renamed from election)

Rename everywhere: tables `mixes`, `mix_revisions`; column `transfers.mix_applied`; routes
`/api/v1/mix`; service `mixEngine`; screens and copy "Your mix". Behaviour is unchanged.

---

## 8. Admin dashboard

- Route `/admin` in the frontend, API under `/api/v1/admin/*`.
- **Login:** Privy email login. The backend verifies the identity token and admits only
  addresses in `ADMIN_EMAILS` (initially `chukwupascal14@gmail.com`), then issues a
  separate `oink_admin` cookie (8-hour expiry) stored in `admin_sessions`. A wallet session
  never grants admin access, and an admin session never grants wallet access.
- **Transactions:** transfers, held payments (pending / claimed / refunded / failed),
  filters, Solscan links.
- **Activity:** sign-ups, unlocks, failed logins, recoveries, identity links, lockouts.
  Each item can be marked reviewed or flagged; that decision is written to `admin_audit`.
- **Database:** read-only, paginated table views. Always hidden: `ciphertext`, `nonce`,
  `kdf_salt`, `auth_key_hash`, `totp_secret_enc`, `totp_nonce`, `token_hash`. No SQL box.
- **Health:** fee payer SOL balance, pending held payments and their total, failed
  refunds and claims with a retry button.
- Every admin read of the database viewer and every admin action is logged to `admin_audit`.

---

## 9. New configuration

| Name | Where | Required |
| :--- | :--- | :--- |
| `PRIVY_APP_ID` | backend + frontend (`VITE_PRIVY_APP_ID`) | for linking, held payments, admin |
| `PRIVY_APP_SECRET` | backend | as above |
| `PRIVY_VERIFICATION_KEY` | backend | to verify identity tokens offline |
| `PRIVY_APP_SECRET` | backend | for held payments (creating holding wallets) |
| `PRIVY_AUTHORIZATION_KEY` | backend | for the refund signer |
| `PRIVY_SIGNER_ID` | backend | the authorization key's ID, attached to holding wallets |
| `RESEND_API_KEY`, `EMAIL_FROM` | backend | for payment emails |
| `X_BEARER_TOKEN` | backend | only to pay X usernames not on Oink |
| `ADMIN_EMAILS` | backend | comma-separated |

Without the Privy settings the app still runs: linking, held payments and admin login show
"not configured" instead of failing.

---

## 10. Build order

1. Rename election to mix; replace tag-as-account with account ID. No Privy needed.
2. Admin dashboard (auth via Privy identity token; testable with a locally minted token).
3. Privy linking: X to claim tag, email.
4. Paying an email or X username; held payments.
5. Claim, refund job, Resend emails.
6. Live test against Privy and Resend once keys exist.

---

## 11. Client IPs and rate limits

Every API call leaves from the frontend's server functions on Vercel, so the API used to see
Vercel's address for every user: per-IP limits and lockout bookkeeping were effectively
global. The proxy now forwards the browser IP (Vercel's `x-real-ip`) as `x-oink-client-ip`
together with `OINK_PROXY_SECRET`; the API trusts that header only when the secret matches,
and otherwise uses the last `X-Forwarded-For` hop, which its own platform proxy appends.

The IP limiter also used to count `login_attempts` rows of its own kind, which only unlock
and recovery wrote, so the challenge and `enroll/start` limits never engaged. It now counts
its own admissions in `rate_limit_hits`.
