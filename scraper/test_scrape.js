#!/usr/bin/env node
/**
 * test_scrape.js — feasibility test: can dazoge.info be scraped from a GitHub Actions runner?
 *
 * Scrapes ~PER_SUBCAT products from each subcategory (listing page + product page), logs every
 * request with status / timing / blocking signals, then checks a handful of product image URLs
 * from the same machine (with and without a foreign Referer) WITHOUT storing the images.
 *
 * Same politeness rules as dazoge_scrape.js:
 *   - robots.txt allows /c/ and /product/ for "User-agent: *"; /search and /api/ are Disallow
 *     and are never requested (enforced in politeFetch, not just by convention).
 *   - strictly sequential, one request per REQUEST_DELAY_MS (1100 ms), image checks included.
 *
 * Outputs (in OUT_DIR, default ./out):
 *   test_products.csv      one row per product (listing price, image URL, store count)
 *   test_store_prices.csv  one row per product per store (store price, regular_30d)
 *   test_requests.csv      one row per HTTP request (status, ms, bytes, block signals)
 *   test_images.csv        image checks: no-Referer vs Referer, status, type, size, magic bytes
 *   summary.json / summary.md
 *
 * Env: OUT_DIR, PER_SUBCAT (30), IMAGE_CHECKS (12), REFERER (https://vakosv.github.io/)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ───────────────────────────── config ─────────────────────────────
const BASE = "https://dazoge.info";
const REQUEST_DELAY_MS = 1100;
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30000;
const OUT_DIR = process.env.OUT_DIR || "out";
const PER_SUBCAT = Number(process.env.PER_SUBCAT || 30);
const IMAGE_CHECKS = Number(process.env.IMAGE_CHECKS || 12);
const REFERER = process.env.REFERER || "https://vakosv.github.io/";
const MAX_LISTING_PAGES = 3;

const SUBCATS = [
  { id: 100, slug: "ბავშვის-მოვლა", en: "baby care" },
  { id: 101, slug: "ტანსაცმლის-სარეცხი-საშუალებები", en: "laundry" },
  { id: 102, slug: "სახლის-მოვლა", en: "home care" },
  { id: 104, slug: "ჰიგიენა", en: "hygiene" },
  { id: 105, slug: "ბამბა-სხვა-ჰიგიენის-ნივთები", en: "cotton and other hygiene" },
  { id: 106, slug: "ქაღალდის-პროდუქცია", en: "paper products" },
  { id: 108, slug: "ერთჯერადი-ჭურჭელი", en: "disposable tableware" },
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const HTML_HEADERS = { "user-agent": UA, "accept": "text/html,application/xhtml+xml", "accept-language": "ka,en;q=0.9" };
const IMG_HEADERS = { "user-agent": UA, "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" };

// ───────────────────────────── helpers ─────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => String(s)
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENT[e])
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const stripTags = (h) => decode(String(h).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
function money(t) {
  const m = String(t).replace(/ /g, " ").match(/(\d[\d\s]*(?:[.,]\d+)?)\s*₾/);
  return m ? m[1].replace(/\s/g, "").replace(",", ".") : "";
}
const pct = (t) => ((String(t).match(/(\d+(?:[.,]\d+)?)\s*%/) || [])[1] || "").replace(",", ".");
const tetriToGel = (v) => (v == null || v === "" ? "" : (Number(v) / 100).toFixed(2));
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function writeCsv(file, cols, rows) {
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")).join("\r\n");
  fs.writeFileSync(path.join(OUT_DIR, file), "﻿" + cols.join(",") + "\r\n" + body + (rows.length ? "\r\n" : ""), "utf8");
}
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pctile = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const log = (s) => process.stdout.write(s + "\n");

// ───────────────────────────── blocking detection ─────────────────────────────
/**
 * Signals that the response is not the normal page. Note: every normal dazoge page embeds
 * Cloudflare's passive "/cdn-cgi/challenge-platform/scripts/jsd/main.js" beacon, so that string
 * alone is NOT a challenge; an interstitial is recognised by its title / cf_chl markers instead.
 */
