import pg, { type QueryResult, type QueryResultRow } from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  ssl:
    process.env.DATABASE_URL && (process.env.DATABASE_URL.includes("supabase.com") || process.env.NODE_ENV === "production")
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
