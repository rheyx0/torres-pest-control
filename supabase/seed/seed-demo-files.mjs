#!/usr/bin/env node
//
// Torres Pest Control — demo files (the half of the demo data that SQL cannot do)
//
// seed-demo-data.sql fills every table except three things: client documents,
// report attachments and report signatures. Those are not really rows — they
// are rows POINTING AT BYTES in the private Storage buckets. Inserting the
// rows from SQL and leaving the buckets empty would give you a client whose
// every document 404s on click, which is worse than an empty documents panel.
//
// So this script does what the app does: uploads real files first, then writes
// the metadata that refers to them. Same buckets, same path conventions, same
// categories — see uploadDocument() in src/services/clientService.js and
// uploadAttachment() / uploadSignature() in src/services/appointmentService.js.
//
// The files are generated here rather than committed: a handful of small PDFs
// and PNGs built byte by byte, no dependencies beyond Node's own zlib. They
// are obviously placeholders when opened, which is the point — nobody should
// mistake demo paperwork for a real client's ID.
//
// RUN IT AFTER seed-demo-data.sql. It reads the clients and appointments that
// script created and attaches files to them; on its own it has nothing to
// attach to and will say so.
//
//   export SUPABASE_URL='https://<project>.supabase.co'
//   export SUPABASE_SERVICE_ROLE_KEY='<service role key>'
//   node supabase/seed/seed-demo-files.mjs
//
// The SERVICE ROLE key, not the publishable one. Uploading into a private
// bucket and writing appointment_report_attachments both sit behind rules the
// anon key is correctly not allowed through. Keep that key out of the repo and
// out of your shell history — it bypasses every policy in the database.
//
// Re-runnable: it removes the demo files it wrote last time (matched by the
// marker below) before writing them again, so it will not pile up duplicates.

import { createClient } from "@supabase/supabase-js";
import { deflateSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

// Written into every generated file so a re-run can find its own leftovers
// without touching anything a human uploaded through the app.
const MARKER = "TPC-DEMO";

const DOCUMENT_BUCKET = "client-documents";
const ATTACHMENT_BUCKET = "report-attachments";

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function readEnvLocal(key) {
  // Convenience only: the URL is not a secret and usually already sits in
  // .env.local. The service role key is never read from there.
  if (!existsSync(".env.local")) return null;
  const line = readFileSync(".env.local", "utf8")
    .split("\n")
    .find((entry) => entry.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : null;
}

/** Resolved in main(), so this file can be imported and its generators tested. */
let db = null;

function connect() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL ||
    readEnvLocal("REACT_APP_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "Missing connection details.\n\n" +
        "  export SUPABASE_URL='https://<project>.supabase.co'\n" +
        "  export SUPABASE_SERVICE_ROLE_KEY='<service role key>'\n\n" +
        "The service role key is required: the buckets are private and the\n" +
        "attachment table is not writable with the publishable key."
    );
    process.exit(1);
  }

  db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return url;
}

// ---------------------------------------------------------------------------
// File generation
//
// Both formats are written by hand. A PDF because the smallest valid one is
// about twenty lines, and a PNG because the alternative is an image library
// for what amounts to a coloured rectangle.
// ---------------------------------------------------------------------------

