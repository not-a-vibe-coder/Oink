# OINK — Porting Map

Source: `C:\Users\USER\tender` · Target: `C:\Users\USER\oink`

Three verdicts:

- **COPY** — take the file nearly verbatim; rename identifiers only
- **ADAPT** — the logic is right, the shape changes (handle to tag, remove the rail)
- **DROP** — do not port; it belongs to the EVM rail, the X gate, or the marketing site

> Copy rather than retype anything marked COPY. Re-deriving the token registry or the
> Jupiter instruction handling by hand is how subtle bugs get introduced.

---

## 1. Backend

| Source | Verdict | Target / notes |
| :--- | :--- | :--- |
| `backend/src/lib/rwaTokens.ts` | **COPY** | `src/lib/tokens.ts`. Several hundred curated xStocks. The single most valuable file in the project |
| `backend/src/services/jupiterService.ts` | **COPY** | Quote + swap-instructions fetch |
| `backend/src/services/txBuilder.ts` | **COPY** | Keep `resolveTokenProgramId` (Token-2022), idempotent ATA creation, ALT handling, v0 compile. Add fee-payer partial signing |
| `backend/src/db/index.ts` | **COPY** | pg pool |
| `backend/src/db/migrate.ts` | **COPY** | Forward-only migration runner |
| `backend/src/routes/health.ts` | **COPY** | Add `network` to the payload |
| `backend/Dockerfile` | **COPY** | Rename the image |
| `backend/src/services/dualQuoteEngine.ts` | **ADAPT** | Becomes `services/electionEngine.ts`. Keep `parseTokenUnits`, `formatTokenUnits`, `calculatePortfolioElectionQuotes`, the slippage cap and USDC safe-settle. Strip the Relay comparison |
| `backend/src/routes/handles.ts` | **ADAPT** | Splits into `routes/tags.ts` (availability, public profile) and `routes/elections.ts`. Handle becomes tag; ownership comes from the session, not from a wallet address in the body |
| `backend/src/routes/settle.ts` | **ADAPT** | Becomes `routes/transfer.ts`: quote, build, submit, confirm, history. Add server-side re-validation of the signed transaction against the built message |
| `backend/src/routes/assets.ts` | **ADAPT** | Same endpoints, drop rail branching |
| `backend/src/routes/invoices.ts` | **ADAPT** | Tag-keyed; add `applyElection` |
| `backend/src/routes/nft.ts`, `services/nftService.ts` | **ADAPT (optional)** | Not core. Build only if time remains after Phase 6 |
| `backend/src/app.ts` | **ADAPT** | Keep the request logger; **extend the redaction list** per `02-WALLET-AND-AUTH-SPEC.md` §9. Mount only `/api/v1`. Replace the permissive `cors()` with an explicit origin allowlist plus `credentials: true` |
| `backend/src/config.ts` | **ADAPT** | Drop Relay, drop the Robinhood block. Add `kmsKey`, `decoyKey`, `feePayer`, `sessionTtl`, `sponsorship` |
| `backend/src/index.ts` | **ADAPT** | Add a boot assertion that `OINK_KMS_KEY` and `DATABASE_URL` exist |
| `backend/db/migrations/*.sql` | **DROP** | Fresh schema in `03-DATA-MODEL.md`. New database, nothing carried over |
| `backend/src/services/relayService.ts` | **DROP** | Cross-chain relay, not needed |
| `backend/src/v2/**` (9 files) | **DROP** | Robinhood Chain / Uniswap V4 / EVM |
| `backend/src/lib/robinhoodTokens.ts` | **DROP** | EVM token list |
| `backend/src/routes/auth.ts` | **DROP, mine for parts** | X OAuth entry. The new `auth.ts` is challenge/unlock/session/recover. **Keep `verifySolanaSignature`** (tweetnacl + bs58) — secret-phrase recovery needs exactly it. Keep the PKCE state-store pattern for Phase 2 |
| `backend/src/services/x/**` (8 files) | **DEFER** | Phase 2 only. See `07-OINKBOT-X.md` |
| `backend/src/routes/bot.ts` | **DEFER** | Phase 2 |
| `backend/cockpit/runCockpit.ts` | **DROP** | Dev harness tied to the old flows |
| `backend/tests/**` | **ADAPT** | Keep the Bun + supertest harness shape; rewrite the cases. `robinhood_v2.test.ts` is dropped |