function blockSignals(kind, res, body) {
  const s = [];
  if (!res) return ["no-response"];
  if (res.status === 403) s.push("http403");
  if (res.status === 429) s.push("http429");
  if (res.status === 503) s.push("http503");
  const mit = res.headers.get("cf-mitigated");
  if (mit) s.push("cf-mitigated:" + mit);
  if (body != null) {
    if (/<title>\s*(Just a moment|Attention Required|Access denied)/i.test(body) || /cf_chl_opt|cf-chl-|challenge-form/i.test(body)) s.push("cf-challenge");
    if (/captcha|turnstile/i.test(body)) s.push("captcha-word");
    if (body.length < 5000) s.push("short-body:" + body.length);
    if (kind === "listing" && res.ok && !body.includes('<a class="pcard"')) s.push("no-product-cards");
    if (kind === "product" && res.ok && !/property="og:image"|<a class="srow/.test(body)) s.push("unexpected-product-html");
    if (res.ok && !/\|\s*Dazoge\s*<\/title>|<title>[^<]*Dazoge/i.test(body)) s.push("unexpected-title");
  }
  return s;
}

// ───────────────────────────── fetching ─────────────────────────────
let lastRequestAt = 0;
const requests = [];

/** Sequential, rate-limited GET. Logs every attempt. Returns { res, body, buf } or null. */
async function politeFetch(url, kind, label, opts = {}) {
  const u = new URL(url);
  if (/^\/(search|api)(\/|$)/.test(u.pathname)) throw new Error("refusing robots-disallowed path " + u.pathname);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const wait = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const t0 = Date.now();
    const rec = { ts: new Date().toISOString(), kind, label, attempt, url, status: "", ms: "", bytes: "", content_type: "", redirected: "", cf_ray: "", cf_cache: "", signals: "", error: "" };
    requests.push(rec);
    let res = null, body = null, buf = null;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      res = await fetch(url, { headers: opts.headers || HTML_HEADERS, signal: ctl.signal });
      buf = Buffer.from(await res.arrayBuffer());
      clearTimeout(timer);
      rec.ms = Date.now() - t0;
      rec.status = res.status;
      rec.bytes = buf.length;
      rec.content_type = res.headers.get("content-type") || "";
      rec.redirected = res.redirected ? "yes" : "no";
      rec.cf_ray = res.headers.get("cf-ray") || "";
      rec.cf_cache = res.headers.get("cf-cache-status") || "";
      if (kind !== "image") body = buf.toString("utf8");
      rec.signals = blockSignals(kind, res, body).join(" ");
    } catch (e) {
      rec.ms = Date.now() - t0;
      rec.error = e.name === "AbortError" ? "timeout" : e.message;
    }
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) return res ? { res, body, buf } : null;
    await sleep(REQUEST_DELAY_MS * attempt * 3);
  }
  return null;
}

