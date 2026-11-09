#!/usr/bin/env node
/**
 * update.js — the one-click price update (started by the desktop shortcuts via run_update.ps1).
 *
 *   node scraper/update.js full    ~90 min: listing pages + every product page (per-store prices,
 *                                  30-day regular price and history, og:image). Resumable: if it is
 *                                  interrupted, running it again continues where it stopped.
 *   node scraper/update.js quick   ~5 min: listing pages only (cheapest price, promo, old price,
 *                                  discount; new products with basic fields). Keeps the regular
 *                                  prices, per-store data and 30-day history of the last full run.
 *
 * Options: --fresh (ignore an interrupted full run), --dry (build into scraper/work/dry, no
 * data/ change, no git), --limit N (only N product pages; testing, implies --dry).
 *
 * Safety: nothing is written to data/ and nothing is pushed unless the whole run succeeded and
 * the result passed the checks below. Scraping runs only on this PC (dazoge blocks GitHub).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const dz = require("./lib/dazoge.js");
const { build } = require("./build.js");

const ROOT = path.resolve(__dirname, "..");
const WORK = path.join(__dirname, "work");
const DATA = path.join(ROOT, "data");
const SITE_URL = "https://vakosv.github.io/pricecheck/";
const NBG_URL = "https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/?currencies=USD&currencies=EUR&currencies=TRY";

const args = process.argv.slice(2);
const MODE = args.find((a) => a === "full" || a === "quick");
const FRESH = args.includes("--fresh");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 0;
const DRY = args.includes("--dry") || LIMIT > 0;
const MAX_FAILED_PAGES_PCT = 2;       // more product pages failing than this aborts a full run
const MIN_LISTED_VS_PREVIOUS = 0.7;   // listing shrinking below 70% of the last run aborts
const RESUME_HOURS = 36;

const STATE_FILE = path.join(WORK, "full_state.json");
const PAGES_FILE = path.join(WORK, "full_pages.jsonl");
const LOG_FILE = path.join(WORK, "update.log");
const RESULT_FILE = path.join(WORK, "last_result.txt");

fs.mkdirSync(WORK, { recursive: true });
const tty = process.stdout.isTTY;
const tbilisiDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi" }).format(d);
const tbilisiTime = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tbilisi", dateStyle: "medium", timeStyle: "short" }).format(d);
const n = (x) => Number(x).toLocaleString("en-US");

function log(line) {
  if (tty) process.stdout.write("\r" + " ".repeat(110) + "\r");
  process.stdout.write(line + "\n");
  fs.appendFileSync(LOG_FILE, new Date().toISOString() + " " + line + "\n", "utf8");
}
let lastProgress = 0;
function progress(line, force) {
  if (tty) process.stdout.write("\r" + line.slice(0, 108).padEnd(108));
  else if (force || Date.now() - lastProgress > 60000) { process.stdout.write(line + "\n"); lastProgress = Date.now(); }
}
const fmtMin = (ms) => (ms < 60000 ? Math.round(ms / 1000) + " s" : Math.round(ms / 60000) + " min");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function git(...a) {
  try {
    return execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    throw new Error("git " + a[0] + " failed: " + String(e.stderr || e.message).trim().split("\n").slice(-3).join(" | "));
  }
}

// ───────────────────────────── scraping ─────────────────────────────
async function scrapeListing() {
  const out = [];
  for (const sc of dz.SUBCATS) {
    const byBarcode = new Map();
    let page = 1, expected = null, name = "";
    for (;;) {
      const url = dz.BASE + "/c/" + sc.id + "/" + encodeURI(sc.slug) + (page > 1 ? "?page=" + page : "");
      progress("[" + MODE + "] listing c/" + sc.id + " (" + sc.en + ") page " + page + " · " + byBarcode.size + " products");
      const { body, error } = await dz.politeFetch(url, "listing c/" + sc.id + " p" + page);
      if (body == null) throw new Error("listing page c/" + sc.id + " page " + page + " failed (" + error + "); the listing would be incomplete");
      if (expected === null) expected = dz.numberOfItems(body);
      if (!name) name = dz.subcatName(body);
      const items = dz.parseListing(body);
      if (page === 1 && !items.length) throw new Error("no products on c/" + sc.id + " page 1 (site layout changed?)");
      for (const it of items) if (!byBarcode.has(it.barcode)) byBarcode.set(it.barcode, it);
      if (!items.length || !dz.hasNextPage(body, sc.id)) break;
      if (++page > 200) throw new Error("c/" + sc.id + ": more than 200 listing pages, stopping");
    }
    const warn = expected && byBarcode.size < 0.9 * expected ? "  (site says " + expected + " slots, check)" : "";
    log("  c/" + sc.id + " " + sc.en.padEnd(26) + n(byBarcode.size).padStart(6) + " products, " + page + " pages" + warn);
    out.push({ subcat: { id: sc.id, en: sc.en }, name_ka: name, items: [...byBarcode.values()] });
  }
  return out;
}

async function scrapeProductPages(listing, started) {
  const unique = new Map();
  for (const sc of listing) for (const it of sc.items) if (!unique.has(it.barcode)) unique.set(it.barcode, it);
  let todo = [...unique.values()];
  if (LIMIT) todo = todo.slice(0, LIMIT);

  const pages = new Map();
  if (fs.existsSync(PAGES_FILE)) {
    for (const line of fs.readFileSync(PAGES_FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (r.ok) pages.set(r.barcode, r.page); } catch { /* torn last line */ }
    }
  }
  const remaining = todo.filter((it) => !pages.has(it.barcode));
  if (pages.size) log("  resuming: " + n(pages.size) + " product pages already done, " + n(remaining.length) + " to go");

  const failed = [];
  let consecutive = 0;
  const t0 = Date.now();
  for (let i = 0; i < remaining.length; i++) {
    const it = remaining[i];
    const done = todo.length - remaining.length + i;
    const per = i ? (Date.now() - t0) / i : dz.REQUEST_DELAY_MS;
    progress("[full] product pages " + n(done) + "/" + n(todo.length) + " · " + Math.floor((100 * done) / todo.length) + "% · " +
      fmtMin(Date.now() - started) + " elapsed · ~" + fmtMin(per * (remaining.length - i)) + " left · failed " + failed.length);
    const { body, error } = await dz.politeFetch(it.link, "product " + it.barcode);
    if (body == null) {
      failed.push(it.barcode + " (" + error + ")");
      fs.appendFileSync(PAGES_FILE, JSON.stringify({ barcode: it.barcode, ok: false, error }) + "\n", "utf8");
      if (++consecutive >= 15) throw new Error("15 product pages in a row failed (last: " + error + "); dazoge may be down. Run the full update again later to resume.");
      continue;
    }
    consecutive = 0;
    const page = dz.parseProductPage(body, it.price);
    pages.set(it.barcode, page);
    fs.appendFileSync(PAGES_FILE, JSON.stringify({ barcode: it.barcode, ok: true, page }) + "\n", "utf8");
  }
  progress("[full] product pages " + n(todo.length) + "/" + n(todo.length) + " · 100%", true);
  if (tty) process.stdout.write("\n");
  const failedPct = (100 * failed.length) / (todo.length || 1);
  log("  product pages: " + n(pages.size) + " OK, " + failed.length + " failed (" + failedPct.toFixed(1) + "%)");
  if (failed.length) log("  failed: " + failed.slice(0, 20).join(", ") + (failed.length > 20 ? " …" : ""));
  if (failedPct > MAX_FAILED_PAGES_PCT) {
    throw new Error(failed.length + " product pages failed (" + failedPct.toFixed(1) + "%, limit " + MAX_FAILED_PAGES_PCT + "%). Run the full update again to retry them.");
  }
  return { pages, failed: failed.length };
}

