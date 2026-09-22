# OINK — Monorepo Scaffolding Guide

Hand this to the AI doing Phase 0. Follow the sections in order. This guide produces an empty
but running monorepo — no product logic. Feature work starts at Phase 1 of
`09-BUILD-PLAN.md`.

---

## Pre-flight — already answered

The generic version of this guide asks eleven questions before writing a file. For Oink they
are settled. Do not re-ask them; do not substitute your own preferences.

| # | Question | Answer |
| :--- | :--- | :--- |
| 1 | Project name and one-liner | **Oink** — a self-custodial Solana wallet with tag-based identity, password + TOTP recovery, and receive-side portfolio elections over tokenized stocks |
| 2 | Product docs to read first | **`docs/00` through `docs/10` in this repo.** Read `00-OVERVIEW.md` and `02-WALLET-AND-AUTH-SPEC.md` before writing anything |
| 3 | Monorepo layout | Frontend at **root** (`src/`), backend at **`/backend`**, docs at **`/docs`**. No contracts directory |
| 4 | Backend language / runtime / framework | **TypeScript + Bun + Express** |
| 5 | Database | **PostgreSQL** (Neon, Supabase, or Render Postgres). Fresh database — nothing shared with TENDER |
| 6 | Frontend framework / CSS | **TanStack Start + React 19 + Tailwind v4 + shadcn/ui**. Not Next.js — the port target is TENDER's stack |
| 7 | Smart contracts | **None.** Oink composes Jupiter and SPL Token; it deploys no program. Skip the contracts step entirely |
| 8 | GitHub org and repo | The human supplies this at Step 1. A new private repo — **never** TENDER's |
| 9 | Deployment | Frontend on Vercel or Cloudflare; backend on Render (paid, always-on) |
| 10 | Security contact | `security@<domain>` once the domain exists. **Ask the human before putting a personal email in a public repo** |
| 11 | License | MIT |

The only genuinely open item is #8 and #10. Ask for those two, then proceed.

---

## Step 1 — Git and remote

```bash
cd C:\Users\USER\oink
git init
git branch -M main
```

Add the remote with the token embedded locally, so it lives only in this repo's `.git/config`:

```bash
git remote add origin https://<TOKEN>@github.com/<ORG>/<REPO>.git
```

**Do not** reuse TENDER's remote, token, or repo name.

---

## Step 2 — Directory structure

Create everything up front so later writes never fail:

```bash
mkdir -p .github/workflows
mkdir -p backend/{src/{routes,services,lib,db,middleware},db/migrations,tests}
mkdir -p src/{routes,components/{ui,enroll,unlock,send,receive,election,avatar},lib/{crypto,wallet},hooks,server,types,styles}
mkdir -p public
```

No `contracts/`. If a Solana program is ever added it goes in `programs/` with Anchor, and
this guide gets a new step — do not pre-create an empty directory for it.

---

## Step 3 — Frontend scaffold (TanStack Start + Tailwind v4 + shadcn)

Files at the repository root. **Tailwind v4 has no `tailwind.config.ts` and needs no
`postcss.config.mjs`** — the theme lives in CSS and the Vite plugin does the rest. Do not
generate Tailwind 3 config files out of habit.

**`package.json`** — name `oink`, `"type": "module"`, private. Dependencies:

```
react@^19  react-dom@^19
@tanstack/react-router  @tanstack/react-start  @tanstack/router-plugin  @tanstack/react-query
tailwindcss@^4  @tailwindcss/vite  tw-animate-css
clsx  tailwind-merge  class-variance-authority  lucide-react
@radix-ui/*            (only the primitives the ported shadcn components import)
zustand  zod  framer-motion  sonner
@solana/web3.js  @solana/spl-token
hash-wasm  @scure/bip39  ed25519-hd-key  qrcode  nanoid
@zxcvbn-ts/core  @zxcvbn-ts/language-common
```

devDependencies: `vite`, `@vitejs/plugin-react`, `vite-tsconfig-paths`, `nitro`,
`typescript`, `eslint` + the TENDER eslint stack, `prettier`, `@types/react`,
`@types/react-dom`, `@types/node`, `@types/qrcode`.

