// Concatenates supabase/migrations/*.sql (in order) into supabase/setup.sql,
// for pasting into the Supabase SQL Editor on a new, empty project.
//   npm run db:bundle
import fs from "node:fs";
import path from "node:path";

const dir = path.join("supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const parts = files.map((f) => `-- =============================================================================\n-- ${f}\n-- =============================================================================\n\n${fs.readFileSync(path.join(dir, f), "utf8")}`);
const out = path.join("supabase", "setup.sql");
fs.writeFileSync(out, `-- SaloneLedger database setup: ${files.length} migrations, generated ${new Date().toISOString()}.\n-- Run once on an EMPTY project (SQL Editor -> New query -> paste -> Run).\n\n${parts.join("\n\n")}`);
console.log(`Wrote ${out} (${files.length} migrations, ${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
