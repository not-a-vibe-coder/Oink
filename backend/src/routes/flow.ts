import { Router, type RequestHandler } from "express";
import { requireSession } from "../middleware/session";
import { ipRateLimiter } from "../middleware/rateLimit";
import { FlowError, getFlowSettings, saveFlowSettings } from "../services/flow/settings";
import {
  confirmFlowInvoice,
  createFlowInvoice,
  getFlowInvoice,
  publicFlowInvoice,
  type InvoiceRecord,
} from "../services/flow/invoices";
import {
  allocateFlowInvoice,
  listFlowPayments,
  previewFlowIncome,
} from "../services/flow/allocation";
import { inFlowTransaction } from "../services/flow/settings";
import { flowSummary } from "../services/flow/summary";
import { buildExternalPayment } from "../services/externalPayment";
import { flowUsdcMint } from "../services/flow/chain";
import { query } from "../db";
import { createBellQuote, listBellPurchases } from "../services/bell/quotes";
import { prepareBellPurchase } from "../services/bell/attempts";
import { submitBellAttempt } from "../services/bell/submit";
import { reconcileBellAttempt } from "../services/bell/reconcile";
import { changeBellPurchase } from "../services/bell/lifecycle";
export const flowRouter = Router();
// Keep infrastructure failures opaque and validation errors actionable.
const endpoint =
  (work: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await work(req, res, next);
    } catch (error) {
      if (error instanceof FlowError) {
        res.status(error.status).json({ error: error.code, message: error.message, details: null });
        return;
      }
      if (
        error instanceof Error &&
        /^(Use |Amount is |Choose |Invalid investment|Weights must|Investment weights)/.test(
          error.message,
        )
      ) {
        res.status(400).json({ error: "VALIDATION_FAILED", message: error.message, details: null });
        return;
      }
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        res.status(409).json({
          error: "CONFLICT",
          message: "This payment has already been recorded.",
          details: null,
        });
        return;
      }
      res.status(503).json({
        error: "UNAVAILABLE",
        message: "Income services are temporarily unavailable. Try again later.",
        details: null,
      });
    }
  };
flowRouter.get(
  "/settings",
  requireSession,
  endpoint(async (req, res) => {
    res.json(await getFlowSettings(req.accountId!));
  }),
);
flowRouter.put(
  "/settings",
  requireSession,
  endpoint(async (req, res) => {
    res.json(
      await saveFlowSettings(
        req.accountId!,
        req.body?.cashTargetBase,
        req.body?.weights,
        req.body?.revision,
      ),
    );
  }),
);
flowRouter.get(
  "/summary",
  requireSession,
  endpoint(async (req, res) => {
    res.json(await flowSummary(req.accountId!));
  }),
);
flowRouter.post(
  "/preview",
  requireSession,
  endpoint(async (req, res) => {
    res.json(await previewFlowIncome(req.accountId!, req.body?.amountBase));
  }),
);
flowRouter.post(
  "/invoices",
  requireSession,
  endpoint(async (req, res) => {
    res.status(201).json(await createFlowInvoice(req.accountId!, req.body?.amountBase));
  }),
);
flowRouter.get(
  "/invoices",
  requireSession,
  endpoint(async (req, res) => {
    res.json(
      await inFlowTransaction(async (client) => {
        const rows = await client.query<InvoiceRecord>(
          "SELECT * FROM flow_invoices WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50",
          [req.accountId!],
        );
        return { invoices: rows.rows.map(publicFlowInvoice) };
      }),
    );
  }),
);
flowRouter.get(
  "/invoices/:id",
  endpoint(async (req, res) => {
    res.json(await getFlowInvoice(String(req.params.id)));
  }),
);
// Public: a payer's Seeker/Android wallet asks for the referenced transfer it will sign itself.
flowRouter.post(
  "/invoices/:id/transaction",
  ipRateLimiter("flow_payer_tx", 60, 3600),
  endpoint(async (req, res) => {
    const invoice = await getFlowInvoice(String(req.params.id));
    if (invoice.status !== "pending")
      throw new FlowError("CONFLICT", "This payment request is no longer open.", 409);
    const tokenMint = (
      await query<{ token_mint: string }>("SELECT token_mint FROM flow_invoices WHERE id = $1", [
        invoice.id,
      ])
    ).rows[0].token_mint;
    res.json(
      await buildExternalPayment({
        payer: req.body?.account,
        recipient: invoice.recipientWallet,
        mint: tokenMint,
        tokenBase: BigInt(invoice.amountBase),
        lamports: 0n,
        reference: invoice.reference,
      }),
    );
  }),
);
// Session: fund this account's Oink wallet from the user's own Seeker wallet (USDC and/or SOL).
flowRouter.post(
  "/topup/transaction",
  requireSession,
  ipRateLimiter("flow_topup_tx", 60, 3600),
  endpoint(async (req, res) => {
    const amount = (value: unknown) => {
      if (value === undefined || value === null || value === "") return 0n;
      if (typeof value !== "string" || !/^(0|[1-9]\d{0,19})$/.test(value))
        throw new FlowError("VALIDATION_FAILED", "Use whole base units for top-up amounts.");
      return BigInt(value);
    };
    const tokenBase = amount(req.body?.usdcBase);
    const wallet = await query<{ public_key: string }>(
      "SELECT public_key FROM wallets WHERE account_id = $1 AND status = 'active'",
      [req.accountId!],
    );
    if (!wallet.rows[0]) throw new FlowError("NOT_FOUND", "Account not found.", 404);
    res.json(
      await buildExternalPayment({
        payer: req.body?.payer,
        recipient: wallet.rows[0].public_key,
        mint: tokenBase > 0n ? flowUsdcMint() : "11111111111111111111111111111111",
        tokenBase,
        lamports: amount(req.body?.lamports),
      }),
    );
  }),
);
flowRouter.post(
  "/invoices/:id/confirm",
  ipRateLimiter("flow_confirm", 30, 3600),
  endpoint(async (req, res) => {
    res.json(await confirmFlowInvoice(String(req.params.id), req.body?.signature));
  }),
);
flowRouter.post(
  "/invoices/:id/allocate",
  requireSession,
  endpoint(async (req, res) => {
    res.json(await allocateFlowInvoice(req.accountId!, String(req.params.id)));
  }),
);
flowRouter.get(
  "/payments",
  requireSession,
  endpoint(async (req, res) => {
    res.json(await listFlowPayments(req.accountId!));
  }),
);