Scripts: `dev` (`vite dev`), `build` (`vite build`), `preview`, `lint`, `format`.

**Do not install:** `wagmi`, `viem`, `@wallet-standard/*`, `three`, `@react-three/*`,
`postprocessing`, `gsap`, `lenis`, `cannon-es`, `@lovable.dev/vite-tanstack-config`. See
`08-PORTING-MAP.md` §3.

**`vite.config.ts`** — TENDER wraps its plugins in `@lovable.dev/vite-tanstack-config`, which
Oink drops. Wire the plugins explicitly instead:

```ts
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
  ],
});
```

**`tsconfig.json`** — copy TENDER's verbatim. Target ES2022, `moduleResolution: "Bundler"`,
`strict: true`, `paths: { "@/*": ["./src/*"] }`, include `src/**/*` plus `vite.config.ts`.
It already excludes `backend/` by omission — keep it that way.

**`components.json`** — copy TENDER's, changing only `tailwind.css` to `src/styles.css`.
Style `new-york`, `cssVariables: true`, aliases `@/components`, `@/lib/utils`, `@/components/ui`.

**`src/styles.css`** — Tailwind v4 entry and the entire design system:

```css
@import "tailwindcss" source(none);
@source "../src";
@import "tw-animate-css";

@theme {
  /* Oink palette — see 06-FRONTEND-SPEC.md §11 */
  --color-base:       #ffffff;
  --color-card2:      #faf6f7;
  --color-raised:     #f2eaed;
  --color-hairline:   #e8dde1;
  --color-oink:       #ec4e7c;
  --color-oink-hover: #d83f6b;
  --color-oink-deep:  #b8325a;
  --color-blush:      #ffe4ec;
  --color-ink:        #171216;
  --color-secondary2: #5b5158;
  --color-muted2:     #9a8f95;
  --color-success:    #2fb87a;
  --color-warning:    #f5a524;
  --color-danger:     #e5484d;

  --radius: 0.75rem;

  --font-display: "Space Grotesk", sans-serif;
  --font-body:    "Inter", sans-serif;
  --font-mono:    "IBM Plex Mono", monospace;
}
```

Add the shadcn semantic tokens (`--color-background`, `--color-primary`, …) mapped onto the
Oink palette, following TENDER's `src/styles.css` structure.

**`src/router.tsx`** — copy TENDER's `getRouter()` verbatim: `createRouter` over
`routeTree.gen`, with a `QueryClient` in context.

**`src/server.ts`** and **`src/start.ts`** — copy TENDER's. `start.ts` in particular
re-installs `createCsrfMiddleware` for server functions, which Start otherwise omits once the
file exists. **Keep that CSRF middleware** — Oink's server functions carry a session cookie,
so losing it is a real vulnerability.

**`src/routes/__root.tsx`** — root document. Set `<html lang="en">`, the meta viewport, the
font links, and the security headers that cannot live in the host config. Render
`<Outlet />` and the `sonner` toaster.

**`src/routes/index.tsx`** — hello-world landing page. Oink wordmark in `--font-display`, the
one-line description under it, and a single **Create wallet** button routed to `/create`.
Match the palette; no 3D, no hero scene.

**`src/lib/utils.ts`** — the `cn` helper: `twMerge(clsx(...inputs))`.

**`.env`** and **`.env.example`** — keys from `10-ENV-AND-DEPLOY.md` §1. `.env.example` has
the same keys with empty values. `.env` is gitignored.

Copy `src/components/ui/**` from TENDER wholesale, then delete any primitive nothing imports.

---

## Step 4 — Backend scaffold (Bun + Express + PostgreSQL)

Everything under `/backend`. The backend `package.json` is self-contained — never merge it
into the root.

**`package.json`** — name `@oink/backend`, `"type": "module"`, private.
Dependencies: `express`, `cors`, `pg`, `dotenv`, `@solana/web3.js`, `@solana/spl-token`,
`bs58`, `tweetnacl`, `hash-wasm`, `cookie`, `nanoid`.
devDependencies: `@types/express`, `@types/cors`, `@types/pg`, `@types/supertest`,
`supertest`, `bun-types`, `typescript`.
Scripts: `dev` (`bun run --watch src/index.ts`), `start`, `check` (`tsc --noEmit`),
`test` (`bun test`), `migrate` (`bun run src/db/migrate.ts`).

