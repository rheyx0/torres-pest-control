#!/usr/bin/env node
//
// Torres Pest Control — the local API (Technical Manual §4).
//
//   npm run local
//
// Stands in for Supabase on this computer so the app runs unchanged against
// the local PostgreSQL database that `npm run db:local` created:
//
//   http://localhost:54321/rest/v1/…      → PostgREST (started here, on 127.0.0.1:54322)
//   http://localhost:54321/storage/v1/…   → files in supabase/local/storage/<bucket>/<path>
//   http://localhost:54321/functions/v1/… → 503: the forgot-password email needs the
//                                            hosted Edge Function, so the app shows its
//                                            "ask an administrator" message instead
//
// The app reaches it through REACT_APP_SUPABASE_URL=http://localhost:54321 in
// .env.local. Requests arrive exactly as supabase-js sends them to Supabase;
// the publishable key is ignored and every database request runs as `anon`
// with the x-session-token header, which is what the RLS policies read.
//
// Storage keeps Supabase's rules that matter here: buckets and their size and
// file-type limits come from storage.buckets (migrations 001, 013, 028, 074),
// an upload, signed link or delete needs a live session (validate_session),
// private files are read only through short-lived signed links, and only the
// public bucket (profile-avatars) is readable by plain URL. Each stored file
// also gets its storage.objects row, as on Supabase.
//
// Settings come from .env.local: POSTGREST_PATH, LOCAL_DB_PASSWORD, and the
// optional LOCAL_DB_HOST / LOCAL_DB_PORT / LOCAL_DB_USER / LOCAL_DB_NAME.

import http from "node:http";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync, createReadStream } from "node:fs";
import { join, dirname, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const STORAGE_DIR = join(HERE, "storage");
const API_PORT = 54321;
const POSTGREST_PORT = 54322;
const AUTHENTICATOR_PASSWORD = "torres-local-api"; // supabase/local/roles.sql
const SIGNING_SECRET = randomBytes(32); // signed links last until this process stops

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

if (!existsSync(join(ROOT, ".env.local"))) {
  fail("There is no .env.local in the project folder. Create it first:  copy .env.local.example .env.local");
}

const db = {
  host: readEnv("LOCAL_DB_HOST") || "localhost",
  port: Number(readEnv("LOCAL_DB_PORT") || 5432),
  user: readEnv("LOCAL_DB_USER") || "postgres",
  password: readEnv("LOCAL_DB_PASSWORD"),
  database: readEnv("LOCAL_DB_NAME") || "torres_pest_control",
};
if (!db.password) fail("LOCAL_DB_PASSWORD is empty in .env.local. Set it to your postgres password.");

const postgrestPath =
  readEnv("POSTGREST_PATH") || (process.platform === "win32" ? "C:\\postgrest\\postgrest.exe" : "postgrest");

// ---------------------------------------------------------------------------
// Before starting: the database must exist and be set up.

const pool = new pg.Pool({ ...db, max: 4 });

async function preflight() {
  try {
    const { rows } = await pool.query("select to_regclass('public.admins') is not null as built");
    if (!rows[0].built) fail(`The database ${db.database} is empty. Run:  npm run db:local -- --reset`);
  } catch (error) {
    if (error.code === "3D000") fail(`The database ${db.database} does not exist yet. Run:  npm run db:local`);
    if (error.code === "28P01") fail("PostgreSQL refused the password. Check LOCAL_DB_PASSWORD in .env.local.");
    if (error.code === "ECONNREFUSED") {
      fail(`Could not connect to PostgreSQL on ${db.host}:${db.port}.\nIs it running? Windows key → "services" → postgresql-x64-16 → Start.`);
    }
    fail(`Could not check the database: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// PostgREST, started as a child process and stopped with this one.

let postgrest;

function startPostgrest() {
  if (postgrestPath.includes("\\") || postgrestPath.includes("/")) {
    if (!existsSync(postgrestPath)) {
      fail(`postgrest.exe not found at ${postgrestPath}.\nUnzip PostgREST to C:\\postgrest, or set POSTGREST_PATH in .env.local.`);
    }
  }
  const dbUri = `postgres://authenticator:${AUTHENTICATOR_PASSWORD}@${db.host}:${db.port}/${db.database}`;
  postgrest = spawn(postgrestPath, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: dbUri,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(POSTGREST_PORT),
      PGRST_LOG_LEVEL: "error",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const relay = (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) console.log(`  [PostgREST] ${line}`);
  };
  postgrest.stdout.on("data", relay);
  postgrest.stderr.on("data", relay);
  postgrest.on("error", (error) => {
    if (error.code === "ENOENT") fail(`Could not start PostgREST (${postgrestPath} not found). Set POSTGREST_PATH in .env.local.`);
    fail(`Could not start PostgREST: ${error.message}`);
  });
  postgrest.on("exit", (code) => {
    if (shuttingDown) return;
    // 0xC0000135 (3221225781): Windows could not find a DLL, i.e. libpq.dll.
    const hint = code === 3221225781 || code === -1073741515
      ? "\nWindows could not find LIBPQ.dll: add C:\\Program Files\\PostgreSQL\\16\\bin to PATH and open a new Command Prompt."
      : "";
    fail(`PostgREST stopped (exit code ${code}).${hint}`);
  });
}

async function waitForPostgrest() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port: POSTGREST_PORT, path: "/" }, (res) => {
        res.resume();
        resolve(res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1000, () => req.destroy());
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail("PostgREST did not start within 30 seconds. See the [PostgREST] lines above.");
}

let shuttingDown = false;
function shutdown() {
  shuttingDown = true;
  if (postgrest && !postgrest.killed) postgrest.kill();
  pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  if (postgrest && !postgrest.killed) postgrest.kill();
});

// ---------------------------------------------------------------------------
// HTTP helpers

const EXPOSED = "Content-Range, Content-Profile, Content-Location, Location, Range-Unit, Preference-Applied, X-Total-Count";

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "*");
  res.setHeader("Access-Control-Expose-Headers", EXPOSED);
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** The error shape storage-js reads (message ends up in describeError). */
function storageError(res, status, error, message) {
  sendJson(res, status, { statusCode: String(status), error, message });
}

