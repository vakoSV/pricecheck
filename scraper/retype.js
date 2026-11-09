#!/usr/bin/env node
/**
 * retype.js — re-applies the product-type rules (scraper/types/product_types.js) and the manual
 * corrections (scraper/types/overrides.csv) to the published data. NO scraping, no network.
 *
 *   node scraper/retype.js           show which products would change type (writes nothing to data/)
 *   node scraper/retype.js --write   also rewrite data/products.json and the type counts in data/meta.json
 *
 * Only type, type_label and detail change. Prices, stores, history and changes stay as published.
 * The change list is also saved to work/retype_changes.csv.
 */
const fs = require("fs");
const path = require("path");
const { classify, detailOf, labelOf, loadOverrides } = require("./types/classifier.js");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const WORK = path.join(ROOT, "work");
const WRITE = process.argv.includes("--write");

/**
 * The classifier reads the dazoge "volume" column, which products.json keeps only as size/unit
 * (size_source "volume"). Rebuild an equivalent volume string so the rules see the same unit.
 */
function volumeOf(p) {
  if (p.size_source !== "volume" || !p.size || !p.unit) return "";
  if (p.unit === "l") return Math.round(p.size * 1000 * 1000) / 1000 + " მლ";
  if (p.unit === "kg") return p.size + " კგ";
  return p.size + " ც";
}

const products = JSON.parse(fs.readFileSync(path.join(DATA, "products.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(DATA, "meta.json"), "utf8"));
const ov = loadOverrides();
for (const w of ov.warnings) console.log("overrides.csv: " + w);

const changes = [];
for (const p of products.products) {
  const input = { barcode: p.barcode, product_name: p.name, subcategory_id: p.subcategory, volume: volumeOf(p) };
  const type = classify(input).type;
  const detail = detailOf(type, input).detail || null;
  if (type !== p.type) changes.push({ barcode: p.barcode, name: p.name, old: p.type, new: type, override: ov.map.has(p.barcode) });
  if (WRITE) Object.assign(p, { type, type_label: labelOf[type], detail });
}

// Report: grouped by old → new, with counts.
const groups = new Map();
for (const c of changes) {
  const k = c.old + " → " + c.new;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(c);
}
console.log(changes.length + " of " + products.products.length + " products change type" + (WRITE ? "" : " (preview, nothing written)"));
for (const [k, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  console.log("\n" + k + "  (" + list.length + ")");
  for (const c of list) console.log("  " + c.barcode + "  " + c.name + (c.override ? "  [override]" : ""));
}
fs.mkdirSync(WORK, { recursive: true });
const csvq = (s) => '"' + String(s).replace(/"/g, '""') + '"';
fs.writeFileSync(path.join(WORK, "retype_changes.csv"), "﻿barcode,name,old_type,new_type,override\n" +
  changes.map((c) => [c.barcode, csvq(c.name), c.old, c.new, c.override ? "yes" : ""].join(",")).join("\n") + "\n", "utf8");

if (WRITE) {
  // Same layout as scraper/update.js renderFiles(): one product per line.
  fs.writeFileSync(path.join(DATA, "products.json"), '{"run_id":' + JSON.stringify(products.run_id) + ',"generated_at":' + JSON.stringify(products.generated_at) +
    ',"count":' + products.products.length + ',"products":[\n' + products.products.map((p) => JSON.stringify(p)).join(",\n") + "\n]}\n", "utf8");
  const active = products.products.filter((p) => p.status === "active");
  const types = {};
  for (const p of active) types[p.type] = (types[p.type] || 0) + 1;
  meta.types = types;
  meta.other_pct = Math.round((1000 * (types.other || 0)) / (active.length || 1)) / 10;
  meta.retyped_at = new Date().toISOString();
  fs.writeFileSync(path.join(DATA, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
  console.log("\nWrote data/products.json and data/meta.json (other " + meta.other_pct + "%).");
}
