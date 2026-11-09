/**
 * dazoge.js — polite fetching and HTML parsing for dazoge.info (shared by update.js).
 * Parsing rules are the ones used by dazoge_scrape.js (1 Nov 2026 run), kept identical.
 *
 * Politeness / compliance:
 *   - robots.txt is read at the start of every run; the run stops if /c/ or /product/ is disallowed.
 *     /search and /api/ (Disallow for "User-agent: *") are refused by politeFetch itself.
 *   - Strictly sequential, one request per REQUEST_DELAY_MS (1100 ms). No parallelism anywhere.
 *   - Retries with backoff on network errors, 5xx and 429.
 *   - A block (403, Cloudflare challenge) is never worked around: the run stops with an error.
 * Nothing is guessed: any value not present in the HTML is returned as null / "".
 */
const BASE = "https://dazoge.info";
const REQUEST_DELAY_MS = 1100;
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30000;

// c/103 (contraceptives) and c/107 (other) are intentionally skipped.
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
  accept: "text/html,application/xhtml+xml",
  "accept-language": "ka,en;q=0.9",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BlockedError extends Error {}

// ───────────────────────────── text helpers ─────────────────────────────
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return String(s)
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENT[e])
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
const stripTags = (html) => decode(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
/** "3.95₾" -> 3.95; null when no amount is present. */
function money(text) {
  const m = String(text).replace(/ /g, " ").match(/(\d[\d\s]*(?:[.,]\d+)?)\s*₾/);
  return m ? Number(m[1].replace(/\s/g, "").replace(",", ".")) : null;
}
/** "-18%" -> 18; null when absent. */
function pct(text) {
  const m = String(text).match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? Number(m[1].replace(",", ".")) : null;
}
function intOf(text) {
  const m = String(text).match(/\d+/);
  return m ? Number(m[0]) : null;
}
const tetri = (v) => (v == null || v === "" ? null : Math.round(Number(v)) / 100);

// ───────────────────────────── fetching ─────────────────────────────
const stats = { requests: 0, failed: 0, ms: 0 };
let lastRequestAt = 0;

function looksBlocked(res, body) {
  if (res.status === 403) return "HTTP 403";
  if (res.headers.get("cf-mitigated")) return "cf-mitigated: " + res.headers.get("cf-mitigated");
  if (/<title>\s*(Just a moment|Attention Required|Access denied)/i.test(body)) return "Cloudflare challenge page";
  return "";
}

/**
 * Sequential, rate-limited GET. Returns the body text, or null when the page could not be
 * fetched after retries (404 etc.). Throws BlockedError when dazoge refuses us (403/challenge).
 */
async function politeFetch(url, label) {
  const u = new URL(url);
  if (u.host !== "dazoge.info") throw new Error("refusing foreign host " + u.host);
  if (/^\/(search|api)(\/|$)/.test(u.pathname)) throw new Error("refusing robots-disallowed path " + u.pathname);
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const wait = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    stats.requests++;
    const t0 = Date.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { headers: HEADERS, signal: ctl.signal });
      const body = await res.text();
      clearTimeout(timer);
      stats.ms += Date.now() - t0;
      const blocked = looksBlocked(res, body);
      if (blocked) throw new BlockedError("dazoge.info refused the request (" + blocked + ") at " + label);
      if (res.status === 429 || res.status >= 500) throw new Error("HTTP " + res.status);
      if (!res.ok) { stats.failed++; return { body: null, error: "HTTP " + res.status }; }
      return { body, error: "" };
    } catch (e) {
      if (e instanceof BlockedError) throw e;
      lastErr = e.name === "AbortError" ? "timeout" : e.message;
      if (attempt < MAX_RETRIES) await sleep(REQUEST_DELAY_MS * attempt * 3);
    }
  }
  stats.failed++;
  return { body: null, error: lastErr };
}