async function fetchRates(prevRates) {
  try {
    // nbg.gov.ge answers the first request with a 307 to the same URL plus a session cookie, as
    // a browser would get; send the cookie back (fetch does not keep cookies by itself).
    let cookie = "", res = null;
    for (let i = 0; i < 4; i++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30000);
      res = await fetch(NBG_URL, { headers: { accept: "application/json", ...(cookie ? { cookie } : {}) }, redirect: "manual", signal: ctl.signal });
      clearTimeout(timer);
      if (res.status < 300 || res.status >= 400) break;
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
      cookie = set.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
      await dz.sleep(500);
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    const cur = (j[0] && j[0].currencies) || [];
    const rates = {};
    let valid = "";
    for (const code of ["USD", "EUR", "TRY"]) {
      const c = cur.find((x) => x.code === code);
      if (!c || !(c.rate > 0) || !(c.quantity > 0)) throw new Error(code + " missing in the NBG reply");
      rates[code] = Math.round((c.rate / c.quantity) * 1e6) / 1e6;
      valid = (c.validFromDate || c.date || "").slice(0, 10);
    }
    return {
      source: "National Bank of Georgia, official exchange rates",
      source_url: "https://nbg.gov.ge/en/monetary-policy/currency",
      note: "GEL per 1 unit of the currency",
      fetched_at: new Date().toISOString(),
      valid_from: valid,
      rates,
    };
  } catch (e) {
    log("  WARNING: could not get NBG rates (" + e.message + ")" + (prevRates ? "; keeping rates from " + prevRates.valid_from : ""));
    return prevRates || null;
  }
}

