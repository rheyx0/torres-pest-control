#!/usr/bin/env node
//
// Torres Pest Control — create the local database (Technical Manual §4).
//
//   npm run db:local                   create torres_pest_control and the admin account
//   npm run db:local -- --demo         … and load the demo data (also works on an existing database)
//   npm run db:local -- --reset        delete the database and build it again from scratch
//
// The database is built the way a new Supabase project gets it: roles.sql and
// bootstrap.sql (the parts of Supabase a plain PostgreSQL lacks), then every
// file in supabase/migrations in name order: the baseline, which is the whole
// database in one file, then any migration added after it. Nothing has to be
// regenerated after adding a migration; the next build runs it too.
//
// Settings come from .env.local in the project root:
//
//   LOCAL_DB_PASSWORD     the password of the postgres user (set when PostgreSQL was installed)
//   LOCAL_ADMIN_PASSWORD  the password for the system's first account, username "admin"
//   LOCAL_DB_HOST / LOCAL_DB_PORT / LOCAL_DB_USER / LOCAL_DB_NAME
//                         optional; default localhost / 5432 / postgres / torres_pest_control

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPABASE_DIR = join(HERE, "..");
const ROOT = join(SUPABASE_DIR, "..");
const MIGRATIONS_DIR = join(SUPABASE_DIR, "migrations");
const SEED_DIR = join(SUPABASE_DIR, "seed");
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

/** Supabase CLI migrations, <timestamp>_<name>.sql, oldest first. */
function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{14}_.+\.sql$/.test(file))
    .sort();
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

/** bootstrap.sql, then every migration: the baseline first, then any added after it. */
async function buildFromMigrations(cfg, database) {
  const files = migrationFiles();
  if (files.length === 0) fail("supabase/migrations has no migrations; the baseline (20261105000000_baseline.sql) must be there.");
  const client = await connect(cfg, database);
  await runFile(client, join(HERE, "bootstrap.sql"), "bootstrap.sql");
  for (const file of files) {
    process.stdout.write(`  ${file} … `);
    await runFile(client, join(MIGRATIONS_DIR, file), `Migration ${file}`);
    console.log("ok");
  }
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
  process.stdout.write("  demo data (seed/seed-demo-data.sql) … ");
  await runFile(client, join(SEED_DIR, "seed-demo-data.sql"), "seed-demo-data.sql");
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
  await buildFromMigrations(cfg, cfg.database);
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

const [, ...rest] = process.argv.slice(2);
const flags = new Set(rest);
const run = setup(flags);
run.catch((error) => fail(error.stack || error.message));