/** Reads robots.txt and stops the run if the paths we use are disallowed for "*". */
async function checkRobots() {
  const { body, error } = await politeFetch(BASE + "/robots.txt", "robots.txt");
  if (body == null) throw new Error("could not read robots.txt (" + error + "); not scraping");
  let applies = false;
  const disallow = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") applies = v === "*";
    else if (k === "disallow" && applies && v) disallow.push(v);
  }
  for (const p of ["/c/", "/product/"]) {
    const hit = disallow.find((d) => p.startsWith(d) || d === "/");
    if (hit) throw new Error("robots.txt now disallows " + p + " (rule: Disallow: " + hit + "); not scraping");
  }
  return disallow;
}

// ───────────────────────────── parsing ─────────────────────────────
/** Keep only the catalogue grid (each page repeats a 12-card promotions block above it). */
function catalogueHtml(html) {
  const mainStart = html.indexOf("<main");
  const main = mainStart === -1 ? html : html.slice(mainStart);
  const sections = main.split('<section class="block"').slice(1);
  if (!sections.length) return main;
  const withH2 = sections.map((s) => ({ html: s, h2: stripTags((s.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || "") }));
  let keep = withH2.filter((s) => /ყველა მაღაზიაში/.test(s.h2));
  if (!keep.length) keep = withH2.filter((s) => !/აქციები და ფასდაკლებები/.test(s.h2));
  if (!keep.length) keep = withH2;
  return keep.map((s) => s.html).join("\n");
}

/** Product cards on a category listing page. */
function parseListing(html) {
  const out = [];
  for (const chunk of catalogueHtml(html).split('<a class="pcard"').slice(1)) {
    const end = chunk.indexOf("</a>");
    const card = end === -1 ? chunk : chunk.slice(0, end);
    const href = (card.match(/href="([^"]+)"/) || [])[1] || "";
    const bc = (href.match(/\/product\/([^/?#]+)/) || [])[1] || "";
    const name = stripTags((card.match(/<div class="pname"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "");
    if (!bc) continue;
    out.push({
      barcode: decodeURIComponent(bc),
      name,
      volume: stripTags((card.match(/<div class="pvol"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ""),
      price: money((card.match(/<span class="pprice[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || ""),
      old_price: money((card.match(/<s class="pold"[^>]*>([\s\S]*?)<\/s>/) || [])[1] || ""),
      discount_pct: pct((card.match(/<span class="pbadge pbadge-sale"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || ""),
      store_count: intOf((card.match(/<span class="pbadge pbadge-count"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || ""),
      image_url: decode((card.match(/<img[^>]*class="pimg"[^>]*src="([^"]+)"/) || card.match(/<img[^>]*src="([^"]+)"[^>]*class="pimg"/) || [])[1] || ""),
      link: href ? BASE + decode(href) : "",
    });
  }
  return out;
}

const hasNextPage = (html, subcatId) =>
  new RegExp('<a class="pg"[^>]*href="\\/c\\/' + subcatId + '\\/[^"]*[?&]page=(\\d+)"').test(html);
const numberOfItems = (html) => { const n = (html.match(/"numberOfItems":\s*(\d+)/) || [])[1]; return n ? Number(n) : null; };
const subcatName = (html) => stripTags((html.match(/<nav class="crumbs"[\s\S]*?<span[^>]*>([^<]*)<\/span>\s*<\/nav>/) || [])[1] || "");

/**
 * 30-day history from <script id="ph-data">. Prices are integer tetri; a point is
 * [dayIndex, price, oldPrice] where oldPrice > 0 marks a promotion day.
 * Regular price = the most frequently charged price on non-promotion days.
 */
function parseHistory(html) {
  const raw = (html.match(/<script[^>]*id="ph-data"[^>]*>([\s\S]*?)<\/script>/) || [])[1];
  if (!raw) return null;
  let j;
  try { j = JSON.parse(raw); } catch { return null; }
  const series = (j.series || []).map((s) => {
    const pts = (s.points || []).filter((p) => Array.isArray(p) && Number(p[1]) > 0);
    const prices = pts.map((p) => Number(p[1]));
    const freq = {};
    for (const p of pts.filter((p) => !Number(p[2]))) freq[p[1]] = (freq[p[1]] || 0) + 1;
    let regular = null, bestN = 0;
    for (const k of Object.keys(freq)) if (freq[k] > bestN) { bestN = freq[k]; regular = Number(k); }
    return {
      last: pts.length ? Number(pts[pts.length - 1][1]) : null,
      min: prices.length ? Math.min(...prices) : null,
      regular,
      promoDays: pts.filter((p) => Number(p[2]) > 0).length,
      days: pts.length,
      points: pts.map((p) => [Number(p[0]), Number(p[1]), Number(p[2]) || 0]),
    };
  });
  return { days: j.days == null ? null : Number(j.days), dates: Array.isArray(j.dates) ? j.dates : [], min: j.min == null ? null : Number(j.min), series };
}

/** Per-store rows. Cell order: store, updated, discount, old price, price. */
function parseStoreRows(html) {
  const rows = [];
  for (const m of html.matchAll(/<a class="srow([^"]*)"[^>]*href="([^"]*)"([\s\S]*?)<\/a>/g)) {
    const inner = m[3];
    const cells = [...inner.matchAll(/<span class="scell([^"]*)"[^>]*>([\s\S]*?)<\/span>\s*(?=<span class="scell|$)/g)].map((c) => stripTags(c[2]));
    if (!cells.length) continue;
    rows.push({
      store: stripTags((inner.match(/<span class="sname"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || cells[0]),
      price: cells[4] ? money(cells[4]) : null,
      old_price: cells[3] ? money(cells[3]) : null,
      discount_pct: cells[2] ? pct(cells[2]) : null,
      is_best: /\bis-best\b/.test(m[1]),
      updated_text: cells[1] || "",
      link: decode(m[2]),
    });
  }
  return rows;
}

/**
 * Everything the build step needs from one product page.
 * Store rows carry no store id, so each row is matched to its history series by the series'
 * current price, falling back to list order (history_match says which).
 */
function parseProductPage(html, listingPrice) {
  const stores = parseStoreRows(html);
  const hist = parseHistory(html);
  const used = new Set();
  for (const s of stores) {
    let idx = -1, how = "none";
    if (hist && hist.series.length) {
      const t = s.price == null ? null : Math.round(s.price * 100);
      idx = hist.series.findIndex((x, k) => !used.has(k) && x.last === t);
      how = "price";
      if (idx === -1) { idx = hist.series.findIndex((x, k) => !used.has(k)); how = idx === -1 ? "none" : "order"; }
    }
    const h = idx === -1 ? null : hist.series[idx];
    if (idx !== -1) used.add(idx);
    s.regular_30d = h ? tetri(h.regular) : null;
    s.min_30d = h ? tetri(h.min) : null;
    s.promo_days = h ? h.promoDays : null;
    s.history_days = h ? h.days : null;
    s.history = h ? h.points.map(([d, p, o]) => [d, p / 100, o ? o / 100 : 0]) : null;
    s.history_match = how;
  }
  // The "lowpill" is the site's own 30-day minimum (the chart can miss days).
  let min30 = null, min30Source = "";
  const pill = html.match(/<div class="(lowpill[^"]*)"[^>]*>([\s\S]*?)<\/div>/);
  if (pill && /\bis-best\b/.test(pill[1]) && listingPrice != null) { min30 = listingPrice; min30Source = "pill_is_best"; }
  else if (pill && money(stripTags(pill[2])) != null) { min30 = money(stripTags(pill[2])); min30Source = "pill"; }
  else if (hist && hist.min != null) { min30 = tetri(hist.min); min30Source = "chart"; }
  const og = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/) || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/);
  return {
    stores,
    min_30d: min30,
    min_30d_source: min30Source,
    history_dates: hist ? hist.dates : [],
    history_days: hist ? hist.days : null,
    image_url: og ? decode(og[1]) : "",
  };
}

module.exports = {
  BASE, SUBCATS, REQUEST_DELAY_MS, BlockedError, stats, sleep,
  politeFetch, checkRobots, parseListing, hasNextPage, numberOfItems, subcatName, parseProductPage,
};
