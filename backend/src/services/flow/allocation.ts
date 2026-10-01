import { nanoid } from "nanoid";
import type { PoolClient } from "pg";
import { allocateIncome } from "../../../../src/lib/flow/allocation";
import { baseAmount } from "../../../../src/lib/flow/amounts";
import type { FlowPayment, FlowPurchase, FlowSettings } from "../../../../src/lib/flow/types";
import { flowUsdcMint, freshUsdcBalance } from "./chain";
import { invoiceRecord } from "./invoices";
import { FlowError, inFlowTransaction, lockSettings } from "./settings";
interface PaymentRow {
  id: string; invoice_id: string; signature: string; payment_base: string; cash_base: string;
  investment_base: string; settings_snapshot: FlowSettings; created_at: Date;
}
export async function paymentResponse(client: PoolClient, row: PaymentRow): Promise<FlowPayment> {
  const purchases = await client.query<{ symbol: string; amount_base: string }>("SELECT symbol, amount_base FROM flow_purchases WHERE payment_id = $1 ORDER BY symbol", [row.id]);
  return { id: row.id, invoiceId: row.invoice_id, signature: row.signature, paymentBase: row.payment_base,
    cashBase: row.cash_base, investmentBase: row.investment_base, settingsRevision: row.settings_snapshot.revision,
    createdAt: new Date(row.created_at).toISOString(), purchases: purchases.rows.map((p): FlowPurchase => ({ symbol: p.symbol, amountBase: p.amount_base })) };
}
export async function reservedCash(client: PoolClient, accountId: string): Promise<bigint> {
  const result = await client.query<{ amount: string }>("SELECT COALESCE(SUM(p.amount_base),0)::text AS amount FROM flow_purchases p JOIN flow_payments f ON f.id = p.payment_id WHERE f.account_id = $1 AND p.state NOT IN ('confirmed','cancelled')", [accountId]);
  return BigInt(result.rows[0].amount);
}
export function previewFlowIncome(accountId: string, amount: unknown) {
  const payment = baseAmount(amount);
  return inFlowTransaction(async (client) => {
    const settings = await lockSettings(client, accountId);
    const wallet = await client.query<{ public_key: string }>("SELECT public_key FROM wallets WHERE account_id = $1", [accountId]);
    const reserved = await reservedCash(client, accountId);
    const balance = await freshUsdcBalance(wallet.rows[0].public_key, flowUsdcMint());
    if (balance < reserved) throw new FlowError("INSUFFICIENT_BACKING", "Pending investments exceed available USDC. Restore the balance before allocating more income.", 409);
    return allocateIncome(payment.toString(), (balance - reserved).toString(), settings.cashTargetBase, settings.weights);
  });
}
export function allocateFlowInvoice(accountId: string, invoiceId: string): Promise<FlowPayment> {
  return inFlowTransaction(async (client) => {
    const settings = await lockSettings(client, accountId);
    const invoice = await invoiceRecord(client, invoiceId, true);
    if (invoice.account_id !== accountId) throw new FlowError("NOT_FOUND", "Income request not found.", 404);
    const existing = await client.query<PaymentRow>("SELECT * FROM flow_payments WHERE invoice_id = $1", [invoiceId]);
    if (existing.rows[0]) return paymentResponse(client, existing.rows[0]);
    if (invoice.status !== "paid" || !invoice.signature || !invoice.receipt_slot) throw new FlowError("PAYMENT_UNVERIFIED", "Confirm the received payment before allocating it.", 409);
    const reserved = await reservedCash(client, accountId);
    const balance = await freshUsdcBalance(invoice.recipient_wallet, invoice.token_mint, Number(invoice.receipt_slot));
    const payment = BigInt(invoice.amount_base);
    if (balance < reserved + payment) throw new FlowError("INSUFFICIENT_BACKING", "The received income and pending investments are not fully backed by available USDC.", 409);
    const allocation = allocateIncome(invoice.amount_base, (balance - reserved - payment).toString(), settings.cashTargetBase, settings.weights);
    const id = `income_${nanoid(16)}`;
    const inserted = await client.query<PaymentRow>("INSERT INTO flow_payments (id, invoice_id, account_id, signature, payment_base, cash_base, investment_base, settings_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [id, invoiceId, accountId, invoice.signature, allocation.paymentBase, allocation.cashBase, allocation.investmentBase, JSON.stringify(settings)]);
    for (const purchase of allocation.purchases) await client.query("INSERT INTO flow_purchases (id, payment_id, symbol, amount_base) VALUES ($1,$2,$3,$4)", [`purchase_${nanoid(16)}`, id, purchase.symbol, purchase.amountBase]);
    return paymentResponse(client, inserted.rows[0]);
  });
}
export function listFlowPayments(accountId: string): Promise<{ payments: FlowPayment[] }> {
  return inFlowTransaction(async (client) => {
    const result = await client.query<PaymentRow>("SELECT * FROM flow_payments WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50", [accountId]);
    return { payments: await Promise.all(result.rows.map((row) => paymentResponse(client, row))) };
  });
}