**`tsconfig.json`** — copy TENDER's backend config. Target ES2022, `moduleResolution: "Bundler"`,
`types: ["bun-types"]`, include `src/**/*` and `tests/**/*`.

**`src/config.ts`** — env to typed config. **This is the one file where the generic guide's
advice is actively wrong for Oink.** TENDER writes `process.env.X || ""` throughout; secrets
must not do that. Split the config in two:

```ts
// Non-secret values may have defaults.
const optional = (k: string, fallback: string) => process.env[k] ?? fallback;

// Secrets may not. Fail at boot, loudly, before anything binds a port.
function requiredSecret(name: string): string {
  const raw = process.env[name];
  if (!raw || Buffer.from(raw, "base64").length < 32) {
    throw new Error(`${name} is missing or shorter than 32 bytes. Refusing to start.`);
  }
  return raw;
}
```

`DATABASE_URL`, `OINK_KMS_KEY`, `OINK_DECOY_KEY`, `OINK_SESSION_SECRET` and
`OINK_ARGON_PEPPER` go through `requiredSecret`. In development you may relax the check to a
warning, but never in production.

**`src/app.ts`** — builds and exports the Express app. No `listen()` here, so tests can import
it. Wire in order:

1. `cors({ origin: [APP_URL, ...devOrigins], credentials: true })` — an **allowlist**, never
   bare `cors()`. A credentialed cookie behind open CORS is a real vulnerability