// ───────────────────────────── output ─────────────────────────────
const shardOf = (barcode) => (/^\d\d$/.test(barcode.slice(-2)) ? barcode.slice(-2) : "xx");

function readPrevH30() {
  const map = new Map();
  const dir = path.join(DATA, "history30");
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    const j = readJson(path.join(dir, f), {});
    for (const [b, v] of Object.entries(j)) map.set(b, { b, ...v });
  }
  return map;
}

/** All output files as { relativePath: content }. History is appended to the month file. */
function renderFiles(res, rates) {
  const files = {};
  files["products.json"] = '{"run_id":' + JSON.stringify(res.meta.run_id) + ',"generated_at":' + JSON.stringify(res.meta.generated_at) +
    ',"count":' + res.products.length + ',"products":[\n' + res.products.map((p) => JSON.stringify(p)).join(",\n") + "\n]}\n";
  files["meta.json"] = JSON.stringify(res.meta, null, 2) + "\n";
  files["changes_today.json"] = JSON.stringify(res.changesToday, null, 1) + "\n";
  if (rates) files["rates.json"] = JSON.stringify(rates, null, 2) + "\n";
  const shards = {};
  for (const h of res.h30) { const { b, ...rest } = h; (shards[shardOf(b)] = shards[shardOf(b)] || []).push('"' + b + '":' + JSON.stringify(rest)); }
  for (const [s, lines] of Object.entries(shards)) files["history30/" + s + ".json"] = "{\n" + lines.sort().join(",\n") + "\n}\n";
  const month = res.meta.generated_at.slice(0, 7);
  const histFile = "history/" + month + ".jsonl";
  const old = fs.existsSync(path.join(DATA, histFile)) ? fs.readFileSync(path.join(DATA, histFile), "utf8") : "";
  files[histFile] = old + res.history.map((h) => JSON.stringify(h)).join("\n") + (res.history.length ? "\n" : "");
  return files;
}

function validate(res, files, prevMeta) {
  const active = res.meta.products_active;
  if (active < 500) throw new Error("only " + active + " products found; refusing to publish");
  if (prevMeta && prevMeta.products_active && active < MIN_LISTED_VS_PREVIOUS * prevMeta.products_active) {
    throw new Error("listing shrank from " + prevMeta.products_active + " to " + active + " products; refusing to publish");
  }
  for (const p of res.products) if (!p.barcode || !p.name) throw new Error("product without barcode or name: " + JSON.stringify(p).slice(0, 120));
  for (const [f, c] of Object.entries(files)) {
    if (f.endsWith(".json")) JSON.parse(c);
    else c.split("\n").filter(Boolean).forEach((l) => JSON.parse(l));
  }
}

async function waitForSite(runId) {
  const t0 = Date.now();
  while (Date.now() - t0 < 12 * 60000) {
    progress("Waiting for the website to update · " + fmtMin(Date.now() - t0));
    try {
      const r = await fetch(SITE_URL + "data/meta.json?t=" + Date.now(), { cache: "no-store" });
      if (r.ok && (await r.json()).run_id === runId) { if (tty) process.stdout.write("\n"); return true; }
    } catch { /* not there yet */ }
    await dz.sleep(15000);
  }
  if (tty) process.stdout.write("\n");
  return false;
}

