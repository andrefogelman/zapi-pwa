/**
 * Migration script: Google Sheets "Grupos Autorizados" -> Supabase
 *
 * Usage:
 *   1. Export the Google Sheet (spreadsheet 1jFP8yzWbGq4xY8bnj6vpfdqnKOyNI_kInCwEnZZgE2Y,
 *      tab "Controle") as CSV and save to scripts/grupos.csv
 *   2. Set env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   3. Run: bun scripts/migrate-groups.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const csvPath = join(import.meta.dirname, "grupos.csv");
const csv = readFileSync(csvPath, "utf-8");

const lines = csv.split("\n").filter(Boolean);
const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

const groupIdIdx = headers.findIndex((h) => h.includes("group_id") || h.includes("id"));
const subjectIdx = headers.findIndex((h) => h === "subject");
const ownerIdx = headers.findIndex((h) => h.includes("owner") || h.includes("subjectowner"));

if (groupIdIdx === -1 || subjectIdx === -1 || ownerIdx === -1) {
  console.error("CSV headers not recognized. Expected columns: group_id/id, subject, subject_owner/subjectowner");
  console.error("Found headers:", headers);
  process.exit(1);
}

const rows = lines.slice(1).map((line) => {
  const cols = line.split(",").map((c) => c.trim());
  return {
    group_id: cols[groupIdIdx],
    subject: cols[subjectIdx],
    subject_owner: cols[ownerIdx],
  };
}).filter((r) => r.group_id && r.subject && r.subject_owner);

console.log(`Found ${rows.length} groups to migrate`);

const { data, error } = await supabase
  .from("grupos_autorizados")
  .upsert(rows, { onConflict: "group_id" });

if (error) {
  console.error("Migration failed:", error.message);
  process.exit(1);
}

console.log("Migration complete:", rows.length, "groups inserted/updated");
