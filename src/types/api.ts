/**
 * Shared result envelope for server functions that the UI must branch on.
 *
 * Throwing across the server-function boundary flattens an error to its
 * message, which loses the API's stable machine code (TAG_TAKEN,
 * INVALID_CREDENTIALS, ELECTION_INVALID …). Anything where the screen reacts to
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
  totpSecret: string;
  otpauthUri: string;
  expiresAt: string;
}

export interface EnrollCompleteResponse {
  tag: string;
  publicKey: string;
  elections: Array<{ symbol: string; mint: string; basisPoints: number; percentage: number }>;
  sessionExpiresAt: string;
  createdAt: string;
}

export interface AuthChallengeResponse {
  challengeId: string;
  kdfSalt: string;
  kdfParams: { alg: string; v: number; m: number; t: number; p: number; len: number };
  keystore: { ciphertext: string; nonce: string; cipher: "AES-256-GCM"; version: 1 };
  requiresTotp: boolean;
}

export interface AuthUnlockResponse {
  tag: string;
  publicKey: string;
  sessionExpiresAt: string;
}

export interface RecoverChallengeResponse {
  challengeId: string;
  message: string;
  expiresAt: string;
}

export interface SessionInfo {
  tag: string;
  publicKey: string;
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
  recipient: { kind: "tag" | "address"; tag?: string; wallet: string; displayName?: string };
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
  sender_tag: string | null;
  sender_wallet: string;
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
  election_applied: boolean;
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
  apply_election: boolean;
  status: string;
  signature: string | null;
  payer_wallet: string | null;
  payer_tag: string | null;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
}

export interface PublicInvoice {
  id: string;
  creatorTag: string;
  recipientWallet: string;
  amount: string;
  tokenSymbol: string;
  tokenMint: string;
  memo: string | null;
  applyElection: boolean;
  election: Array<{ symbol: string; mint: string; basisPoints: number; percentage: number }>;
  status: string;
  expiresAt: string;
  createdAt: string;
  paidAt: string | null;
  signature: string | null;
}
