/**
 * build.js — turns one scrape (listing cards, plus product pages in a full run) and the
 * previously published data into the files under /data. Pure function, no network, no disk.
 *
 * Rules:
 *   - Never guess: a value the site did not show is null.
 *   - A full run refreshes everything. A quick run (listing pages only) refreshes only
 *     cheapest_now, promo_now, old_price and discount_pct, adds new products with basic fields, and
 *     keeps regular prices, per-store data and 30-day history from the last full run.
 *   - Products that are no longer listed are kept with status "not listed" and the date they vanished.
 */
const { classify, detailOf, labelOf } = require("./types/classifier.js");

const round = (x, d = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const same = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.005);

/** Size as published: { size, unit: "l"|"kg"|"pc", source }. Volume column first, then a size in the name. */
function sizeFrom(volume, name) {
  let m = String(volume || "").match(/^\s*(\d+(?:[.,]\d+)?)\s*(მლ|ლ|კგ|გრ?|ც)\s*$/);
  let source = "volume";
  if (!m) { m = String(name || "").match(/(\d+(?:[.,]\d+)?)\s*(მლ|ml|ლ|l|კგ|kg|გრ?|gr?|ც)(?![ა-ჰa-z])/i); source = "name"; }
  if (!m) return { size: null, unit: null, source: "" };
  const n = Number(m[1].replace(",", "."));
  if (!(n > 0)) return { size: null, unit: null, source: "" };
  const u = m[2].toLowerCase();
  if (u === "მლ" || u === "ml") return { size: round(n / 1000, 4), unit: "l", source };
  if (u === "ლ" || u === "l") return { size: round(n, 4), unit: "l", source };
  if (u === "კგ" || u === "kg") return { size: round(n, 4), unit: "kg", source };
  if (u === "ც") return { size: n, unit: "pc", source };
  return { size: round(n / 1000, 4), unit: "kg", source }; // გ / გრ / g / gr
}

const perUnit = (price, size) => (price != null && size ? round(price / size, 2) : null);

/** Per-store list, regular price, cheapest-now and promo frequency from a parsed product page. */
function storeFields(page) {
  const stores = page.stores.map((s) => ({
    store: s.store || null,
    price: s.price,
    old_price: s.old_price,
    discount_pct: s.discount_pct,
    regular_30d: s.regular_30d,
    min_30d: s.min_30d,
    promo_days: s.promo_days,
    history_days: s.history_days,
    link: s.link || null,
  }));
  let reg = null, cheap = null;
  for (const s of stores) {
    if (s.regular_30d != null && (reg == null || s.regular_30d < reg.regular_30d)) reg = s;
    if (s.price != null && (cheap == null || s.price < cheap.price)) cheap = s;
  }
  const withHist = stores.filter((s) => s.history_days > 0 && s.promo_days != null);
  return {
    stores,
    regular_price: reg ? reg.regular_30d : null,
    regular_price_store: reg ? reg.store : null,
    cheapest_now: cheap ? cheap.price : null,
    cheapest_now_store: cheap ? cheap.store : null,
    often_on_promo: withHist.length ? withHist.some((s) => s.promo_days / s.history_days >= 0.33) : null,
    min_30d: page.min_30d,
    store_count: stores.length,
    image_url: page.image_url || null,
  };
}

/** Compact 30-day per-store series for the product page charts: [dayIndex, price, oldPrice|0]. */
function history30(barcode, page) {
  const s = page.stores.filter((x) => x.history && x.history.length);
  if (!s.length) return null;
  return { b: barcode, from: page.history_dates[0] || null, days: page.history_days, s: s.map((x) => [x.store, x.history]) };
}

/**
 * @param o.mode       "full" | "quick"
 * @param o.runId      unique id of this run
 * @param o.now        Date of the run end
 * @param o.today      "YYYY-MM-DD" (Tbilisi)
 * @param o.listing    [{ subcat:{id,en}, name_ka, items:[listing card] }]
 * @param o.pages      Map barcode -> parsed product page (full run; missing = page failed)
 * @param o.prev       previous products.json object, or null on the very first run
 * @param o.prevMeta   previous meta.json, or null
 * @param o.rates      rates.json object (may be the previous one)
 * @param o.run        { started_at, requests, failed_requests, product_pages_failed }
 */
