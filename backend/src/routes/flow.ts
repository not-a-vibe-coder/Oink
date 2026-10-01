import { Router, type RequestHandler } from "express";
import { requireSession } from "../middleware/session";
import { ipRateLimiter } from "../middleware/rateLimit";
import { FlowError, getFlowSettings, saveFlowSettings } from "../services/flow/settings";
import { confirmFlowInvoice, createFlowInvoice, getFlowInvoice, publicFlowInvoice, type InvoiceRecord } from "../services/flow/invoices";
import { allocateFlowInvoice, listFlowPayments, previewFlowIncome } from "../services/flow/allocation";
import { inFlowTransaction } from "../services/flow/settings";
export const flowRouter = Router();
// Keep infrastructure failures opaque and validation errors actionable.
const endpoint = (work: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await work(req, res, next); }
  catch (error) {
    if (error instanceof FlowError) { res.status(error.status).json({ error: error.code, message: error.message, details: null }); return; }
    if (error instanceof Error && /^(Use |Amount is |Choose |Invalid investment|Weights must|Investment weights)/.test(error.message)) {
      res.status(400).json({ error: "VALIDATION_FAILED", message: error.message, details: null }); return;
    }
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "CONFLICT", message: "This payment has already been recorded.", details: null }); return;
    }
    res.status(503).json({ error: "UNAVAILABLE", message: "Income services are temporarily unavailable. Try again later.", details: null });
  }
};
flowRouter.get("/settings", requireSession, endpoint(async (req, res) => { res.json(await getFlowSettings(req.accountId!)); }));
flowRouter.put("/settings", requireSession, endpoint(async (req, res) => { res.json(await saveFlowSettings(req.accountId!, req.body?.cashTargetBase, req.body?.weights, req.body?.revision)); }));
flowRouter.post("/preview", requireSession, endpoint(async (req, res) => { res.json(await previewFlowIncome(req.accountId!, req.body?.amountBase)); }));
flowRouter.post("/invoices", requireSession, endpoint(async (req, res) => { res.status(201).json(await createFlowInvoice(req.accountId!, req.body?.amountBase)); }));
flowRouter.get("/invoices", requireSession, endpoint(async (req, res) => {
  res.json(await inFlowTransaction(async (client) => {
    const rows = await client.query<InvoiceRecord>("SELECT * FROM flow_invoices WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50", [req.accountId!]);
    return { invoices: rows.rows.map(publicFlowInvoice) };
  }));
}));
flowRouter.get("/invoices/:id", endpoint(async (req, res) => { res.json(await getFlowInvoice(String(req.params.id))); }));
flowRouter.post("/invoices/:id/confirm", ipRateLimiter("flow_confirm", 30, 3600), endpoint(async (req, res) => { res.json(await confirmFlowInvoice(String(req.params.id), req.body?.signature)); }));
flowRouter.post("/invoices/:id/allocate", requireSession, endpoint(async (req, res) => { res.json(await allocateFlowInvoice(req.accountId!, String(req.params.id))); }));
flowRouter.get("/payments", requireSession, endpoint(async (req, res) => { res.json(await listFlowPayments(req.accountId!)); }));