// ───────────────────────────── main ─────────────────────────────
(async () => {
  if (!MODE) { console.error("usage: node scraper/update.js full|quick [--fresh] [--dry] [--limit N]"); process.exit(2); }
  const started = Date.now();
  let state = readJson(STATE_FILE, null);
  if (MODE === "full" && state && (FRESH || started - Date.parse(state.started_at) > RESUME_HOURS * 3600e3)) {
    for (const f of [STATE_FILE, PAGES_FILE]) if (fs.existsSync(f)) fs.unlinkSync(f);
    state = null;
  }
  if (MODE === "full" && !state && fs.existsSync(PAGES_FILE)) fs.unlinkSync(PAGES_FILE);
  const startedAt = MODE === "full" && state ? state.started_at : new Date(started).toISOString();

  log("=== Update prices (" + MODE + ")" + (DRY ? " [dry run]" : "") + " — " + tbilisiTime(new Date(started)) + " Tbilisi time");
  if (!DRY) {
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    if (branch !== "main") throw new Error("the repo is on branch '" + branch + "', expected main");
  }

  const disallow = await dz.checkRobots();
  log("robots.txt OK (disallowed for everyone: " + disallow.join(" ") + ")");

  let listing;
  if (MODE === "full" && state && state.listing) {
    listing = state.listing;
    log("Resuming the full run started " + tbilisiTime(new Date(state.started_at)) + " (listing already done)");
  } else {
    log("Reading listing pages…");
    listing = await scrapeListing();
    if (MODE === "full") fs.writeFileSync(STATE_FILE, JSON.stringify({ started_at: startedAt, listing }), "utf8");
  }
  const listed = new Set(listing.flatMap((s) => s.items.map((i) => i.barcode))).size;
  log("Listing: " + n(listed) + " unique products");

  let pages = new Map(), failedPages = 0;
  if (MODE === "full") {
    log("Reading product pages (about " + fmtMin(listed * dz.REQUEST_DELAY_MS) + ")…");
    ({ pages, failed: failedPages } = await scrapeProductPages(listing, Date.parse(startedAt)));
  }

  const prevRates = readJson(path.join(DATA, "rates.json"), null);
  const rates = await fetchRates(prevRates);
  if (rates) log("NBG rates (" + rates.valid_from + "): " + Object.entries(rates.rates).map(([k, v]) => k + " " + v).join(", "));

  const now = new Date();
  const runId = MODE + "-" + now.toISOString();
  const prev = readJson(path.join(DATA, "products.json"), null);
  const prevMeta = readJson(path.join(DATA, "meta.json"), null);
  const res = build({
    mode: MODE, runId, now, today: tbilisiDate(now), listing, pages, prev, prevMeta, rates,
    prevH30: readPrevH30(),
    run: { started_at: startedAt, requests: dz.stats.requests, failed_requests: dz.stats.failed, product_pages_failed: failedPages },
  });
  const files = renderFiles(res, rates);
  validate(res, files, DRY ? null : prevMeta);
  const c = res.meta.last_run.changes;
  log("Built: " + n(res.meta.products_active) + " active products (" + res.meta.products_not_listed + " not listed), other " + res.meta.other_pct + "%; " +
    (c.baseline ? "first run (baseline)" : c.products_changed + " changed, " + c.new + " new, " + c.disappeared + " gone, " + c.returned + " back"));

  const outDir = DRY ? path.join(WORK, "dry") : DATA;
  for (const [f, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(outDir, f)), { recursive: true });
    fs.writeFileSync(path.join(outDir, f), content, "utf8");
  }
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  const changed = c.baseline ? "first run" : n(c.products_changed) + " changed";
  if (DRY) {
    finish(0, "Done (dry run, nothing published): " + n(res.meta.products_active) + " products, " + changed + ", " + mins + " min. Output in scraper/work/dry");
    return;
  }

  log("Publishing…");
  git("add", "data");
  const stamp = tbilisiTime(now);
  git("commit", "-q", "-m", "Data: " + MODE + " update " + stamp + " (Tbilisi) — " + n(res.meta.products_active) + " products, " + changed);
  git("pull", "-q", "--rebase", "--autostash", "origin", "main");
  git("push", "-q", "origin", "main");
  if (MODE === "full") for (const f of [STATE_FILE, PAGES_FILE]) if (fs.existsSync(f)) fs.unlinkSync(f);
  log("Pushed. Run time " + mins + " min.");

  const live = await waitForSite(runId);
  finish(0, "Done: " + n(res.meta.products_active) + " products, " + changed + ", " +
    (live ? "site updated" : "data pushed, but the site has not shown it yet after 12 min (check the Actions tab)") +
    ". (" + MODE + " run, " + mins + " min)");
})().catch((e) => {
  const blocked = e instanceof dz.BlockedError;
  finish(1, "ERROR: " + e.message + (blocked ? ". dazoge refused this PC's requests; nothing was published. Try again later." :
    MODE === "full" ? ". Nothing was published; running the full update again resumes where it stopped." : ". Nothing was published."));
});

function finish(code, line) {
  log(line);
  fs.writeFileSync(RESULT_FILE, line, "utf8");
  process.exitCode = code;
}