/** A single-page PDF with a few lines of text on it. */
function makePdf(title, lines) {
  const escape = (s) => String(s).replace(/([\\()])/g, "\\$1");
  const body = [
    "BT /F1 16 Tf 56 760 Td (" + escape(title) + ") Tj ET",
    "BT /F1 9 Tf 56 736 Td (" + escape(`${MARKER} — generated placeholder, not a real document`) + ") Tj ET",
    ...lines.map((line, i) => `BT /F1 11 Tf 56 ${700 - i * 18} Td (${escape(line)}) Tj ET`),
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/**
 * An RGB PNG. `paint(x, y)` returns [r, g, b] for each pixel — enough to make
 * a recognisable placeholder photo or a signature stroke without a canvas.
 */
function makePng(width, height, paint) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    raw[p] = 0; // filter: none
    p += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
      p += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A 3x5 bitmap font, scaled up when drawn. Enough to label a placeholder with
 * what it is supposed to show — three identical brown rectangles in a Report
 * tab tell a reviewer nothing.
 */
const GLYPHS = {
  A: "111101111101101", B: "110101110101110", C: "111100100100111", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "111100101101111", H: "101101111101101",
  I: "111010010010111", J: "001001001101111", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "101111111111101", O: "111101101101111", P: "111101111100100",
  Q: "111101101111001", R: "111101111110101", S: "111100111001111", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111",
  0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111",
  4: "101101111001001", 5: "111100111001111", 6: "111100111101111", 7: "111001001001001",
  8: "111101111101111", 9: "111101111001111",
  " ": "000000000000000", "-": "000000111000000", ".": "000000000000010",
  "/": "001001010100100", ":": "000010000010000", "#": "101111101111101",
};

/** Pixels lit by `text` drawn at (originX, originY), as a Set of "x,y" keys. */
function textMask(text, originX, originY, scale) {
  const lit = new Set();
  let cursor = originX;
  for (const raw of text.toUpperCase()) {
    const glyph = GLYPHS[raw] ?? GLYPHS["#"];
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        if (glyph[row * 3 + col] !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            lit.add(`${cursor + col * scale + dx},${originY + row * scale + dy}`);
          }
        }
      }
    }
    cursor += 4 * scale;
  }
  return lit;
}

/** A site photo placeholder, labelled with the category and what it depicts. */
function makePhoto(tint, caption = "") {
  const W = 640, H = 420;
  const base = { BEFORE: [122, 96, 78], AFTER: [96, 122, 94], INSPECTION: [92, 104, 126] }[tint] || [110, 110, 110];

  const heading = textMask(tint, 28, 30, 7);
  const sub = textMask(`${MARKER} PLACEHOLDER`, 28, 84, 3);
  const label = textMask(caption.replace(/\.[a-z]+$/i, "").slice(0, 38), 28, H - 44, 4);

  return makePng(W, H, (x, y) => {
    const key = `${x},${y}`;
    if (heading.has(key)) return [250, 248, 244];
    if (sub.has(key)) return [226, 218, 206];
    if (label.has(key)) return [250, 248, 244];
    if (x < 6 || y < 6 || x > W - 7 || y > H - 7) return [40, 34, 28];   // frame
    if (y > H - 60) return [34, 29, 24];                                  // caption bar
    const horizon = H * 0.62;
    const shade = y < horizon ? 1.15 - (y / horizon) * 0.25 : 0.72;
    const grain = ((x * 7 + y * 13) % 17) - 8;
    return base.map((c) => Math.max(0, Math.min(255, Math.round(c * shade + grain))));
  });
}

/** A signature: dark ink on white, a couple of sine strokes and a baseline. */
function makeSignature(seed) {
  const W = 420, H = 150;
  const wobble = (seed % 5) + 3;
  return makePng(W, H, (x, y) => {
    if (y === H - 28 && x > 24 && x < W - 24) return [170, 170, 170];          // signing line
    const t = (x - 30) / (W - 60);
    if (t >= 0 && t <= 1) {
      const stroke =
        H * 0.52 -
        Math.sin(t * Math.PI * wobble) * 26 -
        Math.sin(t * Math.PI * (wobble * 2.3) + seed) * 9;
      if (Math.abs(y - stroke) < 2.2) return [22, 28, 60];
      const tail = H * 0.62 - Math.sin(t * Math.PI * 1.2) * 6;
      if (t > 0.55 && Math.abs(y - tail) < 1.2) return [22, 28, 60];
    }
    return [255, 255, 255];
  });
}

// ---------------------------------------------------------------------------
// Path conventions — must match the app, or its signed URLs will not resolve.
// ---------------------------------------------------------------------------

