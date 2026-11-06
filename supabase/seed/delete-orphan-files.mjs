#!/usr/bin/env node
//
// Torres Pest Control — find (and optionally delete) uploaded client documents
// that no document record points at any more.
//
// A document deleted before the app removed its file, or a test reset that
// cleared the records (supabase/seed/reset-test-data.sql, cleanup-2026-11-06.sql),
// leaves the file behind in the client-documents bucket: invisible in the
// app, but still stored. SQL cannot delete Storage files (Supabase refuses a
// DELETE on storage.objects), so this uses the Storage API.
//
//   node supabase/seed/delete-orphan-files.mjs            list them, change nothing
//   node supabase/seed/delete-orphan-files.mjs --delete   delete them
//
// It needs the project's service role key (Dashboard → Project Settings → API
// keys → secret / service_role), which bypasses every security rule, so it is
// read from the environment only, never from a file:
//
//   PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY = "<key>"; node supabase/seed/delete-orphan-files.mjs
//
// The project URL comes from SUPABASE_URL, else REACT_APP_SUPABASE_URL in
// .env.local. Close the terminal afterwards so the key does not linger.

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "client-documents";
const doDelete = process.argv.includes("--delete");

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function fromEnvLocal(key) {
  if (!existsSync(".env.local")) return null;
  const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : null;
}

const url = process.env.SUPABASE_URL || fromEnvLocal("REACT_APP_SUPABASE_URL");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !/^https:\/\/.+\.supabase\.co/.test(url)) fail("Set SUPABASE_URL to the project's URL (https://<ref>.supabase.co). Run from the project folder.");
if (!key) fail("Set SUPABASE_SERVICE_ROLE_KEY in this terminal first (see the top of this file).");

const supabase = createClient(url, key, { auth: { persistSession: false } });

/** Every file path in the bucket, folders walked. */
async function listAll(prefix = "") {
  const paths = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) fail(`Could not list ${BUCKET}/${prefix}: ${error.message}`);
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) paths.push(...(await listAll(path))); // a folder
      else if (entry.name !== ".emptyFolderPlaceholder") paths.push(path);
    }
    if (data.length < 1000) break;
  }
  return paths;
}

const { data: records, error } = await supabase.from("client_documents").select("storage_path");
if (error) fail(`Could not read the document records: ${error.message}`);
const kept = new Set(records.map((row) => row.storage_path));

const files = await listAll();
const orphans = files.filter((path) => !kept.has(path));

console.log(`\n${files.length} files in ${BUCKET}, ${records.length} document records, ${orphans.length} files with no record.`);
orphans.forEach((path) => console.log(`  ${path}`));

if (!orphans.length) process.exit(0);
if (!doDelete) {
  console.log("\nNothing was deleted. Run again with --delete to remove these files.\n");
  process.exit(0);
}
for (let i = 0; i < orphans.length; i += 100) {
  const batch = orphans.slice(i, i + 100);
  const { error: removeError } = await supabase.storage.from(BUCKET).remove(batch);
  if (removeError) fail(`Stopped after ${i} files: ${removeError.message}`);
}
console.log(`\nDeleted ${orphans.length} files.\n`);
