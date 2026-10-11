import { Router } from "express";
import { requireSession } from "../middleware/session";
import { ipRateLimiter } from "../middleware/rateLimit";
import { FlowError } from "../services/flow/settings";
import {
  activeSubscriptionCount,
  pushConfig,
  revokeSubscription,
  saveSubscription,
} from "../services/push";

export const pushRouter = Router();

pushRouter.get("/config", requireSession, async (req, res) => {
  const config = pushConfig();
  try {
    res.json({
      enabled: config !== null,
      publicKey: config?.publicKey ?? null,
      subscriptions: config ? await activeSubscriptionCount(req.accountId!) : 0,
    });
  } catch {
    res
      .status(503)
      .json({ error: "UNAVAILABLE", message: "Notifications are unavailable.", details: null });
  }
});

pushRouter.post(
  "/subscriptions",
  requireSession,
  ipRateLimiter("push_subscribe", 30, 3600),
  async (req, res) => {
    try {
      await saveSubscription(req.accountId!, req.body);
      res.status(201).json({ subscribed: true });
    } catch (error) {
      if (error instanceof FlowError) {
        res.status(error.status).json({ error: error.code, message: error.message, details: null });
        return;
      }
      res
        .status(503)
        .json({ error: "UNAVAILABLE", message: "Notifications are unavailable.", details: null });
    }
  },
);

pushRouter.post("/subscriptions/revoke", requireSession, async (req, res) => {
  try {
    res.json({ revoked: await revokeSubscription(req.accountId!, req.body?.endpoint) });
  } catch (error) {
    if (error instanceof FlowError) {
      res.status(error.status).json({ error: error.code, message: error.message, details: null });
      return;
    }
    res
      .status(503)
      .json({ error: "UNAVAILABLE", message: "Notifications are unavailable.", details: null });
  }
});
