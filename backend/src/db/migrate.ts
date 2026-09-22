import fs from "node:fs";
import path from "node:path";
import { pool } from "./index";

export async function migrate(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is missing. Refusing to migrate.");
    console.warn("DATABASE_URL is not configured; skipping migrations in development.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const migrationsDir = path.resolve(import.meta.dir, "../../db/migrations");
    for (const filename of fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort()) {
      const applied = await client.query("SELECT filename FROM schema_migrations WHERE filename = $1", [filename]);
      if (applied.rows.length > 0) continue;
      await client.query("BEGIN");
      try {
        await client.query(fs.readFileSync(path.join(migrationsDir, filename), "utf8"));
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

if (import.meta.main) await migrate();
