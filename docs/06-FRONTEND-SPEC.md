# OINK — Frontend Specification

Stack carried over from TENDER: **TanStack Start + React 19 + Tailwind v4 + shadcn/ui +
TanStack Query + Zustand + Framer Motion**. Bun as the package manager.

Removed entirely: `wagmi`, `viem`, `@wallet-standard/*`, `@solana/wallet-standard-features`,
and every rail abstraction.

Added: `hash-wasm`, `@scure/bip39`, `ed25519-hd-key`, `@solana/web3.js`, `qrcode`,
`@zxcvbn-ts/core`.

---

## 1. Route map

```
/                     Landing. What Oink is, one CTA: Create wallet
/create               Enrollment wizard (5 steps)
/unlock               Sign in / recover: tag + password + TOTP
/app                  Wallet home: balance, holdings, quick actions   [locked route]
/app/send             Send by tag or address                          [locked route]
/app/receive          Address, QR, request money                      [locked route]
/app/election         Portfolio allocation editor                     [locked route]
/app/activity         Transaction history                             [locked route]
/app/invoices         Pay links                                       [locked route]
/app/settings         Security, sessions, export, danger zone         [locked route]
/pay/:invoiceId       Public pay page (no session needed)
/legal/terms, /legal/privacy
```

**"Locked route"** means: requires a session cookie *and* an unlocked in-memory key. A valid
session with a locked key renders the unlock panel inline rather than redirecting, so the
user does not lose their place.

Marketing pages from TENDER (`/pricing`, `/whitepaper`, `/roadmap`, `/services`, `/team`,
`/work`) are **not** ported. Fold anything worth saying into the landing page.

---

## 2. The enrollment wizard — `/create`

Five steps, one per screen, with a progress rail. The user can go back until step 5.

### Step 1 — Password
- Password + confirm, strength meter, minimum 10 characters
- Plain-language warning in a bordered callout: *"Oink cannot reset this. If you forget your
  password and lose your recovery phrase, the money is gone."*
- A required checkbox acknowledging it

### Step 2 — Authenticator
- Calls `POST /api/v1/enroll/start`
- QR rendered client-side from `otpauthUri`, plus the Base32 secret with a copy button
- Input for a 6-digit code, verified against `POST /api/v1/enroll/verify-totp`
- Cannot advance until a code verifies

### Step 3 — Claim your tag
- Single input with a leading `@`
- Debounced availability check (300ms), with inline states: checking, available, taken,
  reserved, invalid
- Three suggestions when taken (append digits, underscore variants)
- Shows the eventual address format: *"People can pay you at `@pascal`"*

### Step 4 — Creating
- Runs the browser-side work: mnemonic, derivation, Argon2id in a Web Worker (real progress
  bar, roughly 1s), AES-GCM encryption, then `POST /api/v1/enroll/complete`
- On `409 TAG_TAKEN`, drop back to step 3 with the error, keeping everything else

### Step 5 — Your secret phrase
- The 12 words in a numbered grid, blurred until "Reveal"
- Copy and download buttons
- A plain-language explanation, not a legal disclaimer: *"These 12 words are your wallet.
  Anyone who has them can take your money, and Oink cannot reset them. You need them if you
  ever lose your authenticator app."*
- **Forced verification:** re-enter 3 randomly chosen words before "Finish" enables. No
  "remind me later" escape
- On finish, zero the phrase in memory and route to `/app`

This is the only backup artifact in the product. There are no recovery codes — the phrase
covers both a forgotten password and a lost authenticator.

---

## 3. The unlock screen — `/unlock`

Three fields on one screen, not three steps:

```
@[ tag                    ]
  [ password              ]
  [ 6-digit code          ]
  ( Unlock )

  Lost your password or your authenticator?  Restore with your secret phrase
```

- One error for everything: *"That tag, password or code doesn't match."*
- Shows the Argon2id progress while deriving

### Restore with your secret phrase — `/unlock/restore`

The single fallback path. It handles a forgotten password and a lost authenticator with the
same three screens, per `02-WALLET-AND-AUTH-SPEC.md` §6.