const safeFileName = (name) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
const documentPath = (clientId, name) => `${clientId}/${randomUUID()}-${safeFileName(name)}`;
const attachmentPath = (appointmentId, name) => `${appointmentId}/${randomUUID()}-${safeFileName(name)}`;
const signaturePath = (appointmentId, kind) =>
  `${appointmentId}/${kind === "technician" ? "technician-signature" : "signature"}-${randomUUID()}.png`;

async function upload(bucket, path, body, contentType) {
  const { error } = await db.storage.from(bucket).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`upload ${bucket}/${path}: ${error.message}`);
  return path;
}

// ---------------------------------------------------------------------------
// What gets attached to whom
// ---------------------------------------------------------------------------

const DOCUMENTS = [
  ["TPC-C-0001", "CLIENT_ID", "Juan Dela Cruz - PhilSys ID.pdf", "Valid ID on file", ["Holder: Juan Dela Cruz", "Presented at the Ulas visit and photocopied for the file."]],
  ["TPC-C-0002", "CLIENT_ID", "M L Sarmiento - Drivers Licence.pdf", "Valid ID on file", ["Holder: Maria Lourdes Sarmiento"]],
  ["TPC-C-0002", "PROPERTY", "Lot title - Matina Crossing.pdf", "Transfer certificate of title", ["24 Sampaguita St., Matina Crossing, Davao City", "Held for the soil-treatment warranty."]],
  ["TPC-C-0003", "PERMIT", "Business permit 2026 - Arawan.pdf", "Mayor's permit", ["Arawan Logistics Center", "Toril, Davao City", "Valid until 31 December 2026"]],
  ["TPC-C-0003", "PROPERTY", "Warehouse floor plan - bait stations.pdf", "Bait station layout", ["24 exterior stations, numbered clockwise from Gate 1.", "Stations 11 and 12 sit either side of Gate 3."]],
  ["TPC-C-0004", "PERMIT", "Sanitary permit - Kadayawan Suites.pdf", "Sanitary permit", ["City Health Office, Davao City", "Covers kitchen, laundry and all guest floors."]],
  ["TPC-C-0004", "OTHER", "Service agreement 2026 - Kadayawan.pdf", "Monthly service agreement", ["Monthly general treatment and bed bug monitoring.", "Contract value: PHP 12,500 per visit."]],
  ["TPC-C-0006", "PERMIT", "HACCP certificate - Mindanao Fruits.pdf", "HACCP certification", ["Packing line and cold store.", "Chemical list and MSDS to be presented to QA each visit."]],
  ["TPC-C-0006", "OTHER", "Chemical list and MSDS summary.pdf", "Approved chemical list", ["Quickphos Fumigation Tablets — licensed fumigator only", "Demand CS 2.5 — perimeter only, never over the line"]],
  ["TPC-C-0008", "PERMIT", "DOH clinic permit.pdf", "Clinic operating permit", ["San Pedro Medical Clinic", "Low-odour products only."]],
  ["TPC-C-0012", "OTHER", "Purchase Order 2024-0188.pdf", "Purchase order", ["Barangay Ulas Multi-Purpose Hall", "PO must appear on the service form before Accounting will pay."]],
];

