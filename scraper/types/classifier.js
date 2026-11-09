/**
 * classifier.js — applies the rules in product_types.js to one product.
 * Used by classify_types.js (report) and by the data build (scraper/build.js).
 *
 *   classify({ product_name, subcategory_id, volume }) -> { type, rule }
 *   detailOf(type, product) -> { detail, ply, count }
 *   sizeOf(product) -> { unit: "liquid"|"mass"|"count"|"", ml }
 */
const { TYPES, RULES, DETAILS, DETAIL_GROUPS, PAPER_TYPES } = require("./product_types.js");

const re = (p) => new RegExp(p, "iu");
const compiled = RULES.map((r, i) => ({
  ...r, idx: i,
  anyR: r.any ? r.any.map(re) : null,
  allR: r.all ? r.all.map((g) => g.map(re)) : null,
  notR: r.not ? r.not.map(re) : null,
}));
const labelOf = Object.fromEntries(TYPES.map((t) => [t.id, t.label]));
const extraIds = new Set(TYPES.filter((t) => t.extra).map((t) => t.id));
for (const r of compiled) if (!labelOf[r.type]) throw new Error("rule " + r.idx + " uses unknown type " + r.type);

/**
 * Size from the volume column ("0.75 ლ", "0.1 კგ", "12 ც"); if that has no unit, from a size
 * written in the name ("750 მლ", "1.5 კგ"). ml is only set for liquids. No unit found → unit "".
 */
const NAME_SIZE = /(\d+(?:[.,]\d+)?)\s*(მლ|ml|ლ|l|კგ|kg|გრ?|gr?)(?![ა-ჰa-z])/i;
function sizeOf(p) {
  const v = String(p.volume || "");
  let m = v.match(/^\s*(\d+(?:[.,]\d+)?)\s*(მლ|ლ|კგ|გრ?|ც)\s*$/);
  if (!m) m = String(p.product_name || "").match(NAME_SIZE);
  if (!m) return { unit: "", ml: null };
  const n = Number(m[1].replace(",", "."));
  const u = m[2].toLowerCase();
  if (u === "მლ" || u === "ml") return { unit: "liquid", ml: n };
  if (u === "ლ" || u === "l") return { unit: "liquid", ml: n * 1000 };
  if (u === "ც") return { unit: "count", ml: null };
  return { unit: "mass", ml: null };
}

/**
 * Manual corrections: overrides.csv (barcode,type,note). They always win over the rules.
 * Bad lines (unknown type, no barcode) are skipped and reported in `warnings`.
 */
const OVERRIDES_FILE = require("path").join(__dirname, "overrides.csv");
let overrides = null;
function loadOverrides() {
  const map = new Map(), warnings = [];
  let text = "";
  try { text = require("fs").readFileSync(OVERRIDES_FILE, "utf8").replace(/^﻿/, ""); } catch { /* no file = no overrides */ }
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const [barcode, type] = t.split(",").map((s) => (s || "").trim().replace(/^"|"$/g, ""));
    if (barcode.toLowerCase() === "barcode") return; // header
    if (!barcode || !type) { warnings.push("line " + (i + 1) + ": needs barcode and type: " + t); return; }
    if (!labelOf[type]) { warnings.push("line " + (i + 1) + ": unknown type '" + type + "' (see product_types.js): " + t); return; }
    map.set(barcode, type);
  });
  overrides = { map, warnings };
  return overrides;
}

function classify(p) {
  if (!overrides) {
    loadOverrides();
    for (const w of overrides.warnings) console.warn("overrides.csv " + w);
  }
  if (p.barcode && overrides.map.has(String(p.barcode))) return { type: overrides.map.get(String(p.barcode)), rule: "override" };
  const name = String(p.product_name || "").toLowerCase().replace(/\s+/g, " ");
  const sub = Number(p.subcategory_id);
  const { unit, ml } = sizeOf(p);
  for (const r of compiled) {
    if (r.sub && !r.sub.includes(sub)) continue;
    if (r.unit && !r.unit.includes(unit)) continue;
    if (r.ml && !(ml != null && ml >= r.ml[0] && ml <= r.ml[1])) continue;
    if (r.anyR && !r.anyR.some((x) => x.test(name))) continue;
    if (r.allR && !r.allR.every((g) => g.some((x) => x.test(name)))) continue;
    if (r.notR && r.notR.some((x) => x.test(name))) continue;
    return { type: r.type, rule: r.idx };
  }
  return { type: "other", rule: "" };
}

const PLY_WORDS = { "ერთ": 1, "ორ": 2, "სამ": 3, "ოთხ": 4, "ხუთ": 5 };
function paperDetail(p) {
  const name = String(p.product_name || "").toLowerCase();
  let ply = "";
  const m1 = name.match(/(\d)\s*-?\s*(?:ფენ|ფ(?![ა-ჰ]))/);
  const m2 = name.match(/(ერთ|ორ|სამ|ოთხ|ხუთ)\s*-?\s*ფენ/);
  if (m1) ply = m1[1]; else if (m2) ply = String(PLY_WORDS[m2[1]]);
  let count = "";
  const v = String(p.volume || "").match(/^(\d+)\s*ც$/);
  const n = name.match(/(\d+)\s*(?:ც(?![ა-ჰ])|ცალ|რულონ|როლ)/);
  if (v) count = v[1]; else if (n) count = n[1];
  return { ply, count };
}

function detailOf(type, p) {
  const name = String(p.product_name || "").toLowerCase();
  const group = DETAIL_GROUPS[type];
  const labels = group ? DETAILS[group].filter(([, pat]) => re(pat).test(name)).map(([l]) => l) : [];
  let ply = "", count = "";
  if (PAPER_TYPES.includes(type)) {
    ({ ply, count } = paperDetail(p));
    if (ply) labels.push(ply + "-ply");
    if (count) labels.push(count + (type === "toilet_paper" || type === "paper_towels" ? " rolls" : " pcs"));
  }
  return { detail: labels.join("+"), ply, count };
}

module.exports = { TYPES, classify, detailOf, sizeOf, labelOf, extraIds, loadOverrides };
