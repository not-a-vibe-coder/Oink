/**
 * Server functions wrapping the Oink API.
 *
 * Everything the browser needs from api.<domain> goes through here. The handlers
 * run on the server, so the API host, the fallback logic and the HttpOnly
 * session cookie never reach the client bundle. Session-scoped calls forward the
 * inbound Cookie header; the four endpoints that mint or clear a session relay
 * the API's Set-Cookie back to the browser verbatim.
 *
 * Nothing here ever sees a private key or a mnemonic. `authKey` is the only
 * credential-adjacent value that crosses this boundary, and it is a derived
 * 256-bit value the server cannot decrypt anything with — never log it.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { OinkApiError, oinkFetch, oinkFetchRaw } from "@/server/oink-api";
import type { OinkToken, MixItem, WalletHolding } from "@/types/token";
import type {
  AdminActivityItem,
  AdminHeldPayment,
  AdminOverview,
  AdminPage,
  AdminTableRows,
  AdminTransfer,
  AuthChallengeResponse,
  AuthUnlockResponse,
  BuiltTransfer,
  DeviceSession,
  EnrollCompleteResponse,
  EnrollStartResponse,
  HeldPaymentRow,
  IdentityLinks,
  InvoiceRow,
  OinkResult,
  PublicInvoice,
  RecoverChallengeResponse,
  SessionInfo,
  SubmittedTransfer,
  TransferQuote,
  TransferRow,
} from "@/types/api";

// ── Request plumbing ───────────────────────────────────────────────────────

/** The inbound Cookie header, forwarded so the API can see oink_session. */
function inboundCookie(): string | undefined {
  try {
    return getRequestHeader("cookie");
  } catch {
    return undefined;
  }
}

/** Relay the API's session cookie to the browser untouched (stays HttpOnly). */
function relaySetCookies(setCookies: string[]): void {
  if (setCookies.length > 0) {
    setResponseHeader("set-cookie", setCookies);
  }
}

/** For reads: collapse the error envelope into a throw the query layer retries. */
async function proxy<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof OinkApiError) {
      throw new Error(err.message);
    }
    throw err;
  }
}

/** For anything the UI branches on: keep the stable machine code. */
async function guard<T>(work: () => Promise<T>): Promise<OinkResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (err) {
    if (err instanceof OinkApiError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return {
      ok: false,
      code: "UNREACHABLE",
      message: "Oink could not reach the network. Check your connection and try again.",
    };
  }
}

// ── Schemas shared across enrollment and recovery ──────────────────────────

const keystoreSchema = z.object({
  ciphertext: z.string().min(1),
  nonce: z.string().min(1),
  kdfSalt: z.string().min(1),
  kdfParams: z.object({
    alg: z.string(),
    v: z.number(),
    m: z.number(),
    t: z.number(),
    p: z.number(),
    len: z.number(),
  }),
  cipher: z.literal("AES-256-GCM"),
  version: z.literal(1),
});

const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code.");

// ── Enrollment ─────────────────────────────────────────────────────────────

export const enrollStart = createServerFn({ method: "POST" }).handler(() =>
  guard(() => oinkFetch<EnrollStartResponse>("/api/v1/enroll/start", { method: "POST", body: {} })),
);

export const enrollVerifyTotp = createServerFn({ method: "POST" })
  .validator(z.object({ enrollmentId: z.string().min(1), totpCode: totpCodeSchema }))
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<{ valid: boolean }>("/api/v1/enroll/verify-totp", { method: "POST", body: data }),
    ),
  );

export const enrollComplete = createServerFn({ method: "POST" })
  .validator(
    z.object({
      enrollmentId: z.string().min(1),
      publicKey: z.string().trim().min(32),
      keystore: keystoreSchema,
      authKey: z.string().min(1),
      totpCode: totpCodeSchema,
    }),
  )
  .handler(({ data }) =>
    guard(async () => {
      const { data: body, setCookies } = await oinkFetchRaw<EnrollCompleteResponse>(
        "/api/v1/enroll/complete",
        { method: "POST", body: data },
      );
      relaySetCookies(setCookies);
      return body;
    }),
  );

// ── Authentication ─────────────────────────────────────────────────────────

/** `identifier` is a tag or an account ID; the API tells them apart. */
export const authChallenge = createServerFn({ method: "POST" })
  .validator(z.object({ identifier: z.string().trim().min(1) }))
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<AuthChallengeResponse>("/api/v1/auth/challenge", { method: "POST", body: data }),
    ),
  );

