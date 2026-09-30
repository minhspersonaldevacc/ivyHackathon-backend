import "dotenv/config";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL (or DATABASE_URL_UNPOOLED) is required.");
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const connection = await pool.query("SELECT current_database() AS database, current_schema() AS schema, current_user AS role, now() AS checked_at");
  const tables = await pool.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name`);
  const constraints = await pool.query(`SELECT conrelid::regclass::text AS table_name, conname AS constraint_name, contype AS type
    FROM pg_constraint WHERE connamespace=current_schema()::regnamespace ORDER BY 1,2`);
  const indexes = await pool.query(`SELECT tablename AS table_name, indexname AS index_name
    FROM pg_indexes WHERE schemaname=current_schema() ORDER BY 1,2`);
  console.log(JSON.stringify({ connection: connection.rows[0], tables: tables.rows.map((row) => row.table_name), constraints: constraints.rows, indexes: indexes.rows }, null, 2));
} finally { await pool.end(); }
