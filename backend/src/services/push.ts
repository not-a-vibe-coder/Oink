import { nanoid } from "nanoid";
import webpush from "web-push";
import { query } from "../db";
import { FlowError } from "./flow/settings";

/**
 * Web Push for opted-in accounts only. Payloads are deliberately generic: a short title, a
 * sentence and an in-app link — never an amount, address, signature, key or account ID — so a
 * lock-screen preview or a push service log learns nothing about the user's money.
 */
export type PushKind = "payment_received" | "bell_review";

export const PUSH_MESSAGES: Record<PushKind, { title: string; body: string; url: string }> = {
  payment_received: {
    title: "Payment received",
    body: "Your payday plan is ready to apply.",
    url: "/app/income#requests",
  },
  bell_review: {
    title: "Bell order needs review",
    body: "Check it against your limits before you sign.",
    url: "/app/income#bell",
  },
};

export function pushConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export async function saveSubscription(accountId: string, body: unknown): Promise<void> {
  if (!pushConfig()) throw new FlowError("NOT_CONFIGURED", "Notifications are not set up.", 503);
  const input = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = input?.endpoint;
  const p256dh = input?.keys?.p256dh;
  const auth = input?.keys?.auth;
  let valid = false;
  try {
    valid =
      typeof endpoint === "string" &&
      endpoint.length <= 1024 &&
      new URL(endpoint).protocol === "https:" &&
      typeof p256dh === "string" &&
      p256dh.length <= 128 &&
      BASE64URL.test(p256dh) &&
      typeof auth === "string" &&
      auth.length <= 64 &&
      BASE64URL.test(auth);
  } catch {
    valid = false;
  }
  if (!valid) throw new FlowError("VALIDATION_FAILED", "Invalid push subscription.");
  // An endpoint belongs to one browser; re-subscribing moves it to this account and reactivates.
  await query(
    `INSERT INTO push_subscriptions (id, account_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET account_id = EXCLUDED.account_id, p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, revoked_at = NULL, created_at = NOW()`,
    [`push_${nanoid(16)}`, accountId, endpoint, p256dh, auth],
  );
}

export async function revokeSubscription(accountId: string, endpoint: unknown): Promise<number> {
  if (typeof endpoint !== "string" || endpoint.length > 1024)
    throw new FlowError("VALIDATION_FAILED", "Invalid push subscription.");
  const result = await query(
    "UPDATE push_subscriptions SET revoked_at = NOW() WHERE account_id = $1 AND endpoint = $2 AND revoked_at IS NULL",
    [accountId, endpoint],
  );
  return result.rowCount ?? 0;
}

export async function activeSubscriptionCount(accountId: string): Promise<number> {
  const result = await query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE account_id = $1 AND revoked_at IS NULL",
    [accountId],
  );
  return result.rows[0].count;
}

/** Best effort and never throws: a failed notification must not fail a payment or allocation. */
export async function notifyAccount(accountId: string, kind: PushKind): Promise<number> {
  const config = pushConfig();
  if (!config) return 0;
  try {
    const subscriptions = await query<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE account_id = $1 AND revoked_at IS NULL",
      [accountId],
    );
    const payload = JSON.stringify(PUSH_MESSAGES[kind]);
    let sent = 0;
    await Promise.all(
      subscriptions.rows.map(async (row) => {
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            payload,
            {
              vapidDetails: config,
              TTL: 6 * 60 * 60,
              urgency: "normal",
              timeout: 8000,
            },
          );
          sent++;
        } catch (error) {
          const status = (error as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410)
            await query("UPDATE push_subscriptions SET revoked_at = NOW() WHERE id = $1", [row.id]);
        }
      }),
    );
    return sent;
  } catch {
    return 0;
  }
}