export const authUnlock = createServerFn({ method: "POST" })
  .validator(
    z.object({
      challengeId: z.string().min(1),
      authKey: z.string().min(1),
      totpCode: totpCodeSchema,
    }),
  )
  .handler(({ data }) =>
    guard(async () => {
      const { data: body, setCookies } = await oinkFetchRaw<AuthUnlockResponse>(
        "/api/v1/auth/unlock",
        { method: "POST", body: data },
      );
      relaySetCookies(setCookies);
      return body;
    }),
  );

export const authLogout = createServerFn({ method: "POST" }).handler(() =>
  guard(async () => {
    const { setCookies } = await oinkFetchRaw<Record<string, never>>("/api/v1/auth/logout", {
      method: "POST",
      cookie: inboundCookie(),
    });
    relaySetCookies(setCookies);
    return { loggedOut: true };
  }),
);

export const getSession = createServerFn({ method: "GET" }).handler(() =>
  proxy(() => oinkFetch<SessionInfo>("/api/v1/auth/session", { cookie: inboundCookie() })),
);

export const listSessions = createServerFn({ method: "GET" }).handler(() =>
  proxy(() =>
    oinkFetch<{ sessions: DeviceSession[] }>("/api/v1/auth/sessions", { cookie: inboundCookie() }),
  ),
);

export const revokeSession = createServerFn({ method: "POST" })
  .validator(z.object({ tokenHashPrefix: z.string().trim().min(4) }))
  .handler(({ data }) =>
    guard(async () => {
      const { setCookies } = await oinkFetchRaw<Record<string, never>>(
        `/api/v1/auth/sessions/${encodeURIComponent(data.tokenHashPrefix)}`,
        { method: "DELETE", cookie: inboundCookie() },
      );
      relaySetCookies(setCookies);
      return { revoked: true };
    }),
  );

export const recoverChallenge = createServerFn({ method: "POST" })
  .validator(z.object({ identifier: z.string().trim().min(1) }))
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<RecoverChallengeResponse>("/api/v1/auth/recover/challenge", {
        method: "POST",
        body: data,
      }),
    ),
  );

export const recoverComplete = createServerFn({ method: "POST" })
  .validator(
    z.object({
      challengeId: z.string().min(1),
      signature: z.string().min(1),
      publicKey: z.string().trim().min(32),
      keystore: keystoreSchema,
      authKey: z.string().min(1),
      totpEnrollmentId: z.string().min(1),
      totpCode: totpCodeSchema,
    }),
  )
  .handler(({ data }) =>
    guard(async () => {
      const { data: body, setCookies } = await oinkFetchRaw<AuthUnlockResponse>(
        "/api/v1/auth/recover/complete",
        { method: "POST", body: data },
      );
      relaySetCookies(setCookies);
      return body;
    }),
  );

export const rotateKeystore = createServerFn({ method: "POST" })
  .validator(
    z.object({
      oldAuthKey: z.string().min(1),
      totpCode: totpCodeSchema,
      keystore: keystoreSchema,
      newAuthKey: z.string().min(1),
    }),
  )
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<{ rotatedAt: string }>("/api/v1/auth/rotate-keystore", {
        method: "POST",
        body: data,
        cookie: inboundCookie(),
      }),
    ),
  );

export const revealKeystore = createServerFn({ method: "POST" })
  .validator(z.object({ authKey: z.string().min(1), totpCode: totpCodeSchema }))
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<{
        keystore: { ciphertext: string; nonce: string; cipher: "AES-256-GCM"; version: 1 };
        kdfSalt: string;
        kdfParams: { alg: string; v: number; m: number; t: number; p: number; len: number };
        publicKey?: string;
      }>("/api/v1/auth/reveal-keystore", {
        method: "POST",
        body: data,
        cookie: inboundCookie(),
      }),
    ),
  );

// ── Asset registry ─────────────────────────────────────────────────────────