// Photos and signed forms, hung off completed visits by their client reference
// and position in that client's history (0 = most recent).
const ATTACHMENTS = [
  ["TPC-C-0004", 0, "BEFORE", "Room 412 headboard - before.png", "photo"],
  ["TPC-C-0004", 0, "AFTER", "Room 412 headboard - after.png", "photo"],
  ["TPC-C-0004", 0, "SIGNED_FORM", "Service form - Kadayawan Suites.pdf", "form"],
  ["TPC-C-0005", 0, "BEFORE", "Wet market drain line - before.png", "photo"],
  ["TPC-C-0005", 0, "AFTER", "Wet market drain line - after.png", "photo"],
  ["TPC-C-0003", 0, "INSPECTION", "Gate 3 station tampered.png", "photo"],
  ["TPC-C-0003", 0, "TREATMENT_PROOF", "Perimeter stations re-baited.png", "photo"],
  ["TPC-C-0006", 0, "BEFORE", "Reject bin bay - before fumigation.png", "photo"],
  ["TPC-C-0006", 0, "AFTER", "Reject bin bay - after fumigation.png", "photo"],
  ["TPC-C-0006", 0, "SIGNED_FORM", "Fumigation clearance - QA signed.pdf", "form"],
  ["TPC-C-0002", 0, "INSPECTION", "Mud tubes western foundation.png", "photo"],
  ["TPC-C-0002", 0, "TREATMENT_PROOF", "Drill and inject - extension slab.png", "photo"],
  ["TPC-C-0009", 0, "INSPECTION", "Ceiling void above kitchen.png", "photo"],
  ["TPC-C-0001", 0, "BEFORE", "Under sink harbourage.png", "photo"],
  ["TPC-C-0010", 0, "INSPECTION", "Garbage room door gap.png", "photo"],
];

