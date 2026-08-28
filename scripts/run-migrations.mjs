// Applies supabase/migrations/*.sql directly against Postgres (via
// DATABASE_URL in .env.local), in filename order, tracking what's already
// been applied — so this repo's migrations don't require hand-pasting SQL
// into the Supabase SQL Editor every time. See CLAUDE.md "Working
// agreement for this repo" — this script only ever ADDS rows to
// _schema_migrations and runs the .sql files as-is; it never edits or
// reorders existing migration files.
//
// Usage: node scripts/run-migrations.mjs [--dry-run]

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const rootDir = path.resolve(fileURLToPath(import.meta.url), "../..");
const migrationsDir = path.join(rootDir, "supabase", "migrations");
const dryRun = process.argv.includes("--dry-run");

function loadDatabaseUrl() {
  const envPath = path.join(rootDir, ".env.local");
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("DATABASE_URL=")) return line.slice("DATABASE_URL=".length).trim();
  }
  throw new Error("DATABASE_URL not found in .env.local");
}

async function main() {
  const connectionString = loadDatabaseUrl();
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(`
      create table if not exists public._schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows } = await client.query("select version from public._schema_migrations");
    const applied = new Set(rows.map((r) => r.version));

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log("Nothing to apply — all migrations already recorded.");
      return;
    }

    console.log(`Pending migrations (${pending.length}):`, pending.join(", "));
    if (dryRun) {
      console.log("--dry-run: not executing anything.");
      return;
    }

    for (const file of pending) {
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`Applying ${file} ...`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into public._schema_migrations (version) values ($1)", [file]);
        await client.query("commit");
        console.log(`  OK`);
      } catch (err) {
        await client.query("rollback");
        console.error(`  FAILED: ${err.message}`);
        throw err;
      }
    }

    console.log("All pending migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