// ───────────────────────────── parsing (same rules as dazoge_scrape.js) ─────────────────────────────
function catalogueHtml(html) {
  const i = html.indexOf("<main");
  const main = i === -1 ? html : html.slice(i);
  const sections = main.split('<section class="block"').slice(1);
  if (!sections.length) return main;
  const withH2 = sections.map((s) => ({ html: s, h2: stripTags((s.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || "") }));
  let keep = withH2.filter((s) => /ყველა მაღაზიაში/.test(s.h2));
  if (!keep.length) keep = withH2.filter((s) => !/აქციები და ფასდაკლებები/.test(s.h2));
  if (!keep.length) keep = withH2;
  return keep.map((s) => s.html).join("\n");
}

function parseListing(html) {
  const out = [];
  for (const chunk of catalogueHtml(html).split('<a class="pcard"').slice(1)) {
    const end = chunk.indexOf("</a>");
    const card = end === -1 ? chunk : chunk.slice(0, end);
    const href = (card.match(/href="([^"]+)"/) || [])[1] || "";
    const bc = (href.match(/\/product\/([^/]+)/) || [])[1] || "";
    const name = stripTags((card.match(/<div class="pname"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "");
    if (!bc && !name) continue;
    out.push({
      barcode: decodeURIComponent(bc),
      product_name: name,
      volume: stripTags((card.match(/<div class="pvol"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ""),
      price_gel: money((card.match(/<span class="pprice[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || ""),
      old_price_gel: money((card.match(/<s class="pold"[^>]*>([\s\S]*?)<\/s>/) || [])[1] || ""),
      discount_pct: pct((card.match(/<span class="pbadge pbadge-sale"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || ""),
      listing_image_url: decode((card.match(/<img class="pimg"[^>]*src="([^"]+)"/) || [])[1] || ""),
      product_url: href ? BASE + href : "",
    });
  }
  return out;
}

const hasNextPage = (html, id) => new RegExp('<a class="pg"[^>]*href="\\/c\\/' + id + '\\/[^"]*[?&]page=\\d+"').test(html);

function parseHistory(html) {
  const raw = (html.match(/<script[^>]*id="ph-data"[^>]*>([\s\S]*?)<\/script>/) || [])[1];
  if (!raw) return null;
  let j; try { j = JSON.parse(raw); } catch (e) { return null; }
  return (j.series || []).map((s) => {
    const pts = (s.points || []).filter((p) => Array.isArray(p) && Number(p[1]) > 0);
    const freq = {};
    for (const p of pts.filter((p) => !Number(p[2]))) freq[p[1]] = (freq[p[1]] || 0) + 1;
    let regular = null, best = 0;
    for (const k of Object.keys(freq)) if (freq[k] > best) { best = freq[k]; regular = Number(k); }
    return { id: s.id || "", last: pts.length ? Number(pts[pts.length - 1][1]) : null, regular, promoDays: pts.filter((p) => Number(p[2]) > 0).length, days: pts.length };
  });
}

function parseStores(html) {
  const rows = [];
  for (const m of html.matchAll(/<a class="srow([^"]*)"[^>]*href="([^"]*)"([\s\S]*?)<\/a>/g)) {
    const inner = m[3];
    const cells = [...inner.matchAll(/<span class="scell([^"]*)"[^>]*>([\s\S]*?)<\/span>\s*(?=<span class="scell|$)/g)].map((c) => stripTags(c[2]));
    if (!cells.length) continue;
    rows.push({
      store_name: stripTags((inner.match(/<span class="sname"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || cells[0]),
      store_price_gel: cells[4] ? money(cells[4]) : "",
      store_old_price_gel: cells[3] ? money(cells[3]) : "",
      store_discount_pct: cells[2] ? pct(cells[2]) : "",
      is_best_price: /\bis-best\b/.test(m[1]) ? "yes" : "no",
    });
  }
  return rows;
}

const ogImage = (html) => decode((html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) || [])[1] || "");

/** Identify image bytes from their header, so a 200 HTML error page is not mistaken for an image. */
function magic(buf) {
  if (!buf || buf.length < 12) return "too-short";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  if (buf.slice(4, 12).toString().startsWith("ftypavif")) return "avif";
  if (buf.slice(0, 6).toString() === "GIF89a" || buf.slice(0, 6).toString() === "GIF87a") return "gif";
  if (/^\s*</.test(buf.slice(0, 64).toString())) return "html/xml";
  return "unknown";
}

// ───────────────────────────── main ─────────────────────────────
(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date();
  const runner = { github_run_id: process.env.GITHUB_RUN_ID || "", github_run_number: process.env.GITHUB_RUN_NUMBER || "", runner_os: process.env.RUNNER_OS || process.platform, node: process.version };
  log("dazoge test scrape — " + startedAt.toISOString() + " — " + JSON.stringify(runner));

  const products = [];
  const storeRows = [];
  const perSubcat = {};

  for (const sc of SUBCATS) {
    const picked = new Map();
    let pages = 0;
    for (let page = 1; page <= MAX_LISTING_PAGES && picked.size < PER_SUBCAT; page++) {
      const url = BASE + "/c/" + sc.id + "/" + encodeURI(sc.slug) + (page > 1 ? "?page=" + page : "");
      const r = await politeFetch(url, "listing", "c/" + sc.id + " p" + page);
      pages++;
      if (!r || !r.res.ok || !r.body) break;
      const items = parseListing(r.body);
      for (const it of items) if (it.barcode && !picked.has(it.barcode) && picked.size < PER_SUBCAT) picked.set(it.barcode, it);
      if (!items.length || !hasNextPage(r.body, sc.id)) break;
    }
    log("c/" + sc.id + " (" + sc.en + "): " + picked.size + " products picked from " + pages + " listing page(s)");

    let ok = 0;
    for (const p of picked.values()) {
      const r = await politeFetch(p.product_url, "product", "product " + p.barcode);
      const prow = Object.assign({ subcategory_id: sc.id, subcategory_en: sc.en }, p, { image_url: "", image_source: "", store_count: "", product_status: r ? r.res.status : "error" });
      if (r && r.res.ok && r.body) {
        ok++;
        const og = ogImage(r.body);
        prow.image_url = og || p.listing_image_url;
        prow.image_source = og ? "og:image" : p.listing_image_url ? "listing" : "";
        const stores = parseStores(r.body);
        const hist = parseHistory(r.body) || [];
        const used = new Set();
        prow.store_count = stores.length;
        for (const s of stores) {
          const tetri = s.store_price_gel ? Math.round(parseFloat(s.store_price_gel) * 100) : null;
          let idx = hist.findIndex((h, k) => !used.has(k) && h.last === tetri), how = "price";
          if (idx === -1) { idx = hist.findIndex((h, k) => !used.has(k)); how = idx === -1 ? "none" : "order"; }
          const h = idx === -1 ? null : hist[idx];
          if (idx !== -1) used.add(idx);
          storeRows.push(Object.assign({ barcode: p.barcode, product_name: p.product_name, subcategory_id: sc.id }, s, {
            store_regular_30d_gel: h ? tetriToGel(h.regular) : "",
            store_promo_days_30d: h ? h.promoDays : "",
            store_history_days: h ? h.days : "",
            history_match: how,
          }));
        }
      } else {
        prow.image_url = p.listing_image_url;
        prow.image_source = p.listing_image_url ? "listing" : "";
      }
      products.push(prow);
    }
    perSubcat[sc.id] = { en: sc.en, picked: picked.size, product_pages_ok: ok, listing_pages: pages };
  }

  // ───────────── image checks (B.1 + B.2 from this machine; bodies hashed, never written) ─────────────
  const imgRows = [];
  const withImg = products.filter((p) => p.image_url);
  const sample = [];
  const bySc = {};
  for (const p of withImg) (bySc[p.subcategory_id] = bySc[p.subcategory_id] || []).push(p);
  for (let i = 0; sample.length < Math.min(IMAGE_CHECKS, withImg.length); i++) {
    let added = false;
    for (const id of Object.keys(bySc)) if (bySc[id][i] && sample.length < IMAGE_CHECKS) { sample.push(bySc[id][i]); added = true; }
    if (!added) break;
  }
  for (const p of sample) {
    const row = { barcode: p.barcode, image_url: p.image_url };
    for (const [tag, headers] of [["noref", IMG_HEADERS], ["ref", Object.assign({ referer: REFERER }, IMG_HEADERS)]]) {
      const r = await politeFetch(p.image_url, "image", "image " + tag + " " + p.barcode, { headers });
      row[tag + "_status"] = r ? r.res.status : "error";
      row[tag + "_type"] = r ? r.res.headers.get("content-type") || "" : "";
      row[tag + "_bytes"] = r && r.buf ? r.buf.length : "";
      row[tag + "_magic"] = r && r.buf ? magic(r.buf) : "";
      row[tag + "_sha1"] = r && r.buf ? crypto.createHash("sha1").update(r.buf).digest("hex").slice(0, 12) : "";
      row[tag + "_cache"] = r ? r.res.headers.get("cf-cache-status") || "" : "";
      if (tag === "noref" && r) { row.cache_control = r.res.headers.get("cache-control") || ""; row.acao = r.res.headers.get("access-control-allow-origin") || ""; row.corp = r.res.headers.get("cross-origin-resource-policy") || ""; }
    }
    row.same_bytes = row.noref_sha1 && row.noref_sha1 === row.ref_sha1 ? "yes" : "no";
    imgRows.push(row);
  }

  // ───────────── outputs ─────────────
  writeCsv("test_products.csv", ["subcategory_id", "subcategory_en", "barcode", "product_name", "volume", "price_gel", "old_price_gel", "discount_pct", "store_count", "image_url", "image_source", "listing_image_url", "product_url", "product_status"], products);
  writeCsv("test_store_prices.csv", ["barcode", "product_name", "subcategory_id", "store_name", "store_price_gel", "store_old_price_gel", "store_discount_pct", "is_best_price", "store_regular_30d_gel", "store_promo_days_30d", "store_history_days", "history_match"], storeRows);
  writeCsv("test_requests.csv", ["ts", "kind", "label", "attempt", "status", "ms", "bytes", "content_type", "redirected", "cf_ray", "cf_cache", "signals", "error", "url"], requests);
  writeCsv("test_images.csv", ["barcode", "image_url", "noref_status", "noref_type", "noref_bytes", "noref_magic", "noref_sha1", "noref_cache", "ref_status", "ref_type", "ref_bytes", "ref_magic", "ref_sha1", "ref_cache", "same_bytes", "cache_control", "acao", "corp"], imgRows);

  const html = requests.filter((r) => r.kind !== "image");
  const okReq = html.filter((r) => r.status >= 200 && r.status < 300);
  const flagged = html.filter((r) => r.signals || r.error);
  const ms = okReq.map((r) => r.ms);
  const sigCount = {};
  for (const r of html) for (const s of (r.signals ? r.signals.split(" ") : []).concat(r.error ? ["error:" + r.error] : [])) sigCount[s] = (sigCount[s] || 0) + 1;
  const statusCount = {};
  for (const r of html) statusCount[r.status || "none"] = (statusCount[r.status || "none"] || 0) + 1;
  const imgOk = (tag) => imgRows.filter((r) => r[tag + "_status"] === 200 && ["jpeg", "png", "webp", "avif", "gif"].includes(r[tag + "_magic"])).length;
  const imgBytes = imgRows.map((r) => Number(r.noref_bytes)).filter((n) => n > 0);
  const hard = ["http403", "http429", "http503", "cf-challenge", "no-product-cards", "unexpected-product-html", "no-response"];
  const blocked = html.some((r) => r.error || hard.some((h) => (r.signals || "").split(" ").some((s) => s === h || s.startsWith("cf-mitigated"))));

  const summary = {
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    runtime_min: +((Date.now() - startedAt) / 60000).toFixed(1),
    runner,
    requests_total: html.length,
    requests_ok: okReq.length,
    requests_failed: html.length - okReq.length,
    requests_flagged: flagged.length,
    status_counts: statusCount,
    signal_counts: sigCount,
    blocked,
    response_ms: { avg: Math.round(avg(ms) || 0), median: median(ms), p95: pctile(ms, 0.95), max: ms.length ? Math.max(...ms) : null },
    products: products.length,
    product_pages_ok: products.filter((p) => p.product_status === 200).length,
    store_rows: storeRows.length,
    store_rows_with_regular_30d: storeRows.filter((s) => s.store_regular_30d_gel).length,
    image_urls_found: products.filter((p) => p.image_url).length,
    image_url_sources: products.reduce((a, p) => ((a[p.image_source || "none"] = (a[p.image_source || "none"] || 0) + 1), a), {}),
    image_hosts: products.reduce((a, p) => { if (p.image_url) { const h = new URL(p.image_url).host; a[h] = (a[h] || 0) + 1; } return a; }, {}),
    image_checks: imgRows.length,
    image_ok_no_referer: imgOk("noref"),
    image_ok_with_referer: imgOk("ref"),
    image_same_bytes_both: imgRows.filter((r) => r.same_bytes === "yes").length,
    image_kb: { median: imgBytes.length ? Math.round(median(imgBytes) / 1024) : null, min: imgBytes.length ? Math.round(Math.min(...imgBytes) / 1024) : null, max: imgBytes.length ? Math.round(Math.max(...imgBytes) / 1024) : null },
    referer_tested: REFERER,
    per_subcategory: perSubcat,
  };
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  let md = "## dazoge test scrape — run " + (runner.github_run_number || "local") + "\n\n";
  md += "| metric | value |\n|---|---|\n";
  md += "| started (UTC) | " + summary.started_at + " |\n| runtime | " + summary.runtime_min + " min |\n";
  md += "| requests OK / failed | " + summary.requests_ok + " / " + summary.requests_failed + " (of " + summary.requests_total + ") |\n";
  md += "| response ms avg / median / p95 / max | " + [summary.response_ms.avg, summary.response_ms.median, summary.response_ms.p95, summary.response_ms.max].join(" / ") + " |\n";
  md += "| **blocked** | **" + (blocked ? "YES" : "no") + "** |\n";
  md += "| status codes | " + JSON.stringify(statusCount) + " |\n";
  md += "| signals | " + (Object.keys(sigCount).length ? JSON.stringify(sigCount) : "none") + " |\n";
  md += "| products / product pages OK | " + summary.products + " / " + summary.product_pages_ok + " |\n";
  md += "| store rows / with regular_30d | " + summary.store_rows + " / " + summary.store_rows_with_regular_30d + " |\n";
  md += "| image URLs found | " + summary.image_urls_found + " " + JSON.stringify(summary.image_url_sources) + " hosts " + JSON.stringify(summary.image_hosts) + " |\n";
  md += "| image checks OK no-Referer / with Referer / identical | " + summary.image_ok_no_referer + " / " + summary.image_ok_with_referer + " / " + summary.image_same_bytes_both + " (of " + summary.image_checks + ") |\n";
  md += "| image size KB median (min–max) | " + summary.image_kb.median + " (" + summary.image_kb.min + "–" + summary.image_kb.max + ") |\n\n";
  md += "| subcat | picked | product pages OK |\n|---|---|---|\n";
  for (const id of Object.keys(perSubcat)) md += "| c/" + id + " " + perSubcat[id].en + " | " + perSubcat[id].picked + " | " + perSubcat[id].product_pages_ok + " |\n";
  if (flagged.length) {
    md += "\n### Flagged requests (first 20)\n\n| ts | label | status | ms | signals |\n|---|---|---|---|---|\n";
    for (const r of flagged.slice(0, 20)) md += "| " + r.ts + " | " + r.label + " | " + r.status + " | " + r.ms + " | " + (r.signals || r.error) + " |\n";
  }
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), md, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md, "utf8");

  log("\n" + md);
  // One-line machine-readable result: shows up as a public annotation on the run page.
  const line = "ok=" + summary.requests_ok + " failed=" + summary.requests_failed + " flagged=" + summary.requests_flagged + " avg_ms=" + summary.response_ms.avg +
    " p95_ms=" + summary.response_ms.p95 + " blocked=" + (blocked ? "yes" : "no") + " images_found=" + summary.image_urls_found +
    " img_ok_noref=" + summary.image_ok_no_referer + "/" + summary.image_checks + " img_ok_ref=" + summary.image_ok_with_referer + "/" + summary.image_checks +
    " img_identical=" + summary.image_same_bytes_both + " img_kb_median=" + summary.image_kb.median + " store_rows=" + summary.store_rows + " regular30=" + summary.store_rows_with_regular_30d;
  if (process.env.GITHUB_ACTIONS) log("::notice title=dazoge test result::" + line);
  else log("RESULT " + line);
})().catch((e) => { console.error(e); process.exit(1); });
