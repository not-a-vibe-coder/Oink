/**
 * Solana Pay transaction requests: how a payment from *any* wallet settles into a mix
 * (docs/05 §5.3, second flavour).
 *
 * A plain address QR can only move tokens; the swap into the recipient's mix has to be in
 * the transaction the payer signs, and only Oink can build that. So the Receive QR encodes
 * `solana:<this URL>`. Phantom, Solflare or Backpack GET it for a label, POST the payer's
 * public key, and get back a transaction that swaps the payer's USDC into the recipient's
 * mix and delivers each leg to the recipient's token accounts. The payer signs and sends it
 * from their own wallet.
 *
 * No Oink key signs here. The payer is the fee payer (sponsorship is for Oink users, not
 * for arbitrary wallets that can hit a public endpoint), and the recipient signs nothing.
 *
 * Public by necessity: wallets call it without a session, and the Solana Pay spec requires
 * a permissive CORS origin, which is set where this router is mounted.
 */
import { Router, type Request, type Response } from "express";
import { PublicKey } from "@solana/web3.js";
import { query } from "../db";
import { identifierLookup, parseIdentifier } from "../lib/accountId";
import { resolveSolanaToken } from "../lib/tokens";
import { ipRateLimiter } from "../middleware/rateLimit";
import { calculateMixQuotes, type MixLeg } from "../services/mixEngine";
import { buildSettlementTransaction } from "../services/txBuilder";

export const payRouter = Router();

const AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,9})?$/;
// Wallets require an absolute PNG/SVG/WebP URL for the label icon.
const icon = () => `${(process.env.APP_URL || "").replace(/\/+$/, "")}/nav/wallet.png`;

async function findRecipient(raw: string) {
  const id = parseIdentifier(raw);
  if (!id) return undefined;
  const lookup = identifierLookup(id);
  const result = await query(
    `SELECT account_id, tag, public_key FROM wallets WHERE ${lookup.where} AND status = 'active'`,
    [lookup.value],
  );
  return result.rows[0] as { account_id: string; tag: string | null; public_key: string } | undefined;
}

function nameOf(recipient: { tag: string | null; account_id: string }) {
  return recipient.tag ? `@${recipient.tag}` : recipient.account_id;
}

// GET — the wallet shows this label before asking the payer to connect.
payRouter.get("/:identifier", async (req: Request, res: Response) => {
  try {
    const recipient = await findRecipient(String(req.params.identifier));
    if (!recipient) {
      res.status(404).json({ error: "NOT_FOUND", message: "No Oink wallet by that name.", details: null });
      return;
    }
    res.status(200).json({ label: `Pay ${nameOf(recipient)} on Oink`, icon: icon() });
  } catch (err) {
    console.error("Pay label error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Could not load this payment.", details: null });
  }
});

// POST — { account } in, { transaction, message } out.
payRouter.post("/:identifier", ipRateLimiter("pay_request", 60, 3600), async (req: Request, res: Response) => {
  const account = String(req.body?.account ?? "");
  const amount = String(req.query.amount ?? "");
  const token = resolveSolanaToken(String(req.query.token ?? "USDC"));

  let payer: PublicKey;
  try {
    payer = new PublicKey(account);
  } catch {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "account must be a Solana public key.", details: null });
    return;
  }
  if (!AMOUNT_PATTERN.test(amount) || Number(amount) <= 0) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "This payment link has no valid amount.", details: null });
    return;
  }
  if (!token || token.isNative) {
    res.status(400).json({ error: "VALIDATION_FAILED", message: "Pay with a supported token such as USDC.", details: null });
    return;
  }

  try {
    const recipient = await findRecipient(String(req.params.identifier));
    if (!recipient) {
      res.status(404).json({ error: "NOT_FOUND", message: "No Oink wallet by that name.", details: null });
      return;
    }
    if (recipient.public_key === payer.toBase58()) {
      res.status(400).json({ error: "VALIDATION_FAILED", message: "That's the recipient's own wallet.", details: null });
      return;
    }

    const mixRes = await query(
      "SELECT asset_symbol, asset_mint, basis_points FROM mixes WHERE account_id = $1 AND is_active = true",
      [recipient.account_id],
    );
    const mix: MixLeg[] = mixRes.rows.map((row) => ({
      symbol: row.asset_symbol,
      mint: row.asset_mint,
      basisPoints: row.basis_points,
    }));

    const quote = await calculateMixQuotes({
      senderWallet: payer.toBase58(),
      recipient: {
        kind: "account",
        accountId: recipient.account_id,
        tag: recipient.tag,
        wallet: recipient.public_key,
        displayName: nameOf(recipient),
      },
      fromSymbolOrMint: token.mint,
      amountInFormatted: amount,
      mix,
      applyMix: mix.length > 0,
    });

    const plan = await buildSettlementTransaction({ quote, sponsorFee: false });

    const split =
      mix.length > 0
        ? ` — settles into ${mix.map((leg) => `${leg.basisPoints / 100}% ${leg.symbol}`).join(" / ")}`
        : "";
    res.status(200).json({
      transaction: plan.transaction,
      message: `${amount} ${token.symbol} to ${nameOf(recipient)}${split}`,
    });
  } catch (err: any) {
    console.error("Pay request build error:", err);
    res.status(502).json({
      error: "BUILD_FAILED",
      message: err?.message || "Could not build this payment. Try again in a moment.",
      details: null,
    });
  }
});

/**
 * The QR value for a request that should settle into the recipient's mix, or null when it
 * can't be one (SOL, which the pay endpoint refuses, or no known public URL for this API).
 * Solana Pay wants the https link percent-encoded after `solana:`.
 */
export function payRequestUri(accountId: string, amount: string, tokenSymbol: string): string | null {
  const base = process.env.PUBLIC_API_URL || process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  const token = resolveSolanaToken(tokenSymbol);
  if (!base || !token || token.isNative) return null;
  const link = `${base.replace(/\/+$/, "")}/api/v1/pay/${encodeURIComponent(accountId)}?amount=${encodeURIComponent(amount)}&token=${encodeURIComponent(token.symbol)}`;
  return `solana:${encodeURIComponent(link)}`;
}
