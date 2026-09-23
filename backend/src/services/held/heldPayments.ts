import type { PoolClient } from "pg";
import { getConfig } from "../../config";
import { pool, query } from "../../db";
import { recordEvent } from "../../lib/events";
import { getReleaseChain } from "./chain";
import { getHoldingProvider, type HeldIdentity } from "./provider";

/**
 * Held payments: money sent to an email or X account that has no Oink wallet yet
 * (docs/12 §5). The deposit is an ordinary sender-signed transfer into the recipient's
 * holding wallet; this module owns everything after it.
 *
 * A payment leaves `held` exactly once, through a guarded UPDATE that flips it to
 * `claiming` or `refunding`, so a claim and a refund can never both move it. A release is
 * written down (signature, blockhash expiry) before it is broadcast, so a crash mid-flight
 * is resolved by asking the chain, never by sending again: the holding wallet pools every
 * payment to that person, and a blind retry could spend someone else's money.
 */

export const MAX_RELEASE_ATTEMPTS = 5;
// A release still marked in flight after this long gets its fate looked up on chain.
const STUCK_AFTER_SECONDS = 120;

type Db = Pick<PoolClient, "query">;

/** Exact decimal string for a base-unit amount; no floating point anywhere. */
export function formatBaseUnits(amountBase: bigint | string, decimals: number): string {
  const digits = BigInt(amountBase).toString();
  if (decimals === 0) return digits;
  const padded = digits.padStart(decimals + 1, "0");
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

export interface HeldWalletRow {
  id: number;
  identity_kind: "email" | "x";
  identity_value: string;
  address: string;
  privy_wallet_id: string;
  policy_id: string;
  policy_rule_id: string;
  allowed_destinations: string[];
}

export function identityKey(identity: HeldIdentity): { kind: "email" | "x"; value: string; display: string } {
  return identity.kind === "email"
    ? { kind: "email", value: identity.email.toLowerCase(), display: identity.email.toLowerCase() }
    : { kind: "x", value: identity.userId, display: `@${identity.username}` };
}

/** The recipient's holding wallet, created through Privy the first time they are paid. */
export async function ensureHoldingWallet(identity: HeldIdentity): Promise<HeldWalletRow> {
  const key = identityKey(identity);
  const existing = await query<HeldWalletRow>(
    "SELECT * FROM held_wallets WHERE identity_kind = $1 AND identity_value = $2",
    [key.kind, key.value],
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await getHoldingProvider().createHoldingWallet(identity);
  // Two first payments racing would each create a Privy wallet; the unique key keeps one,
  // and the loser's empty wallet is simply never used.
  const inserted = await query<HeldWalletRow>(
    `INSERT INTO held_wallets (identity_kind, identity_value, identity_display, privy_user_id, privy_wallet_id, address, policy_id, policy_rule_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (identity_kind, identity_value) DO NOTHING
     RETURNING *`,
    [key.kind, key.value, key.display, created.privyUserId, created.walletId, created.address, created.policyId, created.ruleId],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  return (
    await query<HeldWalletRow>("SELECT * FROM held_wallets WHERE identity_kind = $1 AND identity_value = $2", [key.kind, key.value])
  ).rows[0];
}

/** Called after the deposit transfer confirms. */
export async function recordHeldDeposit(input: {
  heldWalletAddress: string;
  senderAccountId: string;
  senderWallet: string;
  mint: string;
  symbol: string;
  decimals: number;
  amountBase: bigint;
  signature: string;
  note?: string | null;
  db?: Db;
}): Promise<{ id: number; expiresAt: Date; recipientDisplay: string; recipientKind: "email" | "x" }> {
  const db = input.db ?? ({ query } as unknown as Db);
  const wallet = (await db.query("SELECT * FROM held_wallets WHERE address = $1", [input.heldWalletAddress])).rows[0];
  if (!wallet) throw new Error("Deposit into an address that is not a holding wallet");
  const hours = getConfig().heldPaymentHours;
  const row = (
    await db.query(
      `INSERT INTO held_payments (held_wallet_id, sender_account_id, sender_wallet, recipient_kind, recipient_value, recipient_display,
         mint, symbol, decimals, amount_base, deposit_signature, note, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW() + ($13 || ' hours')::interval)
       ON CONFLICT (deposit_signature) DO UPDATE SET updated_at = held_payments.updated_at
       RETURNING id, expires_at`,
      [
        wallet.id,
        input.senderAccountId,
        input.senderWallet,
        wallet.identity_kind,
        wallet.identity_value,
        wallet.identity_display,
        input.mint,
        input.symbol,
        input.decimals,
        input.amountBase.toString(),
        input.signature,
        input.note ?? null,
        String(hours),
      ],
    )
  ).rows[0];
  await recordEvent(
    input.senderAccountId,
    "held_sent",
    { to: wallet.identity_display, amount: input.amountBase.toString(), symbol: input.symbol, heldPaymentId: row.id },
    null,
    db,
  );
  return { id: Number(row.id), expiresAt: new Date(row.expires_at), recipientDisplay: wallet.identity_display, recipientKind: wallet.identity_kind };
}

async function allowDestination(wallet: HeldWalletRow, destination: string) {
  const current: string[] = Array.isArray(wallet.allowed_destinations) ? wallet.allowed_destinations : [];
  if (current.includes(destination)) return;
  const next = [...current, destination];
  await getHoldingProvider().setAllowedDestinations({ policyId: wallet.policy_id, ruleId: wallet.policy_rule_id }, next);
  await query("UPDATE held_wallets SET allowed_destinations = $1 WHERE id = $2", [JSON.stringify(next), wallet.id]);
  wallet.allowed_destinations = next;
}

export type ReleaseMode = "claim" | "refund";
export type ReleaseResult = "released" | "skipped" | "retry" | "failed" | "in_flight";

async function finalize(paymentId: number, mode: ReleaseMode) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const p = (
      await client.query(
        `UPDATE held_payments SET status = $2, released_at = NOW(), last_error = NULL, updated_at = NOW()
         WHERE id = $1 AND status = $3 RETURNING *`,
        [paymentId, mode === "claim" ? "claimed" : "refunded", mode === "claim" ? "claiming" : "refunding"],
      )
    ).rows[0];
    if (!p) {
      await client.query("ROLLBACK");
      return;
    }
    const wallet = (await client.query("SELECT address FROM held_wallets WHERE id = $1", [p.held_wallet_id])).rows[0];
    const recipientAccount = mode === "claim" ? p.claimant_account_id : p.sender_account_id;
    const recipientWallet =
      (await client.query("SELECT public_key FROM wallets WHERE account_id = $1", [recipientAccount])).rows[0]?.public_key ??
      p.sender_wallet;
    await client.query(
      `INSERT INTO transfers (signature, direction, sender_account_id, sender_wallet, recipient_account_id, recipient_wallet,
         input_mint, input_symbol, input_amount, output_breakdown, mix_applied, fee_sponsored, memo, source, status, confirmed_at)
       VALUES ($1, 'receive', NULL, $2, $3, $4, $5, $6, $7, '[]', FALSE, TRUE, $8, 'held', 'confirmed', NOW())
       ON CONFLICT (signature) DO NOTHING`,
      [
        p.release_signature,
        wallet.address,
        recipientAccount,
        recipientWallet,
        p.mint,
        p.symbol,
        formatBaseUnits(p.amount_base, p.decimals),
        mode === "claim" ? `Claimed from ${p.recipient_display}` : `Refund: ${p.recipient_display} did not claim in time`,
      ],
    );
    await recordEvent(
      recipientAccount,
      mode === "claim" ? "held_claimed" : "held_refunded",
      { heldPaymentId: paymentId, from: p.recipient_display, symbol: p.symbol },
      null,
      client,
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function giveBack(paymentId: number, error: string) {
  // Back to `held` for another attempt, or `failed` once attempts run out (an admin retries).
  await query(
    `UPDATE held_payments
     SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'held' END,
         claimant_account_id = CASE WHEN attempts >= $3 THEN claimant_account_id ELSE NULL END,
         release_signature = NULL, release_last_valid_height = NULL, release_to = NULL,
         last_error = $2, updated_at = NOW()
     WHERE id = $1 AND status IN ('claiming', 'refunding')`,
    [paymentId, error.slice(0, 500), MAX_RELEASE_ATTEMPTS],
  );
}

/**
 * Moves one payment out of its holding wallet: to the claimant (claim, only before expiry)
 * or back to the sender (refund, only after).
 */
export async function releaseHeldPayment(paymentId: number, mode: ReleaseMode, claimantAccountId?: string): Promise<ReleaseResult> {
  const taken = (
    await query(
      `UPDATE held_payments
       SET status = $2, attempts = attempts + 1, claimant_account_id = $3, updated_at = NOW()
       WHERE id = $1 AND status = 'held'
         AND (($2 = 'claiming' AND expires_at > NOW()) OR ($2 = 'refunding' AND expires_at <= NOW()))
       RETURNING *`,
      [paymentId, mode === "claim" ? "claiming" : "refunding", mode === "claim" ? claimantAccountId ?? null : null],
    )
  ).rows[0];
  if (!taken) return "skipped";

  let sent = false;
  try {
    const destinationOwner =
      mode === "claim"
        ? (await query("SELECT public_key FROM wallets WHERE account_id = $1", [claimantAccountId])).rows[0]?.public_key
        : taken.sender_wallet;
    if (!destinationOwner) throw new Error("Claimant wallet not found");

    const wallet = (await query<HeldWalletRow>("SELECT * FROM held_wallets WHERE id = $1", [taken.held_wallet_id])).rows[0];
    const chain = getReleaseChain();
    const destination = await chain.ensureTokenAccount(destinationOwner, taken.mint);
    await allowDestination(wallet, destination);

    const built = await chain.buildRelease({
      holdingWallet: wallet.address,
      mint: taken.mint,
      decimals: taken.decimals,
      amountBase: BigInt(taken.amount_base),
      destination,
      sign: (unsigned) => getHoldingProvider().signTransaction(wallet.privy_wallet_id, unsigned),
    });
    await query(
      `UPDATE held_payments SET release_signature = $2, release_last_valid_height = $3, release_to = $4, updated_at = NOW() WHERE id = $1`,
      [paymentId, built.signature, built.lastValidBlockHeight, destination],
    );

    sent = true;
    const result = await chain.broadcast(built.raw, built.lastValidBlockHeight);
    if (result !== "confirmed") throw new Error("Release transaction failed on chain");
    await finalize(paymentId, mode);
    return "released";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (sent) {
      // It may still land. Leave it in flight; reconcile() asks the chain before anything else.
      await query("UPDATE held_payments SET last_error = $2, updated_at = NOW() WHERE id = $1", [paymentId, message.slice(0, 500)]);
      return "in_flight";
    }
    await giveBack(paymentId, message);
    const after = (await query("SELECT status FROM held_payments WHERE id = $1", [paymentId])).rows[0];
    return after?.status === "failed" ? "failed" : "retry";
  }
}

/** Resolves releases left in flight by a crash or an unseen confirmation. */
export async function reconcileInFlight(): Promise<void> {
  const stuck = await query(
    `SELECT id, status, release_signature, release_last_valid_height FROM held_payments
     WHERE status IN ('claiming', 'refunding') AND updated_at < NOW() - ($1 || ' seconds')::interval`,
    [String(STUCK_AFTER_SECONDS)],
  );
  for (const row of stuck.rows) {
    const mode: ReleaseMode = row.status === "claiming" ? "claim" : "refund";
    if (!row.release_signature) {
      await giveBack(row.id, "Interrupted before the release was built");
      continue;
    }
    const outcome = await getReleaseChain().outcome(row.release_signature, Number(row.release_last_valid_height));
    if (outcome === "confirmed") await finalize(row.id, mode);
    else if (outcome === "failed" || outcome === "expired") await giveBack(row.id, `Release ${outcome}`);
    // pending: still in flight, look again next round
  }
}

/** Held payments this account can now claim, because it has linked their email or X account. */
export async function claimableFor(accountId: string): Promise<number[]> {
  const rows = await query(
    `SELECT hp.id FROM held_payments hp
     JOIN wallets w ON w.account_id = $1
     WHERE hp.status = 'held' AND hp.expires_at > NOW()
       AND ((hp.recipient_kind = 'email' AND hp.recipient_value = w.email)
         OR (hp.recipient_kind = 'x' AND hp.recipient_value = w.x_user_id))
     ORDER BY hp.created_at`,
    [accountId],
  );
  return rows.rows.map((r) => Number(r.id));
}

export async function claimForAccount(accountId: string): Promise<{ released: number; pending: number }> {
  let released = 0;
  let pending = 0;
  for (const id of await claimableFor(accountId)) {
    const result = await releaseHeldPayment(id, "claim", accountId);
    if (result === "released") released += 1;
    else if (result !== "skipped") pending += 1;
  }
  return { released, pending };
}

/** One pass of the worker: settle in-flight releases, deliver claims, refund what expired. */
export async function runHeldPaymentsJob(): Promise<{ claimed: number; refunded: number }> {
  await reconcileInFlight();

  let claimed = 0;
  const claimants = await query(
    `SELECT DISTINCT w.account_id FROM held_payments hp
     JOIN wallets w ON (hp.recipient_kind = 'email' AND w.email = hp.recipient_value)
                    OR (hp.recipient_kind = 'x' AND w.x_user_id = hp.recipient_value)
     WHERE hp.status = 'held' AND hp.expires_at > NOW()`,
  );
  for (const row of claimants.rows) claimed += (await claimForAccount(row.account_id)).released;

  let refunded = 0;
  const due = await query(`SELECT id FROM held_payments WHERE status = 'held' AND expires_at <= NOW() ORDER BY expires_at LIMIT 25`);
  for (const row of due.rows) if ((await releaseHeldPayment(Number(row.id), "refund")) === "released") refunded += 1;

  return { claimed, refunded };
}

let worker: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Started once at boot. Rounds never overlap. */
export function startHeldPaymentsWorker(intervalMs = 60_000) {
  if (worker) return;
  worker = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runHeldPaymentsJob();
    } catch (err) {
      console.error("Held payments job error:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }, intervalMs);
}
