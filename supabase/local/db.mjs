#!/usr/bin/env node
//
// Torres Pest Control — create the local database (Technical Manual §4).
//
//   npm run db:local                   create torres_pest_control and the admin account
//   npm run db:local -- --demo         … and load the demo data (also works on an existing database)
//   npm run db:local -- --reset        delete the database and build it again from scratch
//   npm run db:local -- --migrations   build from schema-v2.sql + every migration, not the snapshot
//   npm run db:snapshot                rebuild supabase/local/torres-database.sql from the migrations
//
// The usual path loads ONE file, torres-database.sql: the database exactly as
// schema-v2.sql plus migrations 001…NNN leave it, exported with pg_dump. It is
// faster and has fewer moving parts on a lab PC than replaying every
// migration. The migrations stay the source of truth: after adding one, run
// `npm run db:snapshot` (needs pg_dump, which comes with PostgreSQL) and
// commit the regenerated file, or `--migrations` builds the same database the
// long way.
//
// Settings come from .env.local in the project root:
//
//   LOCAL_DB_PASSWORD     the password of the postgres user (set when PostgreSQL was installed)
//   LOCAL_ADMIN_PASSWORD  the password for the system's first account, username "admin"
//   LOCAL_DB_HOST / LOCAL_DB_PORT / LOCAL_DB_USER / LOCAL_DB_NAME
//                         optional; default localhost / 5432 / postgres / torres_pest_control

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPABASE_DIR = join(HERE, "..");
const ROOT = join(SUPABASE_DIR, "..");
const MIGRATIONS_DIR = join(SUPABASE_DIR, "migrations");
const SNAPSHOT = join(HERE, "torres-database.sql");
const SNAPSHOT_BUILD_DB = "torres_snapshot_build";
const MIN_PASSWORD_LENGTH = 6; // src/utils/constants.js

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function readEnv(key) {
  if (process.env[key]) return process.env[key];
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : null;
}

function settings() {
  if (!existsSync(join(ROOT, ".env.local"))) {
    fail("There is no .env.local in the project folder. Create it first:  copy .env.local.example .env.local");
  }
  const password = readEnv("LOCAL_DB_PASSWORD");
  if (!password) {
    fail("LOCAL_DB_PASSWORD is empty in .env.local. Set it to the password you gave the postgres user when you installed PostgreSQL.");
  }
  const database = readEnv("LOCAL_DB_NAME") || "torres_pest_control";
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) fail(`LOCAL_DB_NAME "${database}" may only use lowercase letters, digits and _.`);
  return {
    host: readEnv("LOCAL_DB_HOST") || "localhost",
    port: Number(readEnv("LOCAL_DB_PORT") || 5432),
    user: readEnv("LOCAL_DB_USER") || "postgres",
    password,
    database,
  };
}

async function connect(cfg, database) {
  const client = new pg.Client({ ...cfg, database });
  try {
    await client.connect();
  } catch (error) {
    if (error.code === "28P01") {
      fail("PostgreSQL refused the password (password authentication failed).\nLOCAL_DB_PASSWORD in .env.local must be the postgres password you set when installing PostgreSQL.");
    }
    if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
      fail(`Could not connect to PostgreSQL on ${cfg.host}:${cfg.port}.\nIs it running? Windows key → "services" → postgresql-x64-16 → Start.`);
    }
    fail(`Could not connect to PostgreSQL: ${error.message}`);
  }
  client.on("notice", () => {}); // the migrations' RAISE NOTICEs are not news here
  return client;
}

/** Run one SQL file in its own transaction; stop with the file, line and message on failure. */
async function runFile(client, path, label) {
  const sql = stripPsqlCommands(readFileSync(path, "utf8"));
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    const line = error.position ? sql.slice(0, Number(error.position)).split("\n").length : null;
    fail(`${label} failed${line ? ` at line ${line}` : ""}: ${error.message}${error.detail ? `\n  detail: ${error.detail}` : ""}`);
  }
}

/**
 * pg_dump writes psql-only lines (\restrict …) that a plain query cannot run,
 * and a file saved with a byte-order mark (009 has one) is a syntax error to
 * the server, though psql and the SQL Editor skip it.
 */