function build(o) {
  const nowIso = o.now.toISOString();
  const full = o.mode === "full";
  const prevMap = new Map(((o.prev && o.prev.products) || []).map((p) => [p.barcode, p]));
  const baseline = !o.prev;
  if (!full && baseline) throw new Error("a quick update needs a previous full update; run 'Update prices (full)' first");

  // One record per barcode; subcategory = the first one (in SUBCATS order) that lists it.
  const seen = new Map();
  for (const sc of o.listing) for (const it of sc.items) {
    if (!seen.has(it.barcode)) seen.set(it.barcode, { it, subcat: sc.subcat, subcat_name: sc.name_ka, subcats: [sc.subcat.id] });
    else if (!seen.get(it.barcode).subcats.includes(sc.subcat.id)) seen.get(it.barcode).subcats.push(sc.subcat.id);
  }

  const products = [];
  const h30 = [];
  const changes = { price_changes: [], new: [], disappeared: [], returned: [] };
  const hist = [];
  const ev = (b, e, extra) => hist.push({ t: nowIso, m: o.mode, b, e, ...extra });

  for (const [barcode, { it, subcat, subcat_name, subcats }] of seen) {
    const prev = prevMap.get(barcode) || null;
    const cls = classify({ product_name: it.name, subcategory_id: subcat.id, volume: it.volume });
    const det = detailOf(cls.type, { product_name: it.name, volume: it.volume });
    const sz = sizeFrom(it.volume, it.name);
    const page = full ? o.pages.get(barcode) || null : null;

    const rec = {
      barcode,
      name: it.name || (prev && prev.name) || null,
      subcategory: subcat.id,
      subcategory_name: subcat_name || subcat.en,
      subcategories: subcats,
      type: cls.type,
      type_label: labelOf[cls.type],
      detail: det.detail || null,
      size: sz.size,
      unit: sz.unit,
      size_source: sz.source || null,
      image_url: null,
      link: it.link || (prev && prev.link) || null,
      regular_price: null,
      regular_price_store: null,
      cheapest_now: it.price,
      cheapest_now_store: null,
      promo_now: it.old_price != null || it.discount_pct != null,
      old_price: it.old_price,
      discount_pct: it.discount_pct,
      often_on_promo: null,
      min_30d: null,
      store_count: it.store_count,
      price_per_unit: null,
      price_per_unit_now: null,
      stores: [],
      last_change: (prev && prev.last_change) || null,
      status: "active",
      not_listed_since: null,
      first_seen: (prev && prev.first_seen) || o.today,
      last_full_update: (prev && prev.last_full_update) || null,
      last_quick_update: (prev && prev.last_quick_update) || null,
    };

    if (page) {
      const f = storeFields(page);
      Object.assign(rec, {
        image_url: f.image_url || it.image_url || null,
        regular_price: f.regular_price, regular_price_store: f.regular_price_store,
        cheapest_now: f.cheapest_now != null ? f.cheapest_now : it.price,
        cheapest_now_store: f.cheapest_now != null ? f.cheapest_now_store : null,
        often_on_promo: f.often_on_promo, min_30d: f.min_30d, store_count: f.store_count, stores: f.stores,
        last_full_update: nowIso,
      });
      const h = history30(barcode, page);
      if (h) h30.push(h);
    } else if (prev) {
      // Quick run, or a product page that failed in a full run: keep the last full-run values.
      Object.assign(rec, {
        image_url: prev.image_url || it.image_url || null,
        regular_price: prev.regular_price, regular_price_store: prev.regular_price_store,
        often_on_promo: prev.often_on_promo, min_30d: prev.min_30d, stores: prev.stores || [],
        store_count: prev.store_count != null ? prev.store_count : it.store_count,
        // The listing does not say which store is cheapest: keep the store only if the price is unchanged.
        cheapest_now_store: same(prev.cheapest_now, it.price) ? prev.cheapest_now_store : null,
      });
      if (o.prevH30 && o.prevH30.has(barcode)) h30.push(o.prevH30.get(barcode));
    } else {
      rec.image_url = it.image_url || null;
    }
    if (!full) rec.last_quick_update = nowIso;
    rec.price_per_unit = perUnit(rec.regular_price, rec.size);
    rec.price_per_unit_now = perUnit(rec.cheapest_now, rec.size);

    // ── change tracking ──
    if (!prev) {
      if (!baseline) changes.new.push({ barcode, name: rec.name, type: rec.type, cheapest_now: rec.cheapest_now });
      ev(barcode, "new", { cheapest_now: rec.cheapest_now, regular_price: rec.regular_price });
    } else {
      if (prev.status !== "active") {
        changes.returned.push({ barcode, name: rec.name, not_listed_since: prev.not_listed_since });
        ev(barcode, "back", {});
      }
      const fields = full && page ? ["cheapest_now", "regular_price"] : ["cheapest_now"];
      for (const f of fields) {
        if (prev[f] != null && rec[f] != null && !same(prev[f], rec[f])) {
          changes.price_changes.push({ barcode, name: rec.name, field: f, old: prev[f], new: rec[f], pct: round((100 * (rec[f] - prev[f])) / prev[f], 1) });
          ev(barcode, "price", { f, o: prev[f], n: rec[f] });
          if (f === "regular_price") rec.last_change = { old_regular_price: prev[f], new_regular_price: rec[f], date: o.today };
        }
      }
    }
    products.push(rec);
  }

  // Products that were published before but are not on any listing page now.
  for (const [barcode, prev] of prevMap) {
    if (seen.has(barcode)) continue;
    const rec = { ...prev };
    if (prev.status === "active") {
      rec.status = "not listed";
      rec.not_listed_since = o.today;
      changes.disappeared.push({ barcode, name: prev.name, last_cheapest_now: prev.cheapest_now });
      ev(barcode, "gone", {});
    }
    products.push(rec);
    if (o.prevH30 && o.prevH30.has(barcode)) h30.push(o.prevH30.get(barcode));
  }

  products.sort((a, b) => (a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0));
  const active = products.filter((p) => p.status === "active");
  const changedSet = new Set(changes.price_changes.map((c) => c.barcode));
  const counts = {
    baseline,
    products_changed: changedSet.size,
    price_changes: changes.price_changes.length,
    new: changes.new.length,
    disappeared: changes.disappeared.length,
    returned: changes.returned.length,
  };
  const types = {};
  for (const p of active) types[p.type] = (types[p.type] || 0) + 1;

  const prevMeta = o.prevMeta || {};
  const meta = {
    run_id: o.runId,
    generated_at: nowIso,
    last_full_update: full ? nowIso : prevMeta.last_full_update || null,
    last_quick_update: full ? prevMeta.last_quick_update || null : nowIso,
    last_run: {
      mode: o.mode,
      started_at: o.run.started_at,
      finished_at: nowIso,
      minutes: round((o.now - new Date(o.run.started_at)) / 60000, 1),
      requests: o.run.requests,
      failed_requests: o.run.failed_requests,
      product_pages_failed: o.run.product_pages_failed || 0,
      changes: counts,
    },
    products_active: active.length,
    products_not_listed: products.length - active.length,
    products_total: products.length,
    types,
    other_pct: round((100 * (types.other || 0)) / (active.length || 1), 1),
    rates: o.rates ? { valid_from: o.rates.valid_from, rates: o.rates.rates } : null,
  };

  const changesToday = {
    run_id: o.runId, mode: o.mode, date: o.today, generated_at: nowIso,
    previous_run: prevMeta.run_id || null,
    note: "Changes since the previous published run (full or quick).",
    counts,
    ...changes,
  };

  return { products, meta, changesToday, history: hist, h30 };
}

module.exports = { build, sizeFrom };
