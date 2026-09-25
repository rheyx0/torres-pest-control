#!/usr/bin/env node
//
// Torres Pest Control — apply migrations without the SQL Editor.
//
// Runs files from supabase/migrations/ against the database, in numeric order,
// each in its own transaction: a file lands whole or not at all, exactly like
// pasting it into the SQL Editor, and the run stops at the first failure with
// the file, the line and Postgres's message.
//
//   npm run db:migrate -- 040          040 through the last migration
//   npm run db:migrate -- 040 045      040 through 045
//   npm run db:migrate -- 050 050      just 050
//   npm run db:migrate -- --list 040   print what would run, touch nothing
//
// Order is load-bearing (see CLAUDE.md): later files replace earlier
// definitions of the same function, so a range always runs low to high, and
// two files sharing a number (013, 039) both run, in filename order. Every
// migration is written to be re-runnable, so re-running a range is safe.
//
// CONNECTION: the publishable key cannot create tables or functions, so this
// needs the database connection string. Put it in .env.local (gitignored) as
//
//   SUPABASE_DB_URL=postgresql://postgres.<project>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
//
// from Supabase Dashboard > Connect > Session pooler. Deliberately NOT prefixed
// REACT_APP_: Create React App bundles every REACT_APP_ variable into the
// browser build, and this one is the database password.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function readEnvLocal(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(".env.local")) return null;
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : null;
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** "040-inventory-….sql" -> 40; files without a leading number are skipped. */
const numberOf = (file) => {
  const match = /^(\d+)-.*\.sql$/.exec(file);
  return match ? Number(match[1]) : null;
};

function pickFiles(from, to) {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => numberOf(file) !== null)
    .filter((file) => numberOf(file) >= from && numberOf(file) <= to)
    .sort((a, b) => numberOf(a) - numberOf(b) || a.localeCompare(b));
}

/** Postgres reports a character offset; a line number is what you can find. */
function lineAt(sql, position) {
  if (!position) return null;
  return sql.slice(0, Number(position)).split("\n").length;
}

async function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes("--list");
  const numbers = args.filter((arg) => /^\d+$/.test(arg)).map(Number);
  if (numbers.length === 0) {
    fail("Say where to start, e.g.  npm run db:migrate -- 040   (or 040 045 for a range).");
  }
  const [from, to = Infinity] = numbers;
  const files = pickFiles(from, to);
  if (files.length === 0) fail(`No migrations numbered ${from}${to === Infinity ? "+" : `–${to}`}.`);

  console.log(`${listOnly ? "Would run" : "Running"} ${files.length} migration${files.length === 1 ? "" : "s"}:`);
  files.forEach((file) => console.log(`  ${file}`));
  if (listOnly) return;

  const connectionString = readEnvLocal("SUPABASE_DB_URL");
  if (!connectionString) {
    fail("SUPABASE_DB_URL is not set. Add it to .env.local — see the header of supabase/run-migrations.mjs.");
  }

  // Supabase requires TLS; its pooler certificate is not in Node's default
  // store, so verification is relaxed rather than shipping a CA bundle here.
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
  } catch (error) {
    fail(`Could not connect: ${error.message}\nCheck SUPABASE_DB_URL (password, and the Session pooler host).`);
  }

  // RAISE NOTICE output from the migrations, shown as it arrives.
  client.on("notice", (notice) => console.log(`    notice: ${notice.message}`));

  console.log("");
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const started = Date.now();
    process.stdout.write(`  ${file} … `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      console.log(`ok (${Date.now() - started} ms)`);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      console.log("FAILED — rolled back, nothing from this file was applied.");
      const line = lineAt(sql, error.position);
      console.error(`\n  ${error.code ? `[${error.code}] ` : ""}${error.message}`);
      if (line) console.error(`  at ${file}:${line}`);
      if (error.detail) console.error(`  detail: ${error.detail}`);
      if (error.hint) console.error(`  hint: ${error.hint}`);
      if (error.where) console.error(`  where: ${error.where}`);
      await client.end();
      const done = files.indexOf(file);
      fail(done > 0
        ? `Stopped. ${done} file${done === 1 ? "" : "s"} before it were applied. Fix it and re-run from ${String(numberOf(file)).padStart(3, "0")}.`
        : "Stopped. Nothing was applied.");
    }
  }

  // New RPCs and columns are invisible to the app until PostgREST reloads.
  await client.query("notify pgrst, 'reload schema'");
  await client.end();
  console.log("\nDone. PostgREST schema cache reloaded.");
}

main().catch((error) => fail(error.stack || error.message));