function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// /rest/v1 → PostgREST

const DROPPED_HEADERS = new Set(["host", "authorization", "apikey", "connection", "origin", "referer"]);

function proxyRest(req, res, path, search) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!DROPPED_HEADERS.has(key)) headers[key] = value;
  }
  const upstream = http.request(
    { host: "127.0.0.1", port: POSTGREST_PORT, method: req.method, path: `${path || "/"}${search}`, headers },
    (reply) => {
      const out = { ...reply.headers };
      delete out["access-control-allow-origin"];
      res.writeHead(reply.statusCode, out);
      reply.pipe(res);
    },
  );
  upstream.on("error", () => sendJson(res, 502, { message: "The local database API (PostgREST) is not responding." }));
  req.pipe(upstream);
}

// ---------------------------------------------------------------------------
// /storage/v1 → supabase/local/storage

async function sessionIsValid(req) {
  const token = req.headers["x-session-token"];
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return false;
  const { rowCount } = await pool.query("select 1 from public.validate_session($1::uuid)", [token]);
  return rowCount > 0;
}

async function bucketById(id) {
  const { rows } = await pool.query(
    "select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = $1",
    [id],
  );
  return rows[0] || null;
}

/** "client-documents/abc/file name.pdf" → { bucket, name }, refusing anything that climbs out. */
function splitObjectPath(rest) {
  const parts = rest.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts.length < 2) return null;
  if (parts.some((part) => part === "." || part === ".." || /[\\\0:]/.test(part))) return null;
  return { bucket: parts[0], name: parts.slice(1).join("/") };
}

function diskPath(bucket, name) {
  const full = join(STORAGE_DIR, bucket, ...name.split("/"));
  if (!full.startsWith(join(STORAGE_DIR, bucket) + sep)) return null;
  return full;
}

/** The one file part of supabase-js's multipart upload, with its content type. */
function parseMultipart(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!match) return null;
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  let file = null;
  let start = body.indexOf(boundary);
  while (start !== -1) {
    const next = body.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const part = body.subarray(start + boundary.length + 2, next - 2); // skip CRLF after the boundary and before the next
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const head = part.subarray(0, split).toString("utf8");
      const content = part.subarray(split + 4);
      if (/filename=/i.test(head)) {
        const type = /content-type:\s*([^\r\n]+)/i.exec(head);
        file = { data: content, type: type ? type[1].trim() : "application/octet-stream" };
      }
    }
    start = next;
  }
  return file;
}

