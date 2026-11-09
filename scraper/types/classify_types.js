#!/usr/bin/env node
/**
 * classify_types.js — assign one product type (plus sub-detail) to every product.
 *
 *   node scraper/types/classify_types.js <dazoge_market_prices.csv> [out_dir]
 *
 * Rules live in product_types.js (edit that file, not this one); matching is in classifier.js.
 * Outputs (out_dir, default scraper/types/out — git-ignored):
 *   product_types.csv  barcode, name, subcategory, type, type_label, detail, ply, count, rule
 *   report.md          count per type, % other (with and without the extra types),
 *                      30 most common words in "other", 10 random examples per type
 */
const fs = require("fs");
const path = require("path");

// ───────────── csv ─────────────
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map((h) => h.replace(/^﻿/, ""));
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const { TYPES, classify, detailOf, labelOf, extraIds } = require("./classifier.js");

// ───────────── report helpers ─────────────
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function sample(arr, n, seed) {
  const rnd = mulberry32(seed), a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
const pctStr = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "-");

// ───────────── main ─────────────
const inFile = process.argv[2];
const outDir = process.argv[3] || path.join(__dirname, "out");
if (!inFile) { console.error("usage: node classify_types.js <dazoge_market_prices.csv> [out_dir]"); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const rows = parseCsv(fs.readFileSync(inFile, "utf8"));
// One row per barcode (the CSV has one row per product per subcategory listing).
const seen = new Set();
const products = rows.filter((r) => (r.barcode && !seen.has(r.barcode) ? seen.add(r.barcode) : false));

const out = products.map((p) => {
  const c = classify(p);
  const d = detailOf(c.type, p);
  return { barcode: p.barcode, product_name: p.product_name, volume: p.volume, subcategory_id: p.subcategory_id, type: c.type, type_label: labelOf[c.type], detail: d.detail, ply: d.ply, count: d.count, rule: c.rule };
});

const cols = ["barcode", "product_name", "volume", "subcategory_id", "type", "type_label", "detail", "ply", "count", "rule"];
fs.writeFileSync(path.join(outDir, "product_types.csv"), "﻿" + cols.join(",") + "\r\n" + out.map((r) => cols.map((c) => csvCell(r[c])).join(",")).join("\r\n") + "\r\n", "utf8");

const total = out.length;
const by = {};
for (const r of out) (by[r.type] = by[r.type] || []).push(r);
const nOther = (by.other || []).length;
const nExtra = out.filter((r) => extraIds.has(r.type)).length;

const words = {};
for (const r of by.other || []) for (const w of new Set(r.product_name.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 2))) words[w] = (words[w] || 0) + 1;

let md = "# Product type report\n\n";
md += "source: `" + path.basename(inFile) + "` — " + rows.length + " rows, " + total + " unique products (by barcode)\n\n";
md += "| measure | count | share |\n|---|---|---|\n";
md += "| other (with extra types) | " + nOther + " | " + pctStr(nOther, total) + " |\n";
md += "| other if extra types are dropped (requested list only) | " + (nOther + nExtra) + " | " + pctStr(nOther + nExtra, total) + " |\n\n";
md += "## Count per type\n\n| type | extra? | count | share | by subcategory |\n|---|---|---|---|---|\n";
for (const t of TYPES) {
  const list = by[t.id] || [];
  const subs = {};
  for (const r of list) subs["c/" + r.subcategory_id] = (subs["c/" + r.subcategory_id] || 0) + 1;
  md += "| " + t.label + " | " + (t.extra ? "extra" : "") + " | " + list.length + " | " + pctStr(list.length, total) + " | " + Object.entries(subs).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ":" + v).join(" ") + " |\n";
}
md += "\n## 30 most common words in \"other\"\n\n" + Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([w, c]) => w + " (" + c + ")").join(", ") + "\n";
md += "\n## 10 random examples per type (seeded, repeatable)\n";
TYPES.forEach((t, i) => {
  const list = by[t.id] || [];
  if (!list.length) return;
  md += "\n### " + t.label + " (" + list.length + ")\n\n";
  for (const r of sample(list, 10, 1000 + i)) md += "- c/" + r.subcategory_id + " — " + r.product_name + (r.detail ? "  → `" + r.detail + "`" : "") + (r.rule !== "" ? "  _(r" + r.rule + ")_" : "") + "\n";
});
fs.writeFileSync(path.join(outDir, "report.md"), md, "utf8");

console.log("products: " + total + "  other: " + nOther + " (" + pctStr(nOther, total) + ")  other-if-no-extras: " + (nOther + nExtra) + " (" + pctStr(nOther + nExtra, total) + ")");
console.log("wrote " + path.join(outDir, "product_types.csv") + " and report.md");