1. **Tag + phrase** — a 12-field word grid with paste support that splits on whitespace, and
   per-word BIP39 validation with suggestions. Calls `auth/recover/challenge`, derives the
   keypair locally, signs the returned message.
2. **New password** — same strength rules as enrollment. Re-encrypts the *same* entropy under
   a new salt.
3. **New authenticator** — a fresh `enroll/start` QR, confirmed with one code.

Then `auth/recover/complete`. On success: *"You're back in. @pascal, same address, same
balance."* Show that every other device was signed out.

Failure is deliberately vague: *"That phrase doesn't match this tag."* — it covers both a
wrong phrase and a phrase for a different wallet.

If the phrase resolves to a key Oink has never seen, offer enrollment instead: claim a new
tag around the imported wallet. This is the Phantom-import path and is worth a visible entry
point of its own on `/unlock`.

---

## 4. Wallet home — `/app`

Layout, top to bottom:

1. **Header** — the pig avatar (deterministic from `avatarSeed`), `@tag`, a copy-address
   button, a lock button
2. **Balance card** — total USD value, 24h change if prices allow, and the election as a
   compact stacked bar
3. **Quick actions** — Send, Receive, Rebalance
4. **Holdings list** — icon, symbol, underlying ticker, amount, USD value. Tapping one opens
   a sheet with buy / sell / send for that asset
5. **Fund banner** — when `needsSol` is true, a quiet strip explaining that Oink is covering
   fees, with the remaining sponsored count
6. **Recent activity** — last five transfers, linking to `/app/activity`

---

## 5. Send — `/app/send`

1. **Recipient** — one input accepting `@tag`, `$tag`, a bare tag, or a base58 address.
   Typeahead over contacts and `GET /api/v1/tags/resolve`. Shows the resolved avatar and
   display name once matched.
2. **Amount and token** — token picker over the user's holdings; a max button that reserves
   enough SOL for fees.
3. **Preview** — *"@ada receives"* with the leg breakdown from the quote: each elected asset,
   its percentage, the estimated amount out, and price impact. Any `safeSettled` leg gets an
   amber note: *"Routed to USDC — price impact on NVDAx exceeded 3%."*
4. **Confirm** — if the key is locked, an inline password prompt (TOTP not required for a
   spend; the key itself is the authority). Signs, submits, shows a pending state with the
   signature, then a confirmed receipt with an explorer link.

Quote expiry is visible as a thin 30-second countdown; it auto-refreshes.

---

## 6. Receive — `/app/receive`

Two tabs:

- **Your address** — the base58 key, a large QR from `solanaPayUri`, copy button, and a line
  explaining that anything sent here arrives as-sent and can be rebalanced afterwards
- **Request** — amount, token, memo, and a toggle for *"Settle into my election"*. Produces
  an invoice with a short `/pay/:id` link, a QR, and native share

---

## 7. Election editor — `/app/election`

Port the interaction model from TENDER's `src/components/dashboard/Elections.tsx` — it is
already good. Adapt:

- Rows of asset plus percentage, with a drag handle
- A live stacked bar across the top, coloured by each token's dominant icon colour (the
  `src/lib/token-color.ts` helper is worth porting)
- Total indicator that turns red when it is not 100, with a one-tap "normalise" that
  distributes the difference proportionally
- Asset picker modal over the registry, with search and the featured set pinned
  (port `AssetPickerModal.tsx`)
- Save is disabled until the set is valid and dirty
- After saving, a confirmation showing what changes for future payments, plus an offer to
  rebalance the current balance to match

---

## 8. Settings — `/app/settings`

- **Security:** change password (re-encrypt flow), reset authenticator, auto-lock timeout,
  the "trust this device" toggle (off by default, with a plain explanation of the trade-off)
- **Sessions:** active devices with a revoke button each, plus revoke-all
- **Secret phrase:** reveal the 12 words behind password + TOTP, with a hold-to-reveal
  interaction and a warning about screenshots. Also the export path for moving the wallet
  into Phantom or Solflare — say so, since it is a genuine reason to look
- **Connections:** a placeholder card for X / Oinkbot marked "Coming soon" — never a gate
- **Danger zone:** freeze the account (blocks new sessions; funds remain spendable with the
  recovery phrase)

