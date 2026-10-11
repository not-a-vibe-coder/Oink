import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { oinkFetch } from "@/server/oink-api";

const cookie = () => getRequestHeader("cookie");
const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);

export const getPushConfig = createServerFn({ method: "GET" }).handler(() =>
  oinkFetch<{ enabled: boolean; publicKey: string | null; subscriptions: number }>(
    "/api/v1/push/config",
    { cookie: cookie() },
  ),
);
export const savePushSubscription = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      endpoint: z.string().url().max(1024),
      keys: z.object({ p256dh: base64url.max(128), auth: base64url.max(64) }),
    }),
  )
  .handler(({ data }) =>
    oinkFetch<{ subscribed: true }>("/api/v1/push/subscriptions", {
      method: "POST",
      cookie: cookie(),
      body: data,
    }),
  );
export const revokePushSubscription = createServerFn({ method: "POST" })
  .inputValidator(z.object({ endpoint: z.string().max(1024) }))
  .handler(({ data }) =>
    oinkFetch<{ revoked: number }>("/api/v1/push/subscriptions/revoke", {
      method: "POST",
      cookie: cookie(),
      body: data,
    }),
  );
