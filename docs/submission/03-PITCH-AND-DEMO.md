# Pitch and demo scripts

Two separate recordings, as Colosseum asks: a **pitch** (2–3 min) and a **product demo**
(≤3 min, phone-first). Do not read bracketed text aloud. Every claim below traces to code or
tests in this repository; anything that needs a live run is marked **[LIVE]**. Record it for
real, or say plainly that it is a simulation.

## Pitch: about 2½ minutes

**Problem (0:00–0:25).** "If you're paid in USDC, every payday asks the same question: how
much do I keep as cash, and how much do I invest? Then you open a wallet, a DEX and a
spreadsheet, and hope the price you sign is the price you meant. Most people just leave it
all in USDC."

**Product (0:25–1:00).** "Oink: get paid in stocks, on your phone. You share a payment link
or your @tag. When the payment lands and Oink verifies it on-chain, your payday plan runs. It
tops up your cash reserve first, then turns the rest into orders for the tokenized stocks you
picked: SPYx, NVDAx, AAPLx. You sign up with a password and an authenticator app. No seed
phrase, no broker, no browser extension."

**How Bell protects you (1:00–1:35).** "Every order goes through Bell. Bell gets a Jupiter
quote for the exact amount and checks it against your limits: slippage, price impact,
maximum price and, when live reference data is available, a premium cap over the real stock
price. If the quote fails, Bell defers the order and your money stays in USDC. It never
invents a price. If it passes, Bell builds a guarded transaction that only allows the
expected swap. You sign it on your phone, and Oink saves the signature before broadcasting, so
a dropped connection can never double-buy."

**Why mobile and Solana (1:35–1:55).** "Payday is a phone moment. Oink installs as an app
on Android and the Seeker. Clients can pay straight from their Seeker wallet, you get a
notification when money arrives, and on Solana a ten-dollar stock purchase costs a
fraction of a cent in network fees, plus a one-time token-account deposit the first time you buy
each stock."

**Proof (1:55–2:15).** "It's built and tested end to end: on-chain receipt verification,
exact BigInt allocation, Bell's guards, persist-before-broadcast and reconciliation, with
over 120 unit tests and 64 database integration tests. [LIVE: 'and here's our first real
SPYx purchase on Solscan' — only if it exists.] We don't claim users or revenue yet."

**Business and ask (2:15–2:35).** "We start with USDC-paid freelancers and contractors. The
model to test is a small, disclosed fee on executed purchases or a paid plan for teams that
pay contractors, which today is zero by design. Every payday brings you back, and that's the
habit we're building. [FOUNDER: name, background, why you understand this user.] Oink: get
paid in stocks, on your phone."

## Product demo: 3 minutes or less, on a phone

Record the screen of an Android phone (ideally a Seeker) running the installed app (TWA or
PWA). Use a fresh account and a small amount of real mainnet USDC. **If no funded run is
possible, record `/demo` instead and keep its "Simulated walkthrough" banner visible the
whole time.**

| Time | Screen | Action and narration |
| --- | --- | --- |
| 0:00–0:20 | Landing → Create | "No seed phrase: a password and an authenticator." Create the account (skip the 2FA QR in the edit). |
| 0:20–0:40 | Home → Payday plan card | "Home shows one next step." Card says *Set your payday plan*. Tap through Mix to show the @tag split. |
| 0:40–1:00 | Income → plan | Reserve target (e.g. 5 USDC) and 60% SPYx / 40% AAPLx. Save. Create a 10 USDC payment link. |
| 1:00–1:25 | `/income/<id>` on a second phone | **[LIVE]** Payer taps "Connect wallet to pay" → approves in their Seeker wallet. "The payment carries a unique reference; Oink accepts it only once it is finalized on-chain." |
| 1:25–1:45 | Home | **[LIVE]** Push: *Payment received*. Card: *Payment received → Apply plan*. Tap it. "The reserve fills first, and the rest becomes two orders." The reserve bar fills. |
| 1:45–2:20 | Income → Bell orders | Check quotes. Set a maximum token price below AAPLx's price so Bell **defers** AAPLx ("too expensive, it stays in USDC"), while SPYx **passes**. Show the market-session badge. |
| 2:20–2:45 | Bell review → sign | **[LIVE]** Review the simulation (input, minimum output, SOL fee) → unlock → sign locally. "The server never sees my key." |
| 2:45–3:00 | Receipt → Solscan | **[LIVE]** State *confirmed* → open the Solscan link. "That's a real tokenized-stock purchase, checked before I signed it." |

Before recording: deploy (`docs/submission/08-DEPLOY.md`), fund the Oink wallet with
~0.02 SOL for Bell fees (Receive → *Top up from Seeker wallet*), and turn on notifications
in Settings. Never show the password, the authenticator secret or the recovery phrase.
Keep pitch and demo as separate files.