flowRouter.get(
  "/purchases",
  requireSession,
  endpoint(async (req, res) => {
    res.json(await listBellPurchases(req.accountId!));
  }),
);
flowRouter.post(
  "/purchases/:id/quote",
  requireSession,
  ipRateLimiter("bell_quote", 120, 3600),
  endpoint(async (req, res) => {
    res.json(await createBellQuote(req.accountId!, String(req.params.id), req.body?.policy));
  }),
);

flowRouter.post(
  "/purchases/:id/prepare",
  requireSession,
  ipRateLimiter("bell_prepare", 120, 3600),
  endpoint(async (req, res) => {
    if (typeof req.body?.quoteId !== "string")
      throw new FlowError("VALIDATION_FAILED", "A reviewed quote is required.");
    res.json(await prepareBellPurchase(req.accountId!, String(req.params.id), req.body.quoteId));
  }),
);
flowRouter.post(
  "/attempts/:id/submit",
  requireSession,
  ipRateLimiter("bell_submit", 120, 3600),
  endpoint(async (req, res) => {
    res.json(
      await submitBellAttempt(req.accountId!, String(req.params.id), req.body?.signedTransaction),
    );
  }),
);
flowRouter.post(
  "/attempts/:id/reconcile",
  requireSession,
  ipRateLimiter("bell_reconcile", 240, 3600),
  endpoint(async (req, res) => {
    res.json(await reconcileBellAttempt(req.accountId!, String(req.params.id)));
  }),
);
for (const action of ["retry", "cancel"] as const)
  flowRouter.post(
    `/purchases/:id/${action}`,
    requireSession,
    endpoint(async (req, res) => {
      res.json(await changeBellPurchase(req.accountId!, String(req.params.id), action));
    }),
  );
flowRouter.get(
  "/receipts",
  requireSession,
  endpoint(async (req, res) => {
    res.json(
      await inFlowTransaction(async (client) => {
        const result = await client.query<import("../services/bell/attempts").AttemptRecord>(
          "SELECT * FROM bell_attempts WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
          [req.accountId!],
        );
        const { attemptResponse } = await import("../services/bell/attempts");
        return { attempts: result.rows.map(attemptResponse) };
      }),
    );
  }),
);