### New backend files (no source to port)

- `src/lib/crypto.ts` — AES-256-GCM seal/open with `OINK_KMS_KEY`
- `src/lib/totp.ts` — RFC 6238 verify with a monotonic step check
- `src/lib/argon.ts` — server-side `authKey` hashing and verification (`hash-wasm`)
- `src/middleware/session.ts` — cookie to tag
- `src/middleware/rateLimit.ts` — the ladder in `02-WALLET-AND-AUTH-SPEC.md` §7
- `src/routes/enroll.ts`, `src/routes/auth.ts` (new meaning), `src/routes/wallet.ts`
- `src/services/feePayer.ts` — sponsored co-signing with budget enforcement
- `src/services/rpc.ts` — connection, balances, submit, confirm

---

## 2. Frontend

| Source | Verdict | Target / notes |
| :--- | :--- | :--- |
| `src/lib/tender-server-fns.ts` | **ADAPT** | `src/lib/oink-server-fns.ts`. Keep the `createServerFn` + Zod + `proxy()` error-flattening pattern exactly |
| `src/server/tender-api.ts` | **ADAPT** | `src/server/oink-api.ts`. Keep the typed error and the fallback URL. Forward the session cookie |
| `src/hooks/useTender.ts` | **ADAPT** | `src/hooks/useOink.ts`. Delete every rail branch and every `*V2` import; this file shrinks by more than half |
| `src/components/dashboard/Elections.tsx` | **ADAPT** | `src/components/election/ElectionEditor.tsx`. The interaction model is good; drop `useRailProfile` and the handle-from-session lookup |
| `src/components/dashboard/AssetPickerModal.tsx` | **ADAPT** | Keep search, featured pinning and icon handling |
| `src/components/dashboard/AssetPicker.tsx` | **ADAPT** | Inline variant |
| `src/lib/token-color.ts` | **COPY** | Dominant-colour extraction for the allocation bar |
| `src/lib/solana-bytes.ts` | **COPY** | base64/base58 helpers |
| `src/components/dashboard/Invoices.tsx` | **ADAPT** | `/app/invoices` |
| `src/components/dashboard/Pending.tsx` | **DEFER** | The shape becomes the Phase 2 intent-confirm sheet |
| `src/components/dashboard/DashTable.tsx`, `StatCard.tsx` | **ADAPT** | Useful primitives for activity and holdings |
| `src/routes/pay.$invoiceId.tsx` | **ADAPT** | `/pay/:invoiceId`, now session-free and tag-aware |
| `src/components/ui/**` (60 files) | **COPY** | shadcn/ui primitives. Copy wholesale, restyle via tokens |
| `src/styles.css` | **ADAPT** | Keep the token architecture, swap the palette per `06-FRONTEND-SPEC.md` §11 |
| `src/router.tsx`, `src/start.ts`, `src/server.ts`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `components.json` | **COPY** | Project scaffolding |
| `src/lib/utils.ts`, `src/hooks/use-mobile.tsx`, `use-window-size.ts` | **COPY** | |
| `src/lib/rail.ts`, `rail-normalize.ts`, `robinhoodChain.ts`, `src/types/rail.ts` | **DROP** | The rail abstraction is gone |
| `src/lib/wallet/evm-wallet.tsx`, `wagmi-config.ts` | **DROP** | EVM |
| `src/lib/wallet/solana-wallet.tsx`, `wallet-context.tsx` | **DROP** | External wallets. Replaced by `src/lib/wallet/key-session.ts` |
| `src/components/wallet/ConnectWalletButton.tsx`, `WalletModal.tsx` | **DROP** | No external wallet to connect |
| `src/components/dashboard/RailSwitcher.tsx`, `DemoBadge.tsx` | **DROP** | |
| `src/components/dashboard/XAuthGate.tsx` | **DROP** | The X gate is the thing being removed |
| `src/lib/tender-v2-server-fns.ts`, `src/types/tender-v2.ts` | **DROP** | |
| `src/lib/demo/robinhood-demo.ts` | **DROP** | Fixture data for the EVM rail |
| `src/views/evolve-hero/**`, `src/views/head-particles/**`, `src/views/home/scene/**` | **DROP** | Heavy 3D. See `06-FRONTEND-SPEC.md` §11 |
| `src/lib/scene-evolve/**`, `src/lib/scene/**`, `src/lib/lenis.ts`, `src/lib/animation/ticker.ts` | **DROP** | |
| `src/components/home/**`, `src/components/pricing/**`, `src/components/team/**`, `src/components/docs/**` | **DROP** | Marketing site. Write one new landing page |
| `src/pages/**` (Home, Pricing, Roadmap, Services, Team, Whitepaper, Work) | **DROP** | |
| `src/routes/{pricing,roadmap,services,team,whitepaper,work,contact}.tsx` | **DROP** | |
| `src/components/contact/ClaimForm.tsx` | **MINE FOR PARTS** | The tag-validation UX and debounced availability check are worth lifting into the enrollment wizard. The wallet-connect half is dropped |
| `src/lib/lovable-error-reporting.ts`, `.lovable/` | **DROP** | Vendor tooling from the original scaffold |
| `src/lib/error-capture.ts`, `error-page.ts` | **ADAPT** | Keep, but audit that no error path can serialise key material |

