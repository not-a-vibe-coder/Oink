# Submission draft

**Status:** draft, not uploaded. Bracketed **[…]** items are founder actions or live evidence
that does not exist yet. Do not submit them as written.

| | Solana Mobile "CLOCK IN" | Colosseum Crypto World's Fair |
| --- | --- | --- |
| Deadline | **Oct 12, 2026, 23:59 UTC** (submit first) | **Oct 12, 2026, 23:59 PT** (Oct 13, 06:59 UTC) |
| Needs | Functional Android APK, GitHub repo, demo video, pitch deck | Repo, live URL, pitch video (2–3 min), demo video (≤3 min), logo, team, prior-work disclosure; every teammate registered |

## Shared copy

**Name:** Oink

**One line:** Get paid in stocks, on your phone. Your cash reserve fills first, and Bell checks
every stock purchase before you sign it.

**Problem:** People paid in USDC (freelancers, contractors, remote workers) face the same
decision every payday: how much stays liquid, and how much gets invested? Acting on it means
juggling a wallet, a DEX and their own price checks, so most leave everything in USDC. *This
is a hypothesis we have not yet validated with interviews.*

**Product:**
1. **Oink account.** Password + authenticator (TOTP) encrypted browser wallet, with no seed
   phrase prompt, no extension and no broker. @tags, payment links, and a Mix for payments to
   your @tag.
2. **Flow (the plan).** A payment link carries a unique Solana Pay reference. Oink records
   the payment only after a finalized, exact-amount, referenced transfer. Applying the plan
   tops up the cash reserve first, then splits the surplus into stock orders, using exact
   BigInt arithmetic.
3. **Bell (the safety).** Each order gets a Jupiter Swap v2 quote for its exact amount and
   is checked against the user's limits (slippage, price impact, maximum price, and an
   optional premium cap over Pyth's regular-session stock price after the xStock's on-chain
   share multiplier). It fails closed: deferred orders stay in USDC. Passing orders become
   guarded transactions (instruction allowlist, decoded route_v2, single signer, simulation,
   30-second quote expiry). The user signs locally, the signature is persisted **before**
   broadcast, and uncertain outcomes are reconciled rather than resent. Retry and cancel are
   explicit.
4. **Mobile.** Installable PWA and Android APK (Trusted Web Activity). Seeker/Android wallets
   pay links and top up the Oink wallet via Mobile Wallet Adapter. Opt-in push sends generic
   "Payment received" and "Bell order needs review" alerts. A home "Payday plan" card always
   shows the next step.
5. **SKR.** The official SKR mint is in the asset registry and the Mix picker; look-alikes are
   rejected. Holders above a configurable balance, verified on-chain server-side, get a
   higher daily fee-sponsorship quota on Oink's existing sponsored transfers.

**Technology:** Solana (SPL USDC, Token-2022 xStocks with scaled-UI multipliers), Jupiter
Swap v2, Pyth Hermes, Solana Pay references, Mobile Wallet Adapter (wallet-standard-mobile),
Web Push (VAPID), Bubblewrap TWA, TanStack Start/React 19, Bun/Express/PostgreSQL. MIT.

**Business model (hypothesis):** Start with USDC-paid freelancers, then reach them through
platforms that pay contractors in USDC. Monetisation to test: a small, clearly disclosed fee
on executed purchases (Bell currently encodes **zero**), or a paid plan for payers who run
payroll through Oink links. No pricing has been validated, and no revenue is claimed.

**Traction and evidence:** see `06-EVIDENCE.md`. The implementation is complete and the
automated tests pass. **[LIVE: first mainnet Bell fill on Solscan: link pending]**.
**[Users: none yet; add any consented pilot results from `02-PILOT.md`]**. No revenue.

**Limitations (honest paragraph):** xStocks are issued by Backed and are not offered to US
persons; availability depends on the issuer's terms in each jurisdiction, so Oink must gate
eligibility before a public launch. Bell's premium cap needs a Pyth API key (Hermes has
required one since August 2026) and works only during regular US market hours with fresh,
narrow-confidence prices. Outside those conditions it defers instead of guessing, and
extended-hours status is an approximation. Bell users pay their own SOL network fees and
first-time token-account rent; sponsored fees apply only to ordinary Oink transfers. The
cash reserve is an accounting reservation, not an escrow: spending from another wallet app
can reduce it. Push and Seeker-wallet flows are implemented and unit/integration tested but
**[pending: verified on a real Android device after deploy]**.