function stripPsqlCommands(sql) {
  return sql
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("\\") && !/^SET transaction_timeout\b/.test(line))
    .join("\n");
}

const numberOf = (file) => {
  const match = /^(\d+)-.*\.sql$/.exec(file);
  return match ? Number(match[1]) : null;
};

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => numberOf(file) !== null)
    .sort((a, b) => numberOf(a) - numberOf(b) || a.localeCompare(b));
}

async function databaseExists(admin, name) {
  const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [name]);
  return rowCount > 0;
}

async function dropDatabase(admin, name) {
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [name]);
  await admin.query(`drop database if exists "${name}"`);
}

async function isBuilt(cfg) {
  const client = await connect(cfg, cfg.database);
  const { rows } = await client.query("select to_regclass('public.admins') is not null as built");
  await client.end();
  return rows[0].built;
}

/** schema-v2.sql + every migration, the way the hosted database was built. */
async function buildFromMigrations(cfg, database) {
  const client = await connect(cfg, database);
  await runFile(client, join(HERE, "bootstrap.sql"), "bootstrap.sql");
  process.stdout.write("  schema-v2.sql … ");
  await runFile(client, join(SUPABASE_DIR, "schema-v2.sql"), "schema-v2.sql");
  console.log("ok");
  const files = migrationFiles();
  process.stdout.write(`  ${files.length} migrations `);
  for (const file of files) {
    await runFile(client, join(MIGRATIONS_DIR, file), `Migration ${file}`);
    process.stdout.write(".");
  }
  console.log(" ok");
  await client.end();
}

async function buildFromSnapshot(cfg) {
  if (!existsSync(SNAPSHOT)) fail("supabase/local/torres-database.sql is missing. Run: npm run db:local -- --migrations");
  const client = await connect(cfg, cfg.database);
  process.stdout.write("  torres-database.sql … ");
  await runFile(client, SNAPSHOT, "torres-database.sql");
  console.log("ok");
  await client.end();
}

async function createAdmin(cfg) {
  const client = await connect(cfg, cfg.database);
  const { rows } = await client.query("select count(*)::int as n from public.admins");
  if (rows[0].n > 0) {
    console.log("  admin account … already exists, left as it is");
    await client.end();
    return false;
  }
  const password = readEnv("LOCAL_ADMIN_PASSWORD");
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    await client.end();
    fail(`LOCAL_ADMIN_PASSWORD in .env.local must be at least ${MIN_PASSWORD_LENGTH} characters. Set it, then run npm run db:local again.`);
  }
  await client.query(
    `insert into public.admins (name, email, username, password_hash, status, is_primary)
     values ('Administrator', 'admin@torres.local', 'admin', extensions.crypt($1, extensions.gen_salt('bf')), 'ACTIVE', true)`,
    [password],
  );
  console.log("  admin account … created (username: admin)");
  await client.end();
  return true;
}

/**
 * The demo seed books its visits on ACTIVE technicians and records an office
 * account as the booker, so a fresh database gets one Staff and one
 * Technician account first, with the admin's password.
 */
async function createDemoAccounts(client) {
  const { rows } = await client.query("select count(*)::int as n from public.technicians where status = 'ACTIVE'");
  if (rows[0].n > 0) return;
  const password = readEnv("LOCAL_ADMIN_PASSWORD");
  const accounts = [
    ["staff", "Demo Staff", "staff@torres.local", "staff"],
    ["technicians", "Demo Technician", "technician@torres.local", "technician"],
  ];
  for (const [table, name, email, username] of accounts) {
    await client.query(
      `insert into public.${table} (name, email, username, password_hash, status)
       values ($1, $2, $3, extensions.crypt($4, extensions.gen_salt('bf')), 'ACTIVE')
       on conflict do nothing`,
      [name, email, username, password],
    );
  }
  console.log("  demo accounts … created (usernames: staff, technician; same password as admin)");
}

async function loadDemo(cfg) {
  const client = await connect(cfg, cfg.database);
  await createDemoAccounts(client);
  process.stdout.write("  demo data (seed-demo-data.sql) … ");
  await runFile(client, join(SUPABASE_DIR, "seed-demo-data.sql"), "seed-demo-data.sql");
  console.log("ok");
  await client.end();
}