### New frontend files (no source to port)

```
src/lib/crypto/
  argon.ts          Argon2id via hash-wasm, in a worker
  argon.worker.ts
  kdf.ts            HKDF split into encKey / authKey
  keystore.ts       AES-256-GCM seal/open with AAD
  mnemonic.ts       BIP39 generate / validate / entropy <-> words
  derive.ts         SLIP-0010 m/44'/501'/0'/0' -> Keypair
  totp-uri.ts       otpauth URI construction for the QR
src/lib/wallet/
  key-session.ts    the only place a private key exists
  use-key-session.ts
  signing.ts        sign a base64 VersionedTransaction
src/components/enroll/   the 5 wizard steps
src/components/unlock/
src/components/send/
src/components/receive/
src/components/avatar/PigAvatar.tsx
```

---

## 3. Dependency changes

**Remove from `package.json`:**
`wagmi`, `viem`, `@wallet-standard/*` (5 packages), `@solana/wallet-standard-features`,
`three`, `@types/three`, `@react-three/fiber`, `@react-three/drei`,
`@react-three/postprocessing`, `postprocessing`, `cannon-es`, `gsap`, `@gsap/react`, `lenis`,
`spring-text-engine`, `@lovable.dev/vite-tanstack-config`.

**Add to `package.json`:**
`@solana/web3.js`, `@solana/spl-token`, `hash-wasm`, `@scure/bip39`, `ed25519-hd-key`,
`qrcode`, `@zxcvbn-ts/core`, `@zxcvbn-ts/language-common`, `nanoid`.

**Backend — remove:** `viem`. **Backend — add:** `hash-wasm`, `cookie`, `nanoid`.
Keep `@solana/web3.js`, `@solana/spl-token`, `bs58`, `tweetnacl`, `pg`, `express`, `cors`,
`dotenv`, `groq-sdk` (Phase 2).

---

## 4. Naming migration

| TENDER | OINK |
| :--- | :--- |
| `handle` | `tag` |
| `handles` table | `wallets` |
| `handle_elections` | `elections` |
| `settlements` | `transfers` |
| `owner_wallet` | `public_key` |
| `TENDER_API_URL` | `OINK_API_URL` |
| `tender-session` (zustand) | deleted — the session is a cookie plus the key session |
| `useTender` | `useOink` |
| `TenderApiError` | `OinkApiError` |

Grep for `tender`, `TENDER`, `Tender`, `robinhood`, `Robinhood`, `rail`, `Rail`, `handle`,
`Handle` after the port and make sure every remaining hit is intentional.
