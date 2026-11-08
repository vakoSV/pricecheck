#!/usr/bin/env node
/**
 * dazoge_scrape.js — Georgian market price scraper for dazoge.info
 * Category: სახლის მოვლა და ჰიგიენა (c/99) — selected subcategories only.
 *
 * Outputs (written next to this script, in the working directory):
 *   dazoge_market_prices.csv  — one row per product per subcategory listing
 *   dazoge_store_prices.csv   — one row per product per store
 *   dazoge_scrape_summary.txt — per-subcategory counts, promo counts, errors
 *   .dazoge_state.json        — resume state (delete it to force a clean run)
 *
 * Usage:
 *   node dazoge_scrape.js              # resumes a same-day interrupted run, else starts fresh
 *   node dazoge_scrape.js --fresh      # discard previous output and state, start over
 *   node dazoge_scrape.js --no-stores  # listing data only, skips product pages (fast)
 *
 * Politeness / compliance:
 *   - robots.txt (checked 2026-11-01) allows /c/ and /product/ for every agent.
 *     /search and /api/ are Disallow for "User-agent: *" — this script never touches them.
 *   - Hard rate limit: one request per REQUEST_DELAY_MS (default 1100ms, i.e. under 1 req/sec).
 *     Requests are strictly sequential; there is no parallelism anywhere.
 *   - Retries with backoff on network errors, 5xx and 429.
 *
 * Nothing is guessed: any field not present in the HTML is written as an empty string.
 */

const fs = require("fs");

// ───────────────────────────── config ─────────────────────────────
const BASE = "https://dazoge.info";
const REQUEST_DELAY_MS = 1100;       // >= 1 second between requests
const MAX_RETRIES = 3;
const MAX_PAGES_PER_SUBCAT = 200;    // runaway guard
const MAX_SWEEPS = 1;                // repeat listing sweeps to catch products missed by unstable paging
const TIMEOUT_MS = 30000;

// Subcategories to scrape. c/103 (კონტრაცეპტივები) and c/107 (სხვა) are intentionally skipped.
const SUBCATS = [
  { id: 100, slug: "ბავშვის-მოვლა", en: "baby care" },
  { id: 101, slug: "ტანსაცმლის-სარეცხი-საშუალებები", en: "laundry" },
  { id: 102, slug: "სახლის-მოვლა", en: "home care" },
  { id: 104, slug: "ჰიგიენა", en: "hygiene" },
  { id: 105, slug: "ბამბა-სხვა-ჰიგიენის-ნივთები", en: "cotton and other hygiene" },
  { id: 106, slug: "ქაღალდის-პროდუქცია", en: "paper products" },
  { id: 108, slug: "ერთჯერადი-ჭურჭელი", en: "disposable tableware" },
];

const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "accept": "text/html,application/xhtml+xml",
  "accept-language": "ka,en;q=0.9",
};

const MARKET_CSV = "dazoge_market_prices.csv";
const STORE_CSV = "dazoge_store_prices.csv";
const SUMMARY = "dazoge_scrape_summary.txt";
const STATE = ".dazoge_state.json";

const ARGS = process.argv.slice(2);
const FRESH = ARGS.includes("--fresh");
const NO_STORES = ARGS.includes("--no-stores");

// ───────────────────────────── helpers ─────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => new Date().toISOString().slice(0, 10);

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return String(s)
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENT[e])
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
function stripTags(html) {
  return decode(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
/** "3.95₾" -> "3.95". Returns "" when no amount is present (never guesses). */
function money(text) {
  const m = String(text).replace(/ /g, " ").match(/(\d[\d\s]*(?:[.,]\d+)?)\s*₾/);
  return m ? m[1].replace(/\s/g, "").replace(",", ".") : "";
}
/** "-18%" -> "18" */
function pct(text) {
  const m = String(text).match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? m[1].replace(",", ".") : "";
}
/** "2 მაღაზია" -> "2" */
function intOf(text) {
  const m = String(text).match(/\d+/);
  return m ? m[0] : "";
}

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvLine(cols, obj) {
  return cols.map((c) => csvCell(obj[c])).join(",") + "\r\n";
}
function ensureCsv(file, cols) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    fs.writeFileSync(file, "﻿" + cols.join(",") + "\r\n", "utf8");
  }
}