function sign(bucket, name, expiresIn) {
  const payload = Buffer.from(JSON.stringify({ b: bucket, n: name, e: Date.now() + expiresIn * 1000 })).toString("base64url");
  const mac = createHmac("sha256", SIGNING_SECRET).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function verify(token, bucket, name) {
  const [payload, mac] = String(token || "").split(".");
  if (!payload || !mac) return false;
  const expected = createHmac("sha256", SIGNING_SECRET).update(payload).digest("base64url");
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return claims.b === bucket && claims.n === name && claims.e > Date.now();
}

async function serveFile(res, bucket, name, download) {
  const file = diskPath(bucket, name);
  if (!file || !existsSync(file)) return storageError(res, 404, "not_found", "Object not found");
  const { rows } = await pool.query(
    "select metadata->>'mimetype' as type from storage.objects where bucket_id = $1 and name = $2",
    [bucket, name],
  );
  const headers = {
    "Content-Type": rows[0]?.type || "application/octet-stream",
    "Content-Length": statSync(file).size,
    "Cache-Control": "private, max-age=60",
  };
  if (download !== null) {
    const filename = (download || basename(name)).replace(/["\r\n]/g, "");
    headers["Content-Disposition"] = `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

async function handleStorage(req, res, rest, query) {
  // GET /object/public/<bucket>/<path>: only for public buckets (profile photos)
  if (req.method === "GET" && rest.startsWith("/object/public/")) {
    const target = splitObjectPath(rest.slice("/object/public/".length));
    if (!target) return storageError(res, 400, "invalid", "Invalid path");
    const bucket = await bucketById(target.bucket);
    if (!bucket?.public) return storageError(res, 400, "not_public", "Bucket is not public");
    return serveFile(res, target.bucket, target.name, query.has("download") ? query.get("download") : null);
  }

  // GET /object/sign/<bucket>/<path>?token=…: a signed link
  if (req.method === "GET" && rest.startsWith("/object/sign/")) {
    const target = splitObjectPath(rest.slice("/object/sign/".length));
    if (!target) return storageError(res, 400, "invalid", "Invalid path");
    if (!verify(query.get("token"), target.bucket, target.name)) {
      return storageError(res, 400, "InvalidSignature", "This link has expired. Open the file again from the app.");
    }
    return serveFile(res, target.bucket, target.name, query.has("download") ? query.get("download") : null);
  }

  // Everything else changes something: it needs a signed-in user of the app.
  if (!(await sessionIsValid(req))) {
    return storageError(res, 403, "Unauthorized", "Your session has expired. Sign in again.");
  }

  // POST /object/sign/<bucket>/<path> { expiresIn }: create a signed link
  if (req.method === "POST" && rest.startsWith("/object/sign/")) {
    const target = splitObjectPath(rest.slice("/object/sign/".length));
    if (!target) return storageError(res, 400, "invalid", "Invalid path");
    const file = diskPath(target.bucket, target.name);
    if (!file || !existsSync(file)) return storageError(res, 404, "not_found", "Object not found");
    const { expiresIn = 60 } = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const token = sign(target.bucket, target.name, Math.min(Number(expiresIn) || 60, 7 * 24 * 3600));
    return sendJson(res, 200, { signedURL: `/object/sign/${target.bucket}/${target.name}?token=${token}` });
  }

  // DELETE /object/<bucket> { prefixes: [...] }: remove files
  if (req.method === "DELETE" && /^\/object\/[^/]+\/?$/.test(rest)) {
    const bucket = decodeURIComponent(rest.split("/")[2]);
    const { prefixes = [] } = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const removed = [];
    for (const name of prefixes) {
      const target = splitObjectPath(`${bucket}/${name}`);
      const file = target && diskPath(target.bucket, target.name);
      if (!file) continue;
      if (existsSync(file)) unlinkSync(file);
      const { rowCount } = await pool.query("delete from storage.objects where bucket_id = $1 and name = $2", [bucket, target.name]);
      if (rowCount) removed.push({ name: target.name, bucket_id: bucket });
    }
    return sendJson(res, 200, removed);
  }

  // POST|PUT /object/<bucket>/<path>: upload (POST honours x-upsert)
  if ((req.method === "POST" || req.method === "PUT") && rest.startsWith("/object/")) {
    const target = splitObjectPath(rest.slice("/object/".length));
    if (!target) return storageError(res, 400, "invalid", "Invalid path");
    const bucket = await bucketById(target.bucket);
    if (!bucket) return storageError(res, 404, "Bucket not found", `Bucket ${target.bucket} not found`);

    const body = await readBody(req);
    const contentType = req.headers["content-type"] || "";
    const upload = contentType.startsWith("multipart/form-data")
      ? parseMultipart(body, contentType)
      : { data: body, type: contentType || "application/octet-stream" };
    if (!upload) return storageError(res, 400, "invalid", "No file in the upload");

    if (bucket.file_size_limit && upload.data.length > Number(bucket.file_size_limit)) {
      return storageError(res, 413, "Payload too large", "The object exceeded the maximum allowed size");
    }
    if (bucket.allowed_mime_types?.length && !bucket.allowed_mime_types.includes(upload.type)) {
      return storageError(res, 415, "invalid_mime_type", `mime type ${upload.type} is not supported`);
    }

    const file = diskPath(target.bucket, target.name);
    if (!file) return storageError(res, 400, "invalid", "Invalid path");
    const upsert = req.method === "PUT" || req.headers["x-upsert"] === "true";
    if (existsSync(file) && !upsert) return storageError(res, 409, "Duplicate", "The resource already exists");

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, upload.data);
    const metadata = { mimetype: upload.type, size: upload.data.length };
    const { rows } = await pool.query(
      `insert into storage.objects (id, bucket_id, name, metadata)
       values ($1, $2, $3, $4)
       on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()
       returning id`,
      [randomUUID(), target.bucket, target.name, metadata],
    );
    return sendJson(res, 200, { Id: rows[0].id, Key: `${target.bucket}/${target.name}` });
  }

  return storageError(res, 404, "not_found", "Not supported by the local storage");
}

// ---------------------------------------------------------------------------
// The API server

async function handle(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, `http://localhost:${API_PORT}`);
  const path = url.pathname;
  try {
    if (path === "/rest/v1" || path.startsWith("/rest/v1/")) return proxyRest(req, res, path.slice("/rest/v1".length), url.search);
    if (path.startsWith("/storage/v1/")) return await handleStorage(req, res, path.slice("/storage/v1".length), url.searchParams);
    if (path.startsWith("/functions/v1/")) {
      return sendJson(res, 503, { error: "Not available in the local setup. Ask an administrator to reset your password." });
    }
    if (path === "/") return sendJson(res, 200, { status: "Torres Pest Control local API is running" });
    return sendJson(res, 404, { message: "Not found" });
  } catch (error) {
    console.error(`  [API] ${req.method} ${path}: ${error.message}`);
    if (!res.headersSent) sendJson(res, error.status || 500, { statusCode: String(error.status || 500), error: "error", message: error.message });
  }
}

/** Listen on this computer only (no firewall prompt), on IPv4 and, where present, IPv6. */
function listen() {
  return new Promise((resolve) => {
    const v4 = http.createServer(handle);
    v4.on("error", (error) => {
      if (error.code === "EADDRINUSE") fail(`Port ${API_PORT} is already in use. Is npm run local already running in another window?`);
      fail(`Could not start the local API: ${error.message}`);
    });
    v4.listen(API_PORT, "127.0.0.1", () => {
      const v6 = http.createServer(handle);
      v6.on("error", () => {}); // no IPv6 loopback: IPv4 is enough
      v6.listen(API_PORT, "::1");
      resolve();
    });
  });
}

console.log("\nStarting the Torres Pest Control local API …");
await preflight();
startPostgrest();
await waitForPostgrest();
await listen();
console.log(`
Local API ready at http://localhost:${API_PORT}
  database: ${db.database} on ${db.host}:${db.port}
  files:    supabase/local/storage

Keep this window open. In a second window run:  npm start
Press Ctrl+C here to stop.
`);