export const getAssets = createServerFn({ method: "GET" })
  .validator(
    z.object({
      search: z.string().trim().optional(),
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
  )
  .handler(({ data }) =>
    proxy(() =>
      oinkFetch<{ assets: OinkToken[]; total: number; limit: number; offset: number }>(
        "/api/v1/assets",
        {
          query: {
            search: data.search || undefined,
            limit: data.limit,
            offset: data.offset,
          },
        },
      ),
    ),
  );

export const getFeaturedAssets = createServerFn({ method: "GET" }).handler(() =>
  proxy(() =>
    oinkFetch<{ baseCurrencies: OinkToken[]; featured: OinkToken[]; count: number }>(
      "/api/v1/assets",
      { query: { featured: "true" } },
    ),
  ),
);

export const getAsset = createServerFn({ method: "GET" })
  .validator(z.object({ symbolOrMint: z.string().trim().min(1) }))
  .handler(({ data }) =>
    proxy(() => oinkFetch<OinkToken>(`/api/v1/assets/${encodeURIComponent(data.symbolOrMint)}`)),
  );

export const getAssetPrices = createServerFn({ method: "GET" })
  .validator(z.object({ mints: z.array(z.string()).min(1) }))
  .handler(({ data }) =>
    proxy(() =>
      oinkFetch<{ prices: Record<string, string> }>("/api/v1/assets/prices", {
        query: { mints: data.mints.join(",") },
      }),
    ),
  );

// ── Tags and profiles ──────────────────────────────────────────────────────

export const getTagProfile = createServerFn({ method: "GET" })
  .validator(z.object({ identifier: z.string().trim().min(1) }))
  .handler(({ data }) =>
    proxy(() =>
      oinkFetch<{
        accountId: string;
        tag: string | null;
        publicKey: string;
        displayName: string;
        avatarSeed: string;
        acceptsMix: boolean;
        mix: MixItem[];
        createdAt: string;
      }>(`/api/v1/tags/${encodeURIComponent(data.identifier)}`),
    ),
  );

export const resolveTags = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().trim().min(1) }))
  .handler(({ data }) =>
    proxy(() =>
      oinkFetch<{
        results: Array<{ accountId: string; tag: string; displayName: string; avatarSeed: string }>;
      }>(
        "/api/v1/tags/resolve",
        { query: { q: data.q }, cookie: inboundCookie() },
      ),
    ),
  );

// ── Mix ──────────────────────────────────────────────────────────────

export const getMix = createServerFn({ method: "GET" })
  .validator(z.object({ identifier: z.string().trim().min(1) }))
  .handler(({ data }) =>
    proxy(() =>
      oinkFetch<{ mix: MixItem[] }>(`/api/v1/mix/${encodeURIComponent(data.identifier)}`),
    ),
  );

export const saveMix = createServerFn({ method: "POST" })
  .validator(
    z.object({
      mix: z
        .array(
          z.object({
            symbol: z.string().trim(),
            mint: z.string().trim().min(32),
            basisPoints: z.number().int().min(1).max(10000),
          }),
        )
        .min(1)
        .max(10),
    }),
  )
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<{ mix: MixItem[]; revisionId: string }>("/api/v1/mix", {
        method: "PUT",
        body: data,
        cookie: inboundCookie(),
      }),
    ),
  );

// ── Wallet ─────────────────────────────────────────────────────────────────

export const getWallet = createServerFn({ method: "GET" }).handler(() =>
  proxy(() =>
    oinkFetch<{
      accountId: string;
      publicKey: string;
      solBalance: string;
      totalValueUsd: string | null;
      holdings: WalletHolding[];
      needsSol: boolean;
    }>("/api/v1/wallet", { cookie: inboundCookie() }),
  ),
);

export const getWalletAddress = createServerFn({ method: "GET" }).handler(() =>
  proxy(() =>
    oinkFetch<{ publicKey: string; solanaPayUri: string; explorerUrl: string }>(
      "/api/v1/wallet/address",
      { cookie: inboundCookie() },
    ),
  ),
);

// ── Transfers ──────────────────────────────────────────────────────────────

export const quoteTransfer = createServerFn({ method: "POST" })
  .validator(
    z.object({
      recipient: z.string().trim().min(1),
      fromSymbolOrMint: z.string().trim().min(1),
      amountIn: z.string().trim().min(1),
      applyMix: z.boolean().optional(),
      slippageBps: z.number().int().min(10).max(500).optional(),
    }),
  )
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<TransferQuote>("/api/v1/transfer/quote", {
        method: "POST",
        body: data,
        cookie: inboundCookie(),
      }),
    ),
  );

