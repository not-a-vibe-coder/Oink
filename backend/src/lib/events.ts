import type { PoolClient } from "pg";
import { query } from "../db";

export type AccountEventKind =
  | "wallet_created"
  | "recovered"
  | "password_changed"
  | "email_linked"
  | "email_unlinked"
  | "x_linked"
  | "x_unlinked"
  | "tag_assigned"
  | "tag_lost";

type Db = Pick<PoolClient, "query">;

/**
 * Appends to the admin activity feed. `detail` is shown to admins verbatim, so it must hold
 * only non-secret facts (an X username, a tag) — never key material or credentials.
 * Pass the transaction's client when the event belongs to a write that might roll back.
 */
export async function recordEvent(
  accountId: string | null,
  kind: AccountEventKind,
  detail: Record<string, unknown> = {},
  ipHash: string | null = null,
  db: Db = { query } as unknown as Db,
): Promise<void> {
  await db.query("INSERT INTO account_events (account_id, kind, detail, ip_hash) VALUES ($1, $2, $3, $4)", [
    accountId,
    kind,
    JSON.stringify(detail),
    ipHash,
  ]);
}
