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

    // Legacy-database guard (live audit finding): if _schema_migrations is
    // empty, this script would otherwise assume it's talking to a brand
    // new, empty database and run every migration from 0001 — including
    // `create table` statements for tables that may already exist because
    // this database predates migration tracking (was set up by hand via
    // the Supabase SQL Editor before this script existed). Running those
    // would fail loudly at best, or silently diverge from what's actually
    // there at worst. Never guess which migrations "must have" already run
    // — abort and require a human to baseline it first.
    if (applied.size === 0) {
      const { rows: coreTables } = await client.query(`
        select
          to_regclass('public.topics') is not null as topics,
          to_regclass('public.research_packs') is not null as research_packs,
          to_regclass('public.content_assets') is not null as content_assets
      `);
      const { topics, research_packs, content_assets } = coreTables[0];
      if (topics && research_packs && content_assets) {
        console.error("Legacy database detected; baseline migration history before continuing.");
        console.error(
          "public._schema_migrations is empty, but core tables (topics, research_packs, content_assets) already exist — this looks like a database that predates migration tracking, not a fresh one. Running migrations from 0001 would try to re-create tables that already exist. This script will not guess which migrations already applied: manually insert the filenames of the migrations you know are already reflected in this database into public._schema_migrations, then re-run.",
        );
        process.exitCode = 1;
        return;
      }
    }

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