export const buildTransfer = createServerFn({ method: "POST" })
  .validator(z.object({ quoteId: z.string().trim().min(1), sponsorFee: z.boolean().optional() }))
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<BuiltTransfer>("/api/v1/transfer/build", {
        method: "POST",
        body: data,
        cookie: inboundCookie(),
      }),
    ),
  );

export const submitTransfer = createServerFn({ method: "POST" })
  .validator(
    z.object({ quoteId: z.string().trim().min(1), signedTransaction: z.string().trim().min(1) }),
  )
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<SubmittedTransfer>("/api/v1/transfer/submit", {
        method: "POST",
        body: data,
        cookie: inboundCookie(),
      }),
    ),
  );

export const getTransferHistory = createServerFn({ method: "GET" })
  .validator(
    z.object({
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
  )
  .handler(({ data }) =>
    proxy(() =>
      oinkFetch<{ transfers: TransferRow[]; total: number; limit: number; offset: number }>(
        "/api/v1/transfer/history",
        { query: { limit: data.limit, offset: data.offset }, cookie: inboundCookie() },
      ),
    ),
  );

export const getTransferReceipt = createServerFn({ method: "GET" })
  .validator(z.object({ signature: z.string().trim().min(1) }))
  .handler(({ data }) =>
    proxy(() =>
      oinkFetch<TransferRow>(`/api/v1/transfer/${encodeURIComponent(data.signature)}`, {
        cookie: inboundCookie(),
      }),
    ),
  );

// ── Invoices ───────────────────────────────────────────────────────────────

export const createInvoice = createServerFn({ method: "POST" })
  .validator(
    z.object({
      amount: z.string().trim().min(1),
      tokenSymbol: z.string().trim().optional(),
      memo: z.string().trim().max(140).optional(),
      applyMix: z.boolean().optional(),
      expiresInHours: z.number().int().positive().max(720).optional(),
    }),
  )
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<{ id: string; payUrl: string; solanaPayUri: string; expiresAt: string }>(
        "/api/v1/invoices",
        { method: "POST", body: data, cookie: inboundCookie() },
      ),
    ),
  );

export const listInvoices = createServerFn({ method: "GET" }).handler(() =>
  proxy(() =>
    oinkFetch<{ invoices: InvoiceRow[] }>("/api/v1/invoices", { cookie: inboundCookie() }),
  ),
);

export const getInvoice = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().trim().min(1) }))
  .handler(({ data }) =>
    proxy(() => oinkFetch<PublicInvoice>(`/api/v1/invoices/${encodeURIComponent(data.id)}`)),
  );

export const cancelInvoice = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().trim().min(1) }))
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<{ id: string; status: string }>(
        `/api/v1/invoices/${encodeURIComponent(data.id)}/cancel`,
        { method: "POST", cookie: inboundCookie() },
      ),
    ),
  );

export const confirmInvoice = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().trim().min(1),
      signature: z.string().trim().min(1),
      payerWallet: z.string().trim().optional(),
    }),
  )
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<{ id: string; status: string }>(
        `/api/v1/invoices/${encodeURIComponent(data.id)}/confirm`,
        {
          method: "POST",
          body: {
            signature: data.signature,
            payerWallet: data.payerWallet,
          },
        },
      ),
    ),
  );

// ── Linked identities ──────────────────────────────────────────────────────
// The identity token is Privy's proof that the browser just completed an email code or
// X OAuth. It is a bearer credential for an hour, so it goes straight to the API and is
// never stored or logged.

export const getIdentityLinks = createServerFn({ method: "GET" }).handler(() =>
  proxy(() => oinkFetch<IdentityLinks>("/api/v1/identity", { cookie: inboundCookie() })),
);

export const linkIdentity = createServerFn({ method: "POST" })
  .validator(z.object({ kind: z.enum(["email", "x"]), identityToken: z.string().min(20).max(8192) }))
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<IdentityLinks & { tagOutcome?: "assigned" | "kept" | "invalid" | "reserved"; claiming?: number }>(
        `/api/v1/identity/${data.kind}`,
        { method: "POST", body: { identityToken: data.identityToken }, cookie: inboundCookie() },
      ),
    ),
  );

export const unlinkIdentity = createServerFn({ method: "POST" })
  .validator(z.object({ kind: z.enum(["email", "x"]) }))
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<IdentityLinks>(`/api/v1/identity/${data.kind}`, { method: "DELETE", cookie: inboundCookie() }),
    ),
  );

