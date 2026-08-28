import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getPool } from "./pool.js";

const MIGRATION_LOCK_ID = 726_804_321;

export async function runMigrations(
  migrationsDirectory = resolve(import.meta.dirname, "../migrations"),
): Promise<string[]> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/u.test(file))
    .sort();
  const client = await getPool().connect();
  const applied: string[] = [];

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename TEXT PRIMARY KEY,
         checksum TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );

    for (const filename of files) {
      const sql = await readFile(resolve(migrationsDirectory, filename), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE filename = $1",
        [filename],
      );
      const previousChecksum = existing.rows[0]?.checksum;
      if (previousChecksum) {
        if (previousChecksum !== checksum) {
          throw new Error(`Applied migration has changed: ${filename}`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
          [filename, checksum],
        );
        await client.query("COMMIT");
        applied.push(filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    } finally {
      client.release();
    }
  }

  return applied;
}
