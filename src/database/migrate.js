import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL (or DATABASE_URL_UNPOOLED for migrations) is required.");

const pool = new Pool({ connectionString: databaseUrl });
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(join(here, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(join(here, "migrations", file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await pool.query("SELECT checksum FROM schema_migrations WHERE version=$1", [file]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum.trim() !== checksum) throw new Error(`Applied migration ${file} was edited; add a new migration instead.`);
      console.log(`Already applied: ${file}`);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version,checksum) VALUES ($1,$2)", [file, checksum]);
      await client.query("COMMIT");
      console.log(`Applied: ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
} finally {
  await pool.end();
}