async function summary(cfg) {
  const client = await connect(cfg, cfg.database);
  const { rows } = await client.query(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
  );
  // A running `npm run local` picks up the new tables without a restart.
  await client.query("notify pgrst, 'reload schema'");
  await client.end();
  return rows[0].n;
}

async function setup(flags) {
  const cfg = settings();
  const admin = await connect(cfg, "postgres");
  await admin.query(readFileSync(join(HERE, "roles.sql"), "utf8"));

  const exists = await databaseExists(admin, cfg.database);
  if (exists && flags.has("--reset")) {
    process.stdout.write(`  deleting database ${cfg.database} … `);
    await dropDatabase(admin, cfg.database);
    console.log("ok");
  } else if (exists && (await isBuilt(cfg))) {
    await admin.end();
    if (flags.has("--demo")) {
      console.log(`\nDatabase ${cfg.database} already exists; loading the demo data into it.\n`);
      await loadDemo(cfg);
      await summary(cfg);
      console.log("\nDemo data loaded.\n");
      return;
    }
    fail(`The database ${cfg.database} already exists and is set up.\nTo delete it and build it again:  npm run db:local -- --reset`);
  }

  if (!(await databaseExists(admin, cfg.database))) {
    await admin.query(`create database "${cfg.database}"`);
  }
  await admin.end();

  console.log(`\nSetting up ${cfg.database} on ${cfg.host}:${cfg.port}\n`);
  if (flags.has("--migrations")) await buildFromMigrations(cfg, cfg.database);
  else await buildFromSnapshot(cfg);
  await createAdmin(cfg);
  if (flags.has("--demo")) await loadDemo(cfg);
  const tables = await summary(cfg);

  console.log(`
Setup finished.
  Database: ${cfg.database} (${tables} tables) on ${cfg.host}:${cfg.port}
  Log in:   username admin, password = LOCAL_ADMIN_PASSWORD in .env.local

Next: run  npm run local  and keep it open, then  npm start  in a second window.
`);
}

async function snapshot() {
  const cfg = settings();
  const admin = await connect(cfg, "postgres");
  await admin.query(readFileSync(join(HERE, "roles.sql"), "utf8"));
  await dropDatabase(admin, SNAPSHOT_BUILD_DB);
  await admin.query(`create database "${SNAPSHOT_BUILD_DB}"`);

  console.log(`\nBuilding ${SNAPSHOT_BUILD_DB} from the migrations\n`);
  await buildFromMigrations(cfg, SNAPSHOT_BUILD_DB);

  process.stdout.write("  pg_dump … ");
  const dump = spawnSync(
    "pg_dump",
    ["--no-owner", "--inserts", "-h", cfg.host, "-p", String(cfg.port), "-U", cfg.user, "-d", SNAPSHOT_BUILD_DB],
    { env: { ...process.env, PGPASSWORD: cfg.password }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  await dropDatabase(admin, SNAPSHOT_BUILD_DB);
  await admin.end();
  if (dump.error) fail(`Could not run pg_dump (${dump.error.message}). Add PostgreSQL's bin folder to PATH.`);
  if (dump.status !== 0) fail(`pg_dump failed:\n${dump.stderr}`);
  console.log("ok");

  const files = migrationFiles();
  const last = files[files.length - 1];
  const header = [
    "-- Torres Pest Control — the whole database in one file, for `npm run db:local`.",
    "--",
    `-- GENERATED by \`npm run db:snapshot\`: supabase/schema-v2.sql plus migrations up to ${last},`,
    "-- after supabase/local/roles.sql and bootstrap.sql, exported with pg_dump. Do not edit by",
    "-- hand: add a migration, then regenerate this file and commit both.",
    "",
  ].join("\n");
  writeFileSync(SNAPSHOT, `${header}\n${stripPsqlCommands(dump.stdout)}`);
  console.log(`\nWrote supabase/local/torres-database.sql (up to ${last}). Commit it with the migration.\n`);
}

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest);
const run = command === "snapshot" ? snapshot() : setup(flags);
run.catch((error) => fail(error.stack || error.message));
