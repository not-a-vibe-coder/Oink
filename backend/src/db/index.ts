import pg, { type QueryResult, type QueryResultRow } from "pg";

const { Pool } = pg;

// Production defaults to TLS. An explicit `sslmode=disable` in the URL opts out, for a private
// network or a local production-mode dry run; it is never inferred.
const databaseUrl = process.env.DATABASE_URL;
const sslDisabled = databaseUrl ? /[?&]sslmode=disable(&|$)/.test(databaseUrl) : false;
export const pool = new Pool({
  connectionString: databaseUrl || undefined,
  ssl:
    databaseUrl &&
    !sslDisabled &&
    (databaseUrl.includes("supabase.com") || process.env.NODE_ENV === "production")
      ? { rejectUnauthorized: false }
      : false,
});

export const query = async <R extends QueryResultRow = any>(
  text: string,
  params?: readonly unknown[] | unknown[],
): Promise<QueryResult<R>> => {
  if (!process.env.DATABASE_URL) {
    return {
      rows: [] as R[],
      rowCount: 0,
      command: "",
      oid: 0,
      fields: [],
    };
  }
  return pool.query<R>(text, params as any[]);
};
