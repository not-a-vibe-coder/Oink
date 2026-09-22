# OINK — Oinkbot on X (Phase 2)

**Status: deferred.** Do not build any of this until the core wallet is complete and
demo-ready. The product rule stands: **X is never required to use Oink.**

TENDER made the opposite choice — `src/components/dashboard/XAuthGate.tsx` blocks the entire
dashboard behind an X OAuth flow. That gate is deleted, not ported.

---

## 1. What Oinkbot is for

A user mentions `@Oinkbot` on X and asks it to do something with their Oink wallet:

```
@Oinkbot send @ada 20 USDC
@Oinkbot buy 50 USDC of NVDAx
@Oinkbot set my election to 60 SPY 40 USDC
@Oinkbot what's my balance
```

The value is distribution: xStocks trading and tag-to-tag payments that start where the
conversation already is.

---

## 2. The signing problem

Oink's private key lives in the user's browser, encrypted with a password the server cannot
derive. A tweet cannot produce a signature. There are exactly three honest ways to resolve
this, and the choice is a product decision, not a technical accident.

### Option A — Staged intents (build this first)

The bot **parses and stages**; the user **confirms in the app**, where the key is.

```
tweet -> parse -> bot_intents row (pending) -> bot replies with a confirm link
      -> user opens Oink, key unlocks, sees the pending intent, taps Confirm
      -> browser signs -> submit -> bot replies with the receipt
```

- Custody unchanged, no new trust, no new key material
- Costs one app visit per action
- TENDER already implements exactly this shape via `pending_settlements` and
  `src/components/dashboard/Pending.tsx`. Port that pattern to `bot_intents`.

**This is the recommended v1 of the bot.**

### Option B — A separate bot wallet with a spend cap

The user creates a **second, small wallet** ("pocket") whose key is held server-side, sealed
with `OINK_KMS_KEY`, and funds it deliberately.

- Genuinely custodial for that balance — say so, in those words, in the UI
- Hard caps: maximum balance, per-transaction limit, daily limit, allowlist of tags
- The main wallet is never touched
- Only build this if the staged-intent latency proves to be the thing killing the demo

### Option C — Delegated session keys

Solana has no native account abstraction for arbitrary delegation. Approximations
(token-account `approve` delegation for fixed amounts, or a custom program) are real work and
carry real risk.

**Do not attempt this for a hackathon.** It is listed so the option is not rediscovered
halfway through implementation.

---

## 3. Linking an X account

OAuth2 PKCE. Port `backend/src/services/x/oauth.ts` — it already does the PKCE pair,
authorise URL, code exchange and user fetch correctly.

Changes from TENDER:

- The flow starts from **inside** an authenticated Oink session (`/app/settings`), not from a
  gate on the front door
- TENDER proved wallet ownership with a wallet signature before redirecting. Oink already has
  a session, so the session is the proof; additionally require a fresh TOTP code before
  linking, because linking grants an ability
- Store in `x_links` keyed by tag, one X account per tag and one tag per X account
- Unlinking is a single `DELETE`, immediate, with no confirmation theatre beyond one dialog

---

## 4. Parsing pipeline

Port and adapt, in order:

1. `backend/src/services/x/commandParser.ts` — fast regex path for the common shapes. Rewrite
   the `@TenderRWABot` / `@TenderRWA` strip list, drop every EVM address pattern
   (`0x[a-fA-F0-9]{40}`), keep the base58 pattern.
2. `backend/src/services/x/groqIntentParser.ts` — LLM fallback for anything the regex misses.
   Keep the Groq call but treat its output as untrusted: validate every field against the
   same schema the regex path produces, and **never** let parsed text choose a recipient
   address directly — only a tag that resolves through `GET /api/v1/tags/:tag`.
3. `backend/src/services/x/poller.ts` + `botCursor.ts` + `botClient.ts` +
   `botTokenManager.ts` — mentions polling with a durable cursor. Port nearly as-is.
4. `xBotRoutingService.ts` becomes `intentRouter.ts`: it writes `bot_intents` rows instead of
   building transactions.

### Intent schema

```ts
type BotIntent = {
  action: 'send' | 'buy' | 'sell' | 'elect' | 'balance' | 'help';
  targetTag: string | null;      // resolved, never a raw address from tweet text
  amount: number | null;
  token: string | null;          // must resolve in the token registry
  election: Array<{ symbol: string; basisPoints: number }> | null;
  memo: string | null;
  confidence: number;            // below 0.8 -> ask for confirmation in the reply
};
```

---

## 5. Safety rules for the bot

These are not optional; a payments bot on a public timeline is an obvious abuse target.

1. **Idempotency.** `source_ref` is the tweet id with a unique constraint. A replayed tweet
   never produces a second intent.
2. **Author binding.** An intent is only ever staged for the X account that is linked to a
   tag. An unlinked mention gets a reply explaining how to link — never a staged action.
3. **No address-in-tweet payments.** Recipients are tags. A base58 string in a tweet is
   ignored for `send`.
4. **Rate limits.** Per X account: 10 intents per hour. Per tag: 20 pending intents maximum.
5. **Expiry.** Intents expire in 15 minutes. An expired intent cannot be confirmed.
6. **Reply hygiene.** Never put an amount and a confirm link in a reply to someone other than
   the author. Never quote a balance publicly — reply "check your app" and show the number
   only in the authenticated UI.
7. **Kill switch.** `X_BOT_ENABLED=false` stops the poller cleanly at the top of the loop,
   as in TENDER's config.
8. **Prompt injection.** Tweet text reaches an LLM. Treat every field it returns as hostile
   input: validate, clamp, resolve through the registry, and never interpolate tweet text
   into a system prompt or into a reply without escaping.

---

## 6. Confirm surface in the app

`/app` shows a pending-intent banner when `GET /api/v1/intents?status=pending` is non-empty.
Tapping it opens a sheet:

```
Oinkbot staged this from X
  Send 20 USDC to @ada
  "for coffee"
  Requested 2 minutes ago from @pascal_x
  [ Confirm and sign ]   [ Dismiss ]
```

Confirming runs the ordinary quote, build, sign, submit path. The bot then replies to the
original tweet with the signature and an explorer link.

Port the interaction from `src/components/dashboard/Pending.tsx`.

---

## 7. What to tell users

One line in settings, and the same line on the landing page:

> Oink works without X. Linking your X account only lets Oinkbot stage actions for you — you
> still confirm and sign every one in the app.

If Option B (the pocket wallet) is ever built, that sentence changes and the custody
difference must be stated in the UI at the point of funding, not in a footnote.