// Visits signed on the tablet. The rest keep the written completion note the
// SQL seed gave them — that is the "customer signed the printed form" path,
// and a visit should read as one or the other, not both.
const SIGNED_ON_TABLET = [
  ["TPC-C-0004", 0, "Rowena Bautista"],
  ["TPC-C-0005", 0, "Arnel Bautista"],
  ["TPC-C-0006", 0, "Engr. Dante Ramos"],
  ["TPC-C-0002", 0, "Maria Lourdes Sarmiento"],
  ["TPC-C-0001", 0, "Juan Dela Cruz"],
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// `injected` exists so the whole run can be exercised against a stub client
// without a Supabase project. Nothing else passes it.
async function main(injected = null) {
  if (injected) { db = injected; console.log("Running against an injected client"); }
  else console.log(`Connecting to ${connect()}`);

  const { data: clients, error: clientError } = await db
    .from("clients")
    .select("id, reference, name")
    .like("reference", "TPC-C-%");
  if (clientError) throw new Error(`reading clients: ${clientError.message}`);

  const { data: appointments, error: apptError } = await db
    .from("appointments")
    .select("id, client_id, scheduled_at, status")
    .eq("status", "Completed")
    .order("scheduled_at", { ascending: false });
  if (apptError) throw new Error(`reading appointments: ${apptError.message}`);

  if (!clients?.length || !appointments?.length) {
    console.error(
      "\nNothing to attach files to.\n" +
        "Run supabase/seed/seed-demo-data.sql first — this script decorates the\n" +
        "clients and completed visits that it creates."
    );
    process.exit(1);
  }

  const byReference = new Map(clients.map((c) => [c.reference, c]));
  const completedFor = (reference) => {
    const client = byReference.get(reference);
    if (!client) return [];
    return appointments.filter((a) => a.client_id === client.id);
  };

  // --- clear what a previous run left behind -------------------------------
  console.log("Clearing demo files from a previous run…");
  const clientIds = clients.map((c) => c.id);
  const appointmentIds = appointments.map((a) => a.id);

  const { data: oldDocs } = await db.from("client_documents").select("id, storage_path").in("client_id", clientIds);
  if (oldDocs?.length) {
    await db.storage.from(DOCUMENT_BUCKET).remove(oldDocs.map((d) => d.storage_path));
    await db.from("client_documents").delete().in("id", oldDocs.map((d) => d.id));
  }
  const { data: oldFiles } = await db
    .from("appointment_report_attachments")
    .select("id, storage_path")
    .in("appointment_id", appointmentIds);
  if (oldFiles?.length) {
    await db.storage.from(ATTACHMENT_BUCKET).remove(oldFiles.map((f) => f.storage_path));
    await db.from("appointment_report_attachments").delete().in("id", oldFiles.map((f) => f.id));
  }
  console.log(`  removed ${oldDocs?.length || 0} document(s), ${oldFiles?.length || 0} attachment(s)`);

  // --- client documents ----------------------------------------------------
  let documentCount = 0;
  for (const [reference, category, name, title, lines] of DOCUMENTS) {
    const client = byReference.get(reference);
    if (!client) continue;
    const bytes = makePdf(title, [`Client: ${client.name} (${reference})`, "", ...lines]);
    const path = await upload(DOCUMENT_BUCKET, documentPath(client.id, name), bytes, "application/pdf");
    const { error } = await db.from("client_documents").insert({
      client_id: client.id,
      name,
      mime_type: "application/pdf",
      size_bytes: bytes.length,
      storage_path: path,
      category,
    });
    if (error) throw new Error(`client_documents ${name}: ${error.message}`);
    documentCount += 1;
  }
  console.log(`Client documents: ${documentCount}`);

  // --- report attachments --------------------------------------------------
  let attachmentCount = 0;
  for (const [reference, index, category, name, kind] of ATTACHMENTS) {
    const appointment = completedFor(reference)[index];
    if (!appointment) continue;
    const isPhoto = kind === "photo";
    const bytes = isPhoto
      ? makePhoto(category, name)
      : makePdf(name.replace(/\.pdf$/, ""), [
          `Client: ${byReference.get(reference)?.name}`,
          `Visit: ${new Date(appointment.scheduled_at).toLocaleString("en-PH")}`,
          "",
          "Signed hard copy scanned into the file.",
        ]);
    const path = await upload(
      ATTACHMENT_BUCKET,
      attachmentPath(appointment.id, name),
      bytes,
      isPhoto ? "image/png" : "application/pdf"
    );
    const { error } = await db.from("appointment_report_attachments").insert({
      appointment_id: appointment.id,
      name,
      mime_type: isPhoto ? "image/png" : "application/pdf",
      size_bytes: bytes.length,
      storage_path: path,
      category,
    });
    if (error) throw new Error(`attachment ${name}: ${error.message}`);
    attachmentCount += 1;
  }
  console.log(`Report attachments: ${attachmentCount}`);

  // --- signatures ----------------------------------------------------------
  let signatureCount = 0;
  for (const [index, entry] of SIGNED_ON_TABLET.entries()) {
    const [reference, position, customerName] = entry;
    const appointment = completedFor(reference)[position];
    if (!appointment) continue;

    const customer = makeSignature(index + 2);
    const technician = makeSignature(index + 7);
    const customerKey = await upload(ATTACHMENT_BUCKET, signaturePath(appointment.id, "customer"), customer, "image/png");
    const technicianKey = await upload(ATTACHMENT_BUCKET, signaturePath(appointment.id, "technician"), technician, "image/png");

    const { error } = await db
      .from("appointment_reports")
      .update({
        customer_name: customerName,
        signature_path: customerKey,
        signed_at: appointment.scheduled_at,
        technician_signature_path: technicianKey,
        technician_signed_at: appointment.scheduled_at,
        // Cleared deliberately: this visit was signed on the tablet, so the
        // "they signed the printed form" note no longer applies to it.
        completion_note: null,
      })
      .eq("appointment_id", appointment.id);
    if (error) throw new Error(`signature for ${reference}: ${error.message}`);
    signatureCount += 1;
  }
  console.log(`Signed visits: ${signatureCount}`);

  console.log(
    `\nDone. ${documentCount} documents, ${attachmentCount} attachments, ` +
      `${signatureCount} signed visits.\n` +
      "Open a client profile and a completed visit's Report tab to check the\n" +
      "files preview and download."
  );
}

export { main, makePdf, makePng, makePhoto, makeSignature, safeFileName, documentPath, attachmentPath, signaturePath };

// Only run when invoked directly, so a test can import the generators above.
if (process.argv[1] && process.argv[1].endsWith("seed-demo-files.mjs")) {
  main().catch((error) => {
    console.error(`\nFailed: ${error.message}`);
    process.exit(1);
  });
}