**Links:** Repo `https://github.com/not-a-vibe-coder/Oink` (public, MIT) · Live
**[URL]** · APK **[link]** · Demo video **[link]** · Pitch video **[link]** · Deck
`docs/submission/deck/oink-deck.html` → PDF **[export]** · Logo `public/icons/icon-512.png`
(Fluent Emoji pig, MIT: see `public/illustrations/LICENSES.md`).

**Team:** **[FOUNDER: names, roles, short relevant background, location, time commitment]**
· **[Every teammate registered on colosseum.com: yes/no]**

**Prior work:** see `05-REUSE-DISCLOSURE.md` (ported from the founder's TENDER project).

## Judging map: Solana Mobile (lead with stickiness)

| Criterion | Our case | Evidence in repo |
| --- | --- | --- |
| **Stickiness / PMF** | *Every payday brings you back.* The product is a recurring loop (payment → reserve → orders → review), not a one-off swap. The home card always surfaces the next payday action, and push brings users back when money lands or an order needs review. | `src/lib/flow/journey.ts`, `src/components/flow/PaydayPlanCard.tsx`, `backend/src/services/push.ts`; PMF is a hypothesis (`02-PILOT.md`) |
| **UX** | Phone-first, no seed phrase, one next action, 44px tap targets, light/dark themes, 3D illustrations, installable, works with Seeker wallets | `07-BUILD-LOG.md` tasks 3, 4 and 7 (360–430px overflow and tap-target checks, Chrome installability check), `src/lib/mwa` |
| **Innovation** | Income-first allocation plus a pre-signing execution guard for tokenized stocks, with premium checks against the real stock price after the on-chain share multiplier | `src/lib/bell/reference.ts`, `backend/src/services/bell/*` |
| **Presentation** | Deck, ≤3-min phone demo, pitch | `deck/oink-deck.html`, `03-PITCH-AND-DEMO.md` **[videos pending]** |
| **SKR prize (optional)** | Official SKR in the registry and Mix; on-chain-verified holder perk that adds fee sponsorship without touching Bell signing | `backend/src/lib/tokens.ts`, `backend/src/services/feePayer.ts`, `backend/tests/sponsorship.integration.test.ts` |
| **dApp Store readiness** | Signed TWA APK pipeline, `assetlinks.json`, keystore kept off-repo | `twa/`, `public/.well-known/assetlinks.json` |

## Judging map: Colosseum

| Criterion | Our case | Evidence |
| --- | --- | --- |
| **Functionality / code quality** | Typed end to end; BigInt money; fail-closed guards; persist-before-broadcast; 125 unit tests and 64 PostgreSQL integration tests passing | `bun run verify:flow`, `06-EVIDENCE.md` |
| **Potential impact** | Turns stablecoin income into long-term ownership with guardrails, on the device where people get paid | Pitch; pilot plan `02-PILOT.md` |
| **Novelty** | A cash-first payday plan combined with a policy engine that can refuse a stock trade against a live equity reference, before the user signs | `docs/bell/01-EXECUTION-SPEC.md` |
| **UX** | As above | As above |
| **Open source / composability** | MIT; composes Jupiter, Pyth, Solana Pay, MWA, xStocks, Web Push; reusable pure modules (`src/lib/flow`, `src/lib/bell`) | `LICENSE`, module layout |
| **Business plan** | Freelancer wedge → contractor-payment platforms; disclosed execution fee or payer plan (to validate) | This document |

## Submission checklist (founder)

- [ ] Deploy (08-DEPLOY.md), rebuild the APK against the real domain, and test it on a phone
- [ ] One real ~$10 SPYx purchase; add the Solscan link here, in the README and in 06-EVIDENCE
- [ ] Record the pitch and the demo (03-PITCH-AND-DEMO.md); test the links from a signed-out browser
- [ ] Export the deck to PDF (open `deck/oink-deck.html` in Chrome → Print → Save as PDF)
- [ ] Fill in team info; register every teammate on colosseum.com
- [ ] **Solana Mobile** (before 23:59 UTC Oct 12): APK, repo, demo video, deck
- [ ] **Colosseum** (before 23:59 PT Oct 12): repo, live URL, pitch and demo videos, logo,
      05-REUSE-DISCLOSURE, Solana track; keep the confirmation
