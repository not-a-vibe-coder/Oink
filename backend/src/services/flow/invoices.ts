import { Keypair } from "@solana/web3.js";
import { nanoid } from "nanoid";
import type { PoolClient } from "pg";
import { getConfig } from "../../config";
import { baseAmount, displayUsdc } from "../../../../src/lib/flow/amounts";
import type { FlowInvoice } from "../../../../src/lib/flow/types";
import { flowUsdcMint, verifyIncome } from "./chain";
import { FlowError, inFlowTransaction } from "./settings";
export interface InvoiceRecord {
  id: string;
  account_id: string;
  recipient_wallet: string;
  amount_base: string;
  token_mint: string;
  reference: string;
  signature: string | null;
  receipt_slot: string | null;
  status: FlowInvoice["status"];
  created_at: Date;
  expires_at: Date;
}
export async function invoiceRecord(
  client: PoolClient,
  id: string,
  lock = false,
): Promise<InvoiceRecord> {
  const result = await client.query<InvoiceRecord>(
    `SELECT * FROM flow_invoices WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  if (!result.rows[0]) throw new FlowError("NOT_FOUND", "Income request not found.", 404);
  return result.rows[0];
}
export function publicFlowInvoice(row: InvoiceRecord): FlowInvoice {
  const params = new URLSearchParams({
    amount: displayUsdc(row.amount_base),
    "spl-token": row.token_mint,
    reference: row.reference,
    label: "Oink income",
  });
  return {
    id: row.id,
    amountBase: row.amount_base,
    recipientWallet: row.recipient_wallet,
    reference: row.reference,
    status:
      row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now()
        ? "expired"
        : row.status,
    payUrl: `${getConfig().appUrl.replace(/\/+$/, "")}/income/${row.id}`,
    solanaPayUri: `solana:${row.recipient_wallet}?${params}`,
  };
}
export function createFlowInvoice(accountId: string, amount: unknown): Promise<FlowInvoice> {
  const amountBase = baseAmount(amount).toString();
  if (BigInt(amountBase) > (1n << 64n) - 1n)
    throw new FlowError("VALIDATION_FAILED", "Amount is larger than the SPL transfer limit.");
  if (amountBase === "0")
    throw new FlowError("VALIDATION_FAILED", "Income amount must be positive.");
  const mint = flowUsdcMint();
  return inFlowTransaction(async (client) => {
    const wallet = await client.query<{ public_key: string }>(
      "SELECT public_key FROM wallets WHERE account_id = $1 AND status = 'active'",
      [accountId],
    );
    if (!wallet.rows[0]) throw new FlowError("NOT_FOUND", "Active wallet not found.", 404);
    const id = `flow_${nanoid(16)}`;
    // Only the random public reference is retained; this keypair never holds funds.
    const reference = Keypair.generate().publicKey.toBase58();
    await client.query(
      "INSERT INTO flow_invoices (id, account_id, recipient_wallet, amount_base, token_mint, reference, expires_at) VALUES ($1,$2,$3,$4,$5,$6,NOW() + INTERVAL '72 hours')",
      [id, accountId, wallet.rows[0].public_key, amountBase, mint, reference],
    );
    return publicFlowInvoice(await invoiceRecord(client, id));
  });
}
export function getFlowInvoice(id: string): Promise<FlowInvoice> {
  return inFlowTransaction(async (client) => publicFlowInvoice(await invoiceRecord(client, id)));
}
export async function confirmFlowInvoice(
  id: string,
  signature: unknown,
): Promise<{ status: "paid"; signature: string }> {
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature))
    throw new FlowError("VALIDATION_FAILED", "Provide a valid transaction signature.");
  const expected = await inFlowTransaction((client) => invoiceRecord(client, id));
  if (expected.signature) {
    if (expected.signature !== signature)
      throw new FlowError("CONFLICT", "This request already has a different payment.", 409);
    return { status: "paid", signature };
  }
  const slot = await verifyIncome(signature, expected);
  return inFlowTransaction(async (client) => {
    const current = await invoiceRecord(client, id, true);
    if (current.signature && current.signature !== signature)
      throw new FlowError("CONFLICT", "This request already has a different payment.", 409);
    await client.query(
      "UPDATE flow_invoices SET status = 'paid', signature = $2, receipt_slot = $3, received_at = COALESCE(received_at, NOW()) WHERE id = $1",
      [id, signature, slot],
    );
    return { status: "paid", signature };
  });
}
