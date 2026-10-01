import type { PoolClient } from "pg";
import { pool } from "../../db";
import { validateFlowSettings } from "../../../../src/lib/flow/settings";
import type { FlowSettings, FlowWeight } from "../../../../src/lib/flow/types";
export class FlowError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}
export async function inFlowTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) throw new FlowError("NOT_CONFIGURED", "Income storage is not configured.", 503);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
export async function lockSettings(client: PoolClient, accountId: string): Promise<FlowSettings> {
  await client.query("INSERT INTO flow_settings (account_id) VALUES ($1) ON CONFLICT DO NOTHING", [accountId]);
  const result = await client.query<{ cash_target_base: string; weights: FlowWeight[]; revision: number }>("SELECT cash_target_base, weights, revision FROM flow_settings WHERE account_id = $1 FOR UPDATE", [accountId]);
  const row = result.rows[0];
  if (!row) throw new FlowError("NOT_FOUND", "Account not found.", 404);
  return { cashTargetBase: row.cash_target_base, weights: row.weights, revision: row.revision };
}
export function getFlowSettings(accountId: string): Promise<FlowSettings> { return inFlowTransaction((client) => lockSettings(client, accountId)); }
export function saveFlowSettings(accountId: string, target: unknown, weights: unknown, revision: unknown): Promise<FlowSettings> {
  const validated = validateFlowSettings(target, weights);
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) throw new FlowError("VALIDATION_FAILED", "A settings revision is required.");
  return inFlowTransaction(async (client) => {
    const current = await lockSettings(client, accountId);
    if (current.revision !== revision) throw new FlowError("CONFLICT", "Your income settings changed. Reload before saving.", 409);
    await client.query("UPDATE flow_settings SET cash_target_base = $2, weights = $3, revision = revision + 1, updated_at = NOW() WHERE account_id = $1", [accountId, validated.cashTargetBase, JSON.stringify(validated.weights)]);
    return { ...validated, revision: revision + 1 };
  });
}