---

## 9. Key session module

`src/lib/wallet/key-session.ts` — the only place a private key exists.

```ts
// Module-scope, deliberately not in a store.
let keypair: Keypair | null = null;
let lockTimer: ReturnType<typeof setTimeout> | null = null;

export function unlockWith(entropy: Uint8Array): void   // derive + arm auto-lock
export function isUnlocked(): boolean
export function publicKey(): string | null
export function signTransaction(txB64: string): string  // returns signed base64
export function lock(): void                            // zero + clear timers
export function onLockChange(cb: (unlocked: boolean) => void): () => void
```

Rules:
- Never expose the `Keypair` object outside this module
- Auto-lock at 15 minutes idle; reset the timer on pointer, key and visibility events
- Lock on `pagehide`
- React reads only `isUnlocked()` / `publicKey()` through a subscription hook
- No Zustand persistence anywhere near it

---

## 10. Data layer

Keep TENDER's server-function pattern:

- `src/server/oink-api.ts` — server-only `fetch` to the API host, with the fallback URL logic
  and a typed `OinkApiError`
- `src/lib/oink-server-fns.ts` — `createServerFn` wrappers with Zod input schemas
- `src/hooks/useOink.ts` — TanStack Query hooks over those server functions

Delete `src/lib/rail-normalize.ts`, `src/lib/rail.ts`, `src/types/rail.ts`,
`src/lib/tender-v2-server-fns.ts`, and everything under `src/lib/wallet/` that touches EVM.

Query keys are namespaced by tag: `['wallet', tag]`, `['election', tag]`,
`['activity', tag, page]`. Invalidate on every confirmed transfer.

---

## 11. Design direction

Oink is a consumer money app, not a terminal. Keep TENDER's typographic discipline and its
token-driven CSS, lose the dashboard-as-cockpit framing.

### Palette (`src/styles.css`, replacing TENDER's red)

```css
@theme {
  --color-base:      #ffffff;
  --color-card2:     #faf6f7;
  --color-raised:    #f2eaed;
  --color-hairline:  #e8dde1;

  --color-oink:       #ec4e7c;   /* primary — pig pink */
  --color-oink-hover: #d83f6b;
  --color-oink-deep:  #b8325a;
  --color-blush:      #ffe4ec;   /* tinted surfaces */

  --color-ink:        #171216;
  --color-secondary2: #5b5158;
  --color-muted2:     #9a8f95;
  --color-success:    #2fb87a;
  --color-warning:    #f5a524;
  --color-danger:     #e5484d;

  --radius: 0.75rem;             /* softer than TENDER's near-square 0.25rem */
}
```

- **Type:** keep `Space Grotesk` for display and `Inter` for body. Drop the mono face except
  for addresses, signatures and amounts.
- **Motion:** Framer Motion, short and functional. Ease `[0.16, 1, 0.3, 1]`, carried over.
- **Numbers:** tabular figures for every amount. Never let a balance reflow as it updates.
- **Avatar:** a deterministic pig generated from `avatarSeed` — inline SVG, a few colourways
  and accessories. Cheap, memorable, and gives tags a face in the send flow.

### 3D and heavy assets

TENDER ships three.js, R3F, postprocessing, GSAP, Lenis and several particle scenes
(`src/views/evolve-hero/`, `src/views/head-particles/`, `src/views/home/scene/`). For a
wallet these are dead weight on first paint.

- **Default: drop all of it.** Do not port `three`, `@react-three/*`, `postprocessing`,
  `cannon-es`, `gsap`, or `lenis`.
- **Optional:** one lightweight hero animation on the landing page only, lazy-loaded behind a
  route split, never on `/app`.

### Accessibility and responsiveness

- Mobile first; this is a phone app that happens to run in a browser. Every screen must work
  at 375px with a 16px gutter.
- Tap targets 44px minimum.
- The TOTP and password inputs must work with password managers: correct `autocomplete`
  (`current-password`, `new-password`, `one-time-code`), real `<form>` elements, and no
  synthetic key handling that breaks paste.
- Respect `prefers-reduced-motion`.
