import { pool } from "../src/db";
/** Explicit consented cohort; output omits identifiers and credentials. Read-only transaction. */
export async function pilotReport(accountIds: string[]) {
  if (!accountIds.length || accountIds.some((id) => !/^oink-[a-z0-9]{4}-[a-z0-9]{4}$/.test(id)))
    throw new Error("Provide a non-empty cohort of Oink account IDs.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await client.query(
      `
      WITH payments AS (SELECT * FROM flow_payments WHERE account_id = ANY($1::text[])),
      orders AS (SELECT p.* FROM flow_purchases p JOIN payments f ON f.id=p.payment_id),
      attempts AS (SELECT * FROM bell_attempts WHERE account_id = ANY($1::text[])),
      invoices AS (SELECT * FROM flow_invoices WHERE account_id = ANY($1::text[]))
      SELECT
        (SELECT count(*)::text FROM invoices WHERE status='paid') AS received_payments,
        (SELECT count(*)::text FROM payments) AS allocated_payments,
        (SELECT count(DISTINCT account_id)::text FROM payments) AS users_with_allocations,
        (SELECT count(*)::text FROM (SELECT account_id FROM payments GROUP BY account_id HAVING count(*)>1) repeaters) AS repeat_users,
        (SELECT COALESCE(sum(payment_base),0)::text FROM payments) AS allocated_usdc_base,
        (SELECT COALESCE(sum(cash_base),0)::text FROM payments) AS cash_allocation_base,
        (SELECT COALESCE(sum(amount_base),0)::text FROM orders WHERE state NOT IN ('confirmed','cancelled')) AS reserved_usdc_base,
        (SELECT COALESCE(sum(amount_base),0)::text FROM orders WHERE state='cancelled') AS released_usdc_base,
        (SELECT COALESCE(jsonb_object_agg(state,count),'{}') FROM (SELECT state,count(*)::text AS count FROM orders GROUP BY state) states) AS order_states,
        (SELECT count(*)::text FROM attempts WHERE state='confirmed') AS finalized_fills,
        (SELECT count(*)::text FROM attempts WHERE reason='EXECUTION_MISMATCH') AS execution_mismatches,
        (SELECT COALESCE(sum((receipt->>'inputBase')::numeric),0)::text FROM attempts WHERE state='confirmed') AS actual_usdc_spent_base,
        (SELECT COALESCE(sum((receipt->>'networkFeeLamports')::numeric),0)::text FROM attempts WHERE state='confirmed') AS finalized_fee_lamports,
        (SELECT COALESCE(jsonb_object_agg(reason,count),'{}') FROM (SELECT q.reason,count(*)::text AS count FROM orders p JOIN bell_quotes q ON q.id=p.quote_id WHERE q.decision <> 'pass' GROUP BY q.reason) reasons) AS current_deferral_reasons
    `,
      [Array.from(new Set(accountIds))],
    );
    await client.query("COMMIT");
    return {
      generatedAt: new Date().toISOString(),
      cohortSize: new Set(accountIds).size,
      scope: "all recorded history for the explicitly supplied cohort",
      ...result.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
if (import.meta.main) {
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
    const raw: unknown = JSON.parse(process.env.PILOT_ACCOUNT_IDS ?? "[]");
    if (!Array.isArray(raw) || !raw.every((id): id is string => typeof id === "string"))
      throw new Error("PILOT_ACCOUNT_IDS must be a JSON array.");
    console.log(JSON.stringify(await pilotReport(raw), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Pilot report failed.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
