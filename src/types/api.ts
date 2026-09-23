/**
 * Shared result envelope for server functions that the UI must branch on.
 *
 * Throwing across the server-function boundary flattens an error to its
 * message, which loses the API's stable machine code (WALLET_EXISTS,
 * INVALID_CREDENTIALS, MIX_INVALID …). Anything where the screen reacts to
 * the *code* — enrollment, unlock, recovery, transfers — returns this instead.
 * Plain reads still throw, because the only handling they get is a retry.
 */
export type OinkResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface KeystoreBlobPayload {
  ciphertext: string;
  nonce: string;
  kdfSalt: string;
  kdfParams: { alg: string; v: number; m: number; t: number; p: number; len: number };
  cipher: "AES-256-GCM";
  version: 1;
}

export interface EnrollStartResponse {
  enrollmentId: string;
  /** Permanent; the keystore AAD binds it, so it exists before anything is sealed. */
  accountId: string;
  totpSecret: string;
  otpauthUri: string;
  expiresAt: string;
}

export interface EnrollCompleteResponse {
  accountId: string;
  tag: string | null;
  publicKey: string;
  mix: Array<{ symbol: string; mint: string; basisPoints: number; percentage: number }>;
  sessionExpiresAt: string;
  createdAt: string;
}

export interface AuthChallengeResponse {
  challengeId: string;
  accountId: string;
  kdfSalt: string;
  kdfParams: { alg: string; v: number; m: number; t: number; p: number; len: number };
  keystore: { ciphertext: string; nonce: string; cipher: "AES-256-GCM"; version: 1 };
  requiresTotp: boolean;
}

export interface AuthUnlockResponse {
  accountId: string;
  tag: string | null;
  publicKey: string;
  sessionExpiresAt: string;
}

export interface RecoverChallengeResponse {
  challengeId: string;
  accountId: string;
  message: string;
  expiresAt: string;
}

export interface SessionInfo {
  accountId: string;
  tag: string | null;
  publicKey: string;
  email: string | null;
  xUsername: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface DeviceSession {
  tokenHashPrefix: string;
  userAgent: string | null;
  ipHash: string | null;
  lastUsedAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface QuoteLeg {
  symbol: string;
  mint: string;
  basisPoints: number;
  inAmount: string;
  outAmount: string;
  outAmountFormatted: string;
  priceImpactPct: number;
  route: "direct" | "jupiter";
  safeSettled: boolean;
}

export interface TransferQuote {
  recipient: {
    kind: "account" | "address";
    accountId?: string;
    tag?: string | null;
    wallet: string;
    displayName?: string;
  };
  inputToken: { symbol: string; mint: string; decimals: number };
  totalIn: string;
  legs: QuoteLeg[];
  networkFeeLamports: number;
  sponsorship: { available: boolean; remainingToday: number };
  quoteId: string;
  expiresAt: string;
}

export interface BuiltTransfer {
  transaction: string;
  feePayer: string;
  partiallySigned: boolean;
  lastValidBlockHeight: number;
  addressLookupTableAddresses: string[];
}

export interface SubmittedTransfer {
  signature: string;
  status: string;
  explorerUrl: string;
  transferId: number;
}

export interface TransferRow {
  id: number;
  signature: string;
  direction: string;
  sender_account_id: string | null;
  sender_tag: string | null;
  sender_wallet: string;
  recipient_account_id: string | null;
  recipient_tag: string | null;
  recipient_wallet: string;
  input_mint: string;
  input_symbol: string;
  input_amount: string;
  output_breakdown: Array<{
    symbol: string;
    mint?: string;
    amount?: string;
    outAmount?: string;
    basisPoints?: number;
    safeSettled?: boolean;
  }> | null;
  mix_applied: boolean;
  fee_sponsored: boolean;
  memo: string | null;
  status: string;
  confirmed_at: string | null;
  created_at: string;
  isOutgoing: boolean;
}

export interface InvoiceRow {
  id: string;
  amount: string;
  token_symbol: string;
  token_mint: string;
  memo: string | null;
  apply_mix: boolean;
  status: string;
  signature: string | null;
  payer_wallet: string | null;
  payer_account_id: string | null;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
}

export interface PublicInvoice {
  id: string;
  creatorAccountId: string;
  creatorTag: string | null;
  recipientWallet: string;
  amount: string;
  tokenSymbol: string;
  tokenMint: string;
  memo: string | null;
  applyMix: boolean;
  mix: Array<{ symbol: string; mint: string; basisPoints: number; percentage: number }>;
  status: string;
  expiresAt: string;
  createdAt: string;
  paidAt: string | null;
  signature: string | null;
}

export interface IdentityLinks {
  /** False until Privy keys are set on the API; the UI then says linking isn't on yet. */
  configured: boolean;
  tag: string | null;
  email: string | null;
  emailLinkedAt: string | null;
  x: { username: string; linkedAt: string } | null;
}

/** Whatever Postgres hands back as JSON; `unknown` will not cross a server function. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface AdminPage {
  total: number;
  limit: number;
  offset: number;
}

export interface AdminOverview {
  wallets: number;
  wallets_24h: number;
  tagged: number;
  emails_linked: number;
  x_linked: number;
  transfers: number;
  transfers_24h: number;
  transfers_failed: number;
  failed_logins_24h: number;
  flagged: number;
  sponsored_lamports_today: string;
  feePayer: string | null;
  feePayerSol: string | null;
}

export interface AdminTransfer {
  id: number;
  signature: string;
  direction: string;
  source: string;
  status: string;
  input_symbol: string;
  input_amount: string;
  output_breakdown: Array<{ symbol: string; outAmountFormatted?: string; basisPoints?: number }> | null;
  mix_applied: boolean;
  fee_sponsored: boolean;
  sender_account_id: string | null;
  sender_tag: string | null;
  sender_wallet: string;
  recipient_account_id: string | null;
  recipient_tag: string | null;
  recipient_wallet: string;
  created_at: string;
  confirmed_at: string | null;
  review_status: "reviewed" | "flagged" | null;
  review_note: string | null;
}

export interface AdminActivityItem {
  source: "event" | "login";
  id: number;
  account_id: string | null;
  tag: string | null;
  kind: string;
  detail: { [key: string]: Json };
  ip: string | null;
  succeeded: boolean | null;
  created_at: string;
  review_status: "reviewed" | "flagged" | null;
  review_note: string | null;
  reviewed_by: string | null;
}

export interface AdminTableRows {
  table: string;
  columns: string[];
  hiddenColumns: string[];
  rows: Array<{ [column: string]: Json }>;
  total: number;
  limit: number;
  offset: number;
}