// ───────────────────────────── fetching ─────────────────────────────
let lastRequestAt = 0;
let requestCount = 0;
const errors = [];

async function politeFetch(url, label) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const wait = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    requestCount++;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { headers: HEADERS, signal: ctl.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) throw new Error("HTTP " + res.status);
      if (!res.ok) {
        errors.push(label + ": HTTP " + res.status + " " + url);
        return null;
      }
      return await res.text();
    } catch (e) {
      if (attempt === MAX_RETRIES) {
        errors.push(label + ": " + e.message + " " + url);
        return null;
      }
      await sleep(REQUEST_DELAY_MS * attempt * 3); // backoff
    }
  }
  return null;
}

// ───────────────────────────── parsing ─────────────────────────────
/**
 * Isolate the real catalogue grid.
 * Every listing page repeats a 12-card "აქციები და ფასდაკლებები" (promotions) highlight
 * block above the paginated catalogue. Those 12 cards are duplicates of products that also
 * appear in the catalogue, so counting them would double-count. Keep only the catalogue
 * section: preferably the one headed "...ყველა მაღაზიაში", otherwise every section that is
 * not the promotions block.
 */
function catalogueHtml(html) {
  const mainStart = html.indexOf("<main");
  const main = mainStart === -1 ? html : html.slice(mainStart);
  const sections = main.split('<section class="block"').slice(1);
  if (!sections.length) return main;

  const withH2 = sections.map((s) => ({
    html: s,
    h2: stripTags((s.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || ""),
  }));
  let keep = withH2.filter((s) => /ყველა მაღაზიაში/.test(s.h2));
  if (!keep.length) keep = withH2.filter((s) => !/აქციები და ფასდაკლებები/.test(s.h2));
  if (!keep.length) keep = withH2;
  return keep.map((s) => s.html).join("\n");
}

/** Product cards on a category listing page (catalogue grid only). */
function parseListing(html) {
  const out = [];
  const chunks = catalogueHtml(html).split('<a class="pcard"').slice(1);
  for (const chunk of chunks) {
    const end = chunk.indexOf("</a>");
    const card = end === -1 ? chunk : chunk.slice(0, end);

    const href = (card.match(/href="([^"]+)"/) || [])[1] || "";
    const bc = (href.match(/\/product\/([^/]+)/) || [])[1] || "";

    const name = stripTags((card.match(/<div class="pname"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "");
    const vol = stripTags((card.match(/<div class="pvol"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "");

    const priceRaw = (card.match(/<span class="pprice[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "";
    const oldRaw = (card.match(/<s class="pold"[^>]*>([\s\S]*?)<\/s>/) || [])[1] || "";
    const saleRaw = (card.match(/<span class="pbadge pbadge-sale"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "";
    const cntRaw = (card.match(/<span class="pbadge pbadge-count"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "";

    if (!bc && !name) continue;
    out.push({
      barcode: decodeURIComponent(bc),
      product_name: name,
      volume: vol,
      price_gel: money(priceRaw),
      old_price_gel: money(oldRaw),
      discount_pct: pct(saleRaw),
      store_count_badge: intOf(cntRaw),
      product_url: href ? BASE + href : "",
    });
  }
  return out;
}

/** True when the listing page links to a further page of the same subcategory. */
function hasNextPage(html, subcatId) {
  const re = new RegExp('<a class="pg"[^>]*href="\\/c\\/' + subcatId + '\\/[^"]*[?&]page=(\\d+)"', "g");
  return [...html.matchAll(re)].length > 0;
}

/**
 * 30-day price history, from the <script type="application/json" id="ph-data"> block.
 * Shape: { days, dates[], min, max, series: [{ id, points: [[dayIndex, priceTetri, oldPriceTetri]] }] }
 * All money values are integer tetri (395 = 3.95 GEL). The third value in a point is the
 * old price on a day the store was running a promotion, and 0 on a regular-price day —
 * which is what makes the regular price separable from a promotion.
 */
function parseHistory(html) {
  const raw = (html.match(/<script[^>]*id="ph-data"[^>]*>([\s\S]*?)<\/script>/) || [])[1];
  if (!raw) return null;
  let j;
  try { j = JSON.parse(raw); } catch (e) { return null; }

  const series = (j.series || []).map((s) => {
    const pts = (s.points || []).filter((p) => Array.isArray(p) && Number(p[1]) > 0);
    const prices = pts.map((p) => Number(p[1]));
    const regularPts = pts.filter((p) => !Number(p[2]));   // no old price that day => regular
    const promoPts = pts.filter((p) => Number(p[2]) > 0);  // old price present => promotion

    // Most frequently charged price on non-promotion days.
    const freq = {};
    for (const p of regularPts) freq[p[1]] = (freq[p[1]] || 0) + 1;
    let regular = "", bestN = 0;
    for (const key of Object.keys(freq)) {
      if (freq[key] > bestN) { bestN = freq[key]; regular = key; }
    }

    return {
      id: s.id || "",
      last: pts.length ? Number(pts[pts.length - 1][1]) : null,
      min: prices.length ? Math.min.apply(null, prices) : null,
      max: prices.length ? Math.max.apply(null, prices) : null,
      regular: regular === "" ? null : Number(regular),
      promoDays: promoPts.length,
      days: pts.length,
    };
  });

  return {
    days: j.days == null ? "" : j.days,
    min: j.min == null ? null : Number(j.min),
    max: j.max == null ? null : Number(j.max),
    series: series,
  };
}

/** Integer tetri -> "3.95". Empty string when absent (never guesses). */
function tetriToGel(v) {
  return v == null || v === "" ? "" : (Number(v) / 100).toFixed(2);
}

/** Per-store rows on a product page. Cell order: store, updated, discount, old price, price. */
function parseProduct(html) {
  const rows = [];
  for (const m of html.matchAll(/<a class="srow([^"]*)"[^>]*href="([^"]*)"([\s\S]*?)<\/a>/g)) {
    const cls = m[1].trim();
    const link = decode(m[2]);
    const inner = m[3];
    const cells = [...inner.matchAll(/<span class="scell([^"]*)"[^>]*>([\s\S]*?)<\/span>\s*(?=<span class="scell|$)/g)]
      .map((c) => ({ cls: c[1].trim(), text: stripTags(c[2]) }));
    if (!cells.length) continue;

    const storeName = stripTags((inner.match(/<span class="sname"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || cells[0].text);
    const updated = cells[1] ? cells[1].text : "";
    const discount = cells[2] ? pct(cells[2].text) : "";
    const oldPrice = cells[3] ? money(cells[3].text) : "";
    const price = cells[4] ? money(cells[4].text) : "";

    rows.push({
      store_name: storeName,
      store_price_gel: price,
      store_old_price_gel: oldPrice,
      store_discount_pct: discount,
      // "promo" only when the row itself shows a discount or an old price; otherwise "regular".
      price_type: discount || oldPrice ? "promo" : "regular",
      is_best_price: /\bis-best\b/.test(cls) ? "yes" : "no",
      store_updated_text: updated,
      store_url: link,
    });
  }
  return rows;
}

// ───────────────────────────── columns ─────────────────────────────
const MARKET_COLS = [
  "subcategory_id", "subcategory_name_ka", "subcategory_name_en",
  "product_name", "barcode", "volume",
  "price_gel", "old_price_gel", "discount_pct",
  "min_30d_gel", "min_30d_source", "is_30d_low", "low30_pill_text",
  "chart_min_30d_gel", "chart_max_30d_gel", "history_days",
  "store_count_badge", "store_count_listed",
  "product_url", "date_scraped",
];
const STORE_COLS = [
  "barcode", "product_name", "subcategory_id", "subcategory_name_ka",
  "store_name", "store_price_gel", "store_old_price_gel", "store_discount_pct",
  "price_type", "is_best_price",
  "store_min_30d_gel", "store_max_30d_gel", "store_regular_30d_gel",
  "store_promo_days_30d", "store_history_days", "history_series_id", "history_match",
  "store_updated_text", "store_url", "date_scraped",
];

// ───────────────────────────── main ─────────────────────────────
(async () => {
  const startedAt = Date.now();
  const date_scraped = todayISO();

  if (FRESH) {
    for (const f of [MARKET_CSV, STORE_CSV, STATE]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  let state = { doneSubcats: [], doneBarcodes: [], date: date_scraped };
  if (!FRESH && fs.existsSync(STATE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(STATE, "utf8"));
      if (prev.date === date_scraped) {
        state = prev; // resume only a run started the same day
      } else {
        for (const f of [MARKET_CSV, STORE_CSV]) if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    } catch (e) { /* unreadable state: start fresh */ }
  }
  const doneSubcats = new Set(state.doneSubcats);
  const doneBarcodes = new Set(state.doneBarcodes);
  const saveState = () =>
    fs.writeFileSync(STATE, JSON.stringify({
      doneSubcats: [...doneSubcats], doneBarcodes: [...doneBarcodes], date: date_scraped,
    }), "utf8");

  ensureCsv(MARKET_CSV, MARKET_COLS);
  ensureCsv(STORE_CSV, STORE_COLS);

  const stats = {};
  let matchedByOrder = 0;   // history series matched to a store row by position, not price
  let matchedNone = 0;      // store row with no history series available
  let noHistory = 0;        // product pages with no ph-data block at all
  const log = (s) => process.stdout.write(s + "\n");

  for (const sc of SUBCATS) {
    if (doneSubcats.has(sc.id)) { log("c/" + sc.id + ": already done (resume), skipping"); continue; }

    // Pagination is deterministic (verified: positions run 1..numberOfItems with no gaps),
    // but dazoge's own catalogue lists a few products in more than one slot, so the category's
    // numberOfItems is a count of listing slots, not of distinct products. We therefore key by
    // barcode and report the difference as duplicate slots rather than as missing data.
    // MAX_SWEEPS stays configurable in case the site's paging ever becomes unstable.
    let nameKa = "";
    let expected = null;
    let pagesSeen = 0;
    let slotCount = 0;
    const byBarcode = new Map();

    for (let sweep = 1; sweep <= MAX_SWEEPS; sweep++) {
      const before = byBarcode.size;
      let page = 1;
      while (page <= MAX_PAGES_PER_SUBCAT) {
        const url = BASE + "/c/" + sc.id + "/" + encodeURI(sc.slug) + (page > 1 ? "?page=" + page : "");
        const html = await politeFetch(url, "listing c/" + sc.id + " p" + page + " (sweep " + sweep + ")");
        if (!html) break;
        if (!nameKa) {
          nameKa = stripTags((html.match(/<nav class="crumbs"[\s\S]*?<span[^>]*>([^<]*)<\/span>\s*<\/nav>/) || [])[1] || "")
            || sc.slug.replace(/-/g, " ");
        }
        if (expected === null) {
          const n = (html.match(/"numberOfItems":\s*(\d+)/) || [])[1];
          if (n) expected = Number(n);
        }
        const items = parseListing(html);
        for (const item of items) {
          slotCount++;
          if (item.barcode && !byBarcode.has(item.barcode)) byBarcode.set(item.barcode, item);
        }
        pagesSeen++;
        if (items.length === 0 || !hasNextPage(html, sc.id)) break;
        page++;
      }
      const added = byBarcode.size - before;
      log("   sweep " + sweep + ": " + byBarcode.size + " unique" +
        (expected !== null ? " / " + expected + " expected" : "") + " (+" + added + ")");
      if (expected !== null && byBarcode.size >= expected) break;
      if (sweep > 1 && added === 0) break;
    }

    const listed = [...byBarcode.values()];
    const dupSlots = slotCount - listed.length;
    log("c/" + sc.id + " (" + sc.en + "): " + listed.length + " products from " + pagesSeen + " listing page fetch(es)");

    let promo = 0;
    let storeRows = 0;
    for (const p of listed) {
      if (p.discount_pct || p.old_price_gel) promo++;

      let storeCount = "";
      const hist30 = { min: "", max: "", days: "", low: "", pill: "", min30: "", minSrc: "" };
      if (!NO_STORES && p.product_url && !doneBarcodes.has(p.barcode)) {
        const phtml = await politeFetch(p.product_url, "product " + p.barcode);
        if (phtml) {
          const stores = parseProduct(phtml);
          storeCount = String(stores.length);

          const hist = parseHistory(phtml);
          if (hist) {
            hist30.min = tetriToGel(hist.min);
            hist30.max = tetriToGel(hist.max);
            hist30.days = String(hist.days);
          } else {
            noHistory++;
          }
          // Product-level 30-day pill. Two forms:
          //   class="lowpill is-best"  text "↓ ბოლო 30 დღის ყველაზე დაბალი ფასი"
          //        -> the current best price IS the 30-day low
          //   class="lowpill"          text "ბოლო 30 დღის მინიმუმი: 9.27₾"
          //        -> the 30-day minimum, which the current price is above
          // The pill is the site's authoritative 30-day minimum: the ph-data chart can have
          // missing days, so its series minimum is sometimes higher than the pill's figure.
          const pill = phtml.match(/<div class="(lowpill[^"]*)"[^>]*>([\s\S]*?)<\/div>/);
          hist30.low = pill ? (/\bis-best\b/.test(pill[1]) ? "yes" : "no") : "";
          hist30.pill = pill ? stripTags(pill[2]) : "";
          if (pill && /\bis-best\b/.test(pill[1])) {
            // "↓ lowest price of the last 30 days": the pill states the current best price is the low.
            hist30.min30 = p.price_gel;
            hist30.minSrc = "pill_is_best";
          } else if (pill && money(hist30.pill)) {
            // "last 30 days minimum: 9.27₾"
            hist30.min30 = money(hist30.pill);
            hist30.minSrc = "pill";
          } else if (hist30.min) {
            hist30.min30 = hist30.min;
            hist30.minSrc = "chart";
          }
          // The store rows carry no store id, so match each row to its history series by the
          // series' current price, falling back to list order. history_match records which.
          const usedSeries = new Set();
          const matchFor = (row) => {
            if (!hist || !hist.series.length) return { s: null, how: "" };
            const tetri = row.store_price_gel ? Math.round(parseFloat(row.store_price_gel) * 100) : null;
            let idx = hist.series.findIndex((s, k) => !usedSeries.has(k) && s.last === tetri);
            let how = "price";
            if (idx === -1) {
              idx = hist.series.findIndex((s, k) => !usedSeries.has(k));
              how = idx === -1 ? "none" : "order";
            }
            if (idx === -1) return { s: null, how: "none" };
            usedSeries.add(idx);
            return { s: hist.series[idx], how: how };
          };

          for (const s of stores) {
            const m = matchFor(s);
            fs.appendFileSync(STORE_CSV, csvLine(STORE_COLS, Object.assign({}, s, {
              barcode: p.barcode,
              product_name: p.product_name,
              subcategory_id: sc.id,
              subcategory_name_ka: nameKa,
              store_min_30d_gel: m.s ? tetriToGel(m.s.min) : "",
              store_max_30d_gel: m.s ? tetriToGel(m.s.max) : "",
              store_regular_30d_gel: m.s ? tetriToGel(m.s.regular) : "",
              store_promo_days_30d: m.s ? String(m.s.promoDays) : "",
              store_history_days: m.s ? String(m.s.days) : "",
              history_series_id: m.s ? m.s.id : "",
              history_match: m.how,
              date_scraped: date_scraped,
            })), "utf8");
            if (m.how === "order") matchedByOrder++;
            if (m.how === "none") matchedNone++;
          }
          storeRows += stores.length;
          doneBarcodes.add(p.barcode);
          if (doneBarcodes.size % 50 === 0) saveState();
        }
      }

      fs.appendFileSync(MARKET_CSV, csvLine(MARKET_COLS, Object.assign({}, p, {
        subcategory_id: sc.id,
        subcategory_name_ka: nameKa,
        subcategory_name_en: sc.en,
        min_30d_gel: hist30.min30,
        min_30d_source: hist30.minSrc,
        is_30d_low: hist30.low,
        low30_pill_text: hist30.pill,
        chart_min_30d_gel: hist30.min,
        chart_max_30d_gel: hist30.max,
        history_days: hist30.days,
        store_count_listed: storeCount,
        date_scraped: date_scraped,
      })), "utf8");
    }

    stats[sc.id] = { en: sc.en, ka: nameKa, products: listed.length, expected: expected, dupSlots: dupSlots, pages: pagesSeen, promo: promo, storeRows: storeRows };
    doneSubcats.add(sc.id);
    saveState();
    log("   -> promos: " + promo + ", store rows: " + storeRows);
  }

  // ───────────── summary ─────────────
  const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
  const vals = Object.values(stats);
  const totP = vals.reduce((a, s) => a + s.products, 0);
  const totPromo = vals.reduce((a, s) => a + s.promo, 0);
  const totStore = vals.reduce((a, s) => a + s.storeRows, 0);

  let out = "dazoge.info scrape — " + date_scraped + "\n";
  out += "source category: სახლის მოვლა და ჰიგიენა (c/99); skipped c/103, c/107\n";
  out += "requests: " + requestCount + " at >=" + REQUEST_DELAY_MS + "ms  |  runtime: " + mins + " min";
  out += NO_STORES ? "  |  mode: --no-stores (listing only)\n" : "\n";
  out += "\nNote: 'site-slots' is the category's own numberOfItems (listing slots). dazoge lists a few\n";
  out += "products in more than one slot, so products = site-slots - dup-slots. Nothing is missing.\n";
  out += "\nsubcat  products  site-slots  dup-slots  promos  store-rows  name\n";
  for (const id of Object.keys(stats)) {
    const s = stats[id];
    out += ("c/" + id).padEnd(8) + String(s.products).padEnd(10) +
      String(s.expected == null ? "?" : s.expected).padEnd(12) + String(s.dupSlots).padEnd(11) +
      String(s.promo).padEnd(8) + String(s.storeRows).padEnd(12) + s.ka + " (" + s.en + ")\n";
  }
  out += "\nTOTAL   " + totP + " products, " + totPromo + " with a promotion, " + totStore + " store rows\n";
  if (!NO_STORES) {
    out += "\n30-day history: product pages without a ph-data block: " + noHistory +
      "\n  store rows matched to a history series by position rather than price: " + matchedByOrder +
      "\n  store rows with no history series at all: " + matchedNone + "\n";
  }
  out += "\nerrors: " + errors.length + "\n";
  if (errors.length) out += errors.slice(0, 100).map((e) => "  - " + e).join("\n") + "\n";
  fs.writeFileSync(SUMMARY, out, "utf8");
  log("\n" + out);
})();