2. `express.json({ limit: "64kb" })`
3. Security headers: HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`
4. The request logger ported from TENDER — **with the extended redaction list** from
   `02-WALLET-AND-AUTH-SPEC.md` §9: `authKey`, `totpCode`, `ciphertext`, `kdfSalt`,
   `mnemonic`, `secretPhrase`, `password`, `totpSecret`, `signature`
5. `app.use("/health", healthRouter)`
6. A 404 fallback returning the standard error envelope

Mount only `/api/v1`. There is no `/api/v2`.

**`src/index.ts`** — the only file that touches infrastructure. `import "dotenv/config"`,
validate config, `await migrate()`, then `app.listen()`.

**`src/routes/health.ts`** — `GET /health` returning
`{ status: "ok", version, network, timestamp }`.

**`src/db/index.ts`** — exports a `pg.Pool` from `DATABASE_URL`, plus a `query()` helper.
Copy TENDER's.

**`src/db/migrate.ts`** — copy TENDER's runner. On startup it:
1. Creates `schema_migrations (filename PRIMARY KEY, applied_at TIMESTAMPTZ)` if absent
2. Reads every `.sql` in `db/migrations/` in alphabetical order
3. Skips filenames already recorded
4. Runs each in a transaction, records on success, rolls back and throws on failure

**`db/migrations/001_wallets.sql`** — the wallets, enrollments, auth_challenges, sessions and
login_attempts tables, exactly as written in `03-DATA-MODEL.md`. Later migrations are created
by their own phases; do not write them now.

**`tests/health.test.ts`** — Bun test with supertest against the exported app: 200,
`status: "ok"`, a parseable ISO timestamp.

**`.env` / `.env.example`** — keys from `10-ENV-AND-DEPLOY.md` §2. Placeholders in `.env`,
empty values in `.env.example`. Generate real secrets with `openssl rand -base64 32`.

**`Dockerfile`**:

```dockerfile
FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
USER bun
CMD ["bun", "run", "start"]
```

---

## Step 5 — Crypto module skeleton

Oink-specific, and the reason this guide is not the generic one. Phase 1 of the build plan is
test-first, so the scaffold creates the files and the failing tests, not the implementations.

Create under `src/lib/crypto/`, each exporting a typed signature that throws
`new Error("not implemented")`:

| File | Exports |
| :--- | :--- |
| `mnemonic.ts` | `generateMnemonic()`, `validateMnemonic(words)`, `toEntropy(words)`, `fromEntropy(bytes)` |
| `derive.ts` | `keypairFromEntropy(entropy): Keypair` — SLIP-0010 `m/44'/501'/0'/0'` |
| `argon.ts` | `deriveMaster(password, salt, params): Promise<Uint8Array>` |
| `argon.worker.ts` | the worker that runs it off the main thread |
| `kdf.ts` | `splitKeys(master): { encKey, authKey }` — HKDF-SHA256 |
| `keystore.ts` | `seal(encKey, entropy, aad)`, `open(encKey, blob, aad)` |
| `totp-uri.ts` | `otpauthUri({ tag, secret })` |

And under `src/lib/wallet/`: `key-session.ts` with the exact surface in
`06-FRONTEND-SPEC.md` §9 — the keypair in a module-scope variable, never in a store.

Then write `src/lib/crypto/__tests__/` covering the Phase 1 acceptance criteria. **They must
fail at the end of Phase 0.** A scaffold that ships green tests over unimplemented crypto is
worse than no tests.

Pin the Argon2id parameters in one exported constant, in its own file
`src/lib/crypto/kdf-params.ts`:

```ts
export const KDF_V1 = { alg: "argon2id", v: 19, m: 65536, t: 3, p: 1, len: 32 } as const;
```

Everything else imports it; nothing else states the numbers. CI greps this file (Step 7), so
it is the single place they live.

---

## Step 6 — Root `.gitignore`

```
.env
.env.local
.env.*.local
backend/.env
node_modules/
dist/
build/
.output/
.nitro/
.tanstack/
.wrangler/
src/routeTree.gen.ts
*.pem
*.key
fee-payer*.json
keypair*.json
.DS_Store
.vercel
```

`src/routeTree.gen.ts` is generated by the router plugin; committing it creates merge
conflicts for no benefit.

**Never commit:** a keypair JSON, any `.env`, a database dump, or a real seed phrase in a test
fixture. Test vectors must use publicly known BIP39 vectors, never a phrase that has ever
held funds.

---

## Step 7 — GitHub Actions

`.github/workflows/backend.yml` — port TENDER's file, which already has the right four-job
shape (`test` → `build-push` → `release` / `deploy`), with these changes:

- Path filters on `backend/**` and the workflow file itself
- GHCR image name `ghcr.io/<org>/<repo>/backend`
- The `deploy` job stays resilient: if `RENDER_DEPLOY_HOOK_URL` is empty, log and `exit 0`;
  if curl fails, `|| echo` and continue. It must never fail the run

Add a fifth job Oink needs and TENDER does not:

```yaml
  crypto-params:
    name: Assert KDF parameters
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Argon2id parameters must match the spec
        run: |
          grep -q 'm: 65536' src/lib/crypto/kdf-params.ts
          grep -q 't: 3'     src/lib/crypto/kdf-params.ts
          grep -q 'p: 1'     src/lib/crypto/kdf-params.ts
```

Cheap insurance against someone lowering the work factor to make a test suite faster. Point
it at wherever `KDF_V1` actually lives.

A second workflow, `.github/workflows/frontend.yml`, runs `bun install`, `bun run lint` and
`bun run build` on changes outside `backend/**`.

---

## Step 8 — LICENSE

MIT. Copyright `2026 Oink`. Standard boilerplate.

---

## Step 9 — README.md

Read `docs/00-OVERVIEW.md` first. Use the product's terminology — *tag*, *election*,
*secret phrase* — not generic wallet vocabulary.

Badges:

```markdown
![CI](https://github.com/<ORG>/<REPO>/actions/workflows/backend.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.x-000000?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Solana](https://img.shields.io/badge/Solana-mainnet--beta-9945FF?logo=solana&logoColor=white)
```

Sections, in order:

- **What it does** — one precise paragraph from `00-OVERVIEW.md` §1
- **How it works** — the create / receive / elect / recover loop as a table or diagram
- **Security model** — a short, honest table: what the browser holds, what the server holds,
  what a database breach does and does not expose. This is the most interesting thing about
  the project; do not bury it
- **Repo structure** — the tree from Step 2
- **Getting started** — install, `.env` setup, migrate, dev, test
- **API** — the `/api/v1` surface, one table
- **Roadmap** — the nine phases from `09-BUILD-PLAN.md`, collapsed to one line each
- **Tech stack** — one line

Tables over prose. Keep it scannable.

---

## Step 10 — CONTRIBUTING.md

- What is wanted right now: be specific. During Phases 1-5, that is test vectors for the
  crypto module and adversarial review of the auth spec — not new features
- Out of scope: custodial features, EVM support, anything requiring an X account
- Setup: clone, `bun install` at both levels, copy both `.env.example` files, migrate
- Workflow: fork, branch, PR. One concern per PR
- **Crypto changes need an issue first.** No PR silently alters a KDF parameter, a cipher, or
  the challenge protocol
- Commit style: imperative, present tense, plain English. No AI co-author trailers
- Bug reports: what you did, what happened, what you expected, repro steps. Never paste a
  real secret phrase into an issue
- Link to SECURITY.md

---

## Step 11 — SECURITY.md

Contact: the address agreed in pre-flight #10. Acknowledge in 48h, patch critical in 7 days.
Good-faith research is not pursued; credit is given on fix.

List the attack surfaces that actually matter here, not a generic OWASP recital:

| Surface | Why it matters |
| :--- | :--- |
| **XSS in the app shell** | The decrypted key lives in browser memory. Script injection on an unlocked page is direct fund loss. This is the top risk in the product |
| **Keystore exfiltration** | A database breach yields ciphertext plus Argon2id hashes. Report anything that weakens the KDF, the AAD binding, or the `encKey` / `authKey` split |
| **Transaction substitution** | The server builds, the client signs, the server broadcasts. A path where a signed transaction differs from the built message and still broadcasts is critical |
| **Fee-payer abuse** | The sponsor keypair co-signs. Any path where it signs a transaction the server did not build, or where budget caps can be bypassed, is in scope |
| **Tag enumeration and credential oracles** | Any response difference between an unknown tag, a wrong password and a wrong TOTP code |
| **TOTP replay / recovery bypass** | Reusing a code or a recovery challenge, or reclaiming a tag without a valid signature |

Out of scope: TENDER's repository, third-party outages (Jupiter, the RPC provider), and
self-inflicted loss of the secret phrase.

Note explicitly that Oink deploys no smart contract, so there are no contract addresses to
publish.

---

## Step 12 — Commit and push

```bash
git add <files>          # explicit paths, never git add -A
git commit -m "initial project scaffold"
git push -u origin main
```

Before pushing, confirm no secret escaped:

```bash
git ls-files | grep -E '\.env$|\.env\.' ; echo "--- expect only .env.example above ---"
git log -p | grep -iE 'BEGIN PRIVATE KEY|SECRET_KEY=|[1-9A-HJ-NP-Za-km-z]{64}' || echo "clean"
```

Plain commit messages. No AI co-author trailers.

---

## Checklist

- [ ] GitHub org/repo and security contact confirmed with the human
- [ ] `docs/00-OVERVIEW.md` and `docs/02-WALLET-AND-AUTH-SPEC.md` read
- [ ] Directory structure created; **no** `contracts/` directory
- [ ] Frontend scaffolded: `package.json`, explicit `vite.config.ts` (no lovable wrapper),
      `tsconfig.json`, `components.json`, `styles.css` with the Oink palette, router,
      `server.ts`, `start.ts` **with CSRF middleware retained**, root route, landing page
- [ ] No EVM, 3D, or animation-engine dependencies installed
- [ ] `src/components/ui/**` copied from TENDER
- [ ] Backend scaffolded: `config.ts` with `requiredSecret`, `app.ts` with CORS allowlist and
      the extended redaction list, `index.ts`, health route, pool, migration runner,
      `001_wallets.sql`, health test
- [ ] Dockerfile written
- [ ] Crypto module skeleton created with **failing** Phase 1 tests
- [ ] `KDF_V1` constant is the single source of the Argon2id parameters
- [ ] `.gitignore` covers every `.env`, keypair JSON, and build artifact
- [ ] Two workflows; backend has 5 jobs including the KDF parameter check; deploy job
      survives a missing secret
- [ ] LICENSE, README with badges and a security-model section, CONTRIBUTING, SECURITY
- [ ] `git ls-files` shows no `.env`, no keypair, no secret phrase
- [ ] `bun run dev` serves the landing page; `GET /health` returns `ok` against the new database
- [ ] Committed and pushed to the **new** remote