// ── Admin ──────────────────────────────────────────────────────────────────
// The oink_admin cookie is minted and cleared by the API and relayed like the wallet
// session cookie; it never grants wallet access, and a wallet session never grants this.

export const adminLogin = createServerFn({ method: "POST" })
  .validator(z.object({ identityToken: z.string().min(20).max(8192) }))
  .handler(({ data }) =>
    guard(async () => {
      const { data: body, setCookies } = await oinkFetchRaw<{ email: string; expiresAt: string }>(
        "/api/v1/admin/login",
        { method: "POST", body: data },
      );
      relaySetCookies(setCookies);
      return body;
    }),
  );

export const adminLogout = createServerFn({ method: "POST" }).handler(() =>
  guard(async () => {
    const { setCookies } = await oinkFetchRaw<Record<string, never>>("/api/v1/admin/logout", {
      method: "POST",
      cookie: inboundCookie(),
    });
    relaySetCookies(setCookies);
    return { loggedOut: true };
  }),
);

export const adminMe = createServerFn({ method: "GET" }).handler(() =>
  guard(() => oinkFetch<{ email: string }>("/api/v1/admin/me", { cookie: inboundCookie() })),
);

export const adminOverview = createServerFn({ method: "GET" }).handler(() =>
  proxy(() => oinkFetch<AdminOverview>("/api/v1/admin/overview", { cookie: inboundCookie() })),
);

const pageSchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export const adminTransfers = createServerFn({ method: "GET" })
  .validator(pageSchema.extend({ status: z.string().trim().optional(), q: z.string().trim().max(128).optional() }))
  .handler(({ data }) =>
    proxy(() =>
      oinkFetch<AdminPage & { transfers: AdminTransfer[] }>("/api/v1/admin/transfers", {
        query: data,
        cookie: inboundCookie(),
      }),
    ),
  );

export const adminActivity = createServerFn({ method: "GET" })
  .validator(pageSchema.extend({ filter: z.enum(["all", "unreviewed", "flagged", "failures"]).optional() }))
  .handler(({ data }) =>
    proxy(() =>
      oinkFetch<AdminPage & { items: AdminActivityItem[] }>("/api/v1/admin/activity", {
        query: data,
        cookie: inboundCookie(),
      }),
    ),
  );

export const adminReview = createServerFn({ method: "POST" })
  .validator(
    z.object({
      source: z.enum(["event", "login", "transfer"]),
      sourceId: z.number().int(),
      status: z.enum(["reviewed", "flagged", "clear"]),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<{ status: string }>("/api/v1/admin/reviews", { method: "POST", body: data, cookie: inboundCookie() }),
    ),
  );

export const adminTables = createServerFn({ method: "GET" }).handler(() =>
  proxy(() =>
    oinkFetch<{ tables: Array<{ name: string; approx_rows: number }> }>("/api/v1/admin/tables", {
      cookie: inboundCookie(),
    }),
  ),
);

export const adminTable = createServerFn({ method: "GET" })
  .validator(pageSchema.extend({ name: z.string().regex(/^[a-z_]+$/) }))
  .handler(({ data }) =>
    proxy(() =>
      oinkFetch<AdminTableRows>(`/api/v1/admin/tables/${data.name}`, {
        query: { limit: data.limit, offset: data.offset },
        cookie: inboundCookie(),
      }),
    ),
  );

// ── Held payments ──────────────────────────────────────────────────────────

export const getHeldPayments = createServerFn({ method: "GET" }).handler(() =>
  proxy(() =>
    oinkFetch<{ sent: HeldPaymentRow[]; incoming: HeldPaymentRow[] }>("/api/v1/held", { cookie: inboundCookie() }),
  ),
);

export const adminHeld = createServerFn({ method: "GET" })
  .validator(pageSchema.extend({ status: z.string().trim().optional() }))
  .handler(({ data }) =>
    proxy(() =>
      oinkFetch<
        AdminPage & {
          held: AdminHeldPayment[];
          pending: Array<{ symbol: string; payments: number; amount_base: string; decimals: number }>;
        }
      >("/api/v1/admin/held", { query: data, cookie: inboundCookie() }),
    ),
  );

export const adminHeldRetry = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number().int() }))
  .handler(({ data }) =>
    guard(() =>
      oinkFetch<{ id: number; status: string }>(`/api/v1/admin/held/${data.id}/retry`, {
        method: "POST",
        cookie: inboundCookie(),
      }),
    ),
  );
