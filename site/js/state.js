// App state: data loading, settings (localStorage), the current deal (supplier inputs).
import { parseAliases, parseBrands, fold, hasWord } from "./text.js";
import { buildIndex } from "./search.js";
import { DEFAULTS } from "./calc.js";

export const S = {
  meta: null, products: [], byBarcode: new Map(), rates: null, changes: null,
  changeBy: new Map(), aliases: [], brands: [], idx: null, types: [], settings: null,
};

const get = async (url, kind = "json") => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url.split("?")[0] + ": HTTP " + r.status);
  return kind === "json" ? r.json() : r.text();
};

/** Load everything. Files under data/ are versioned by run_id so the service worker can keep them. */
export async function loadAll(progress) {
  progress("Checking for new prices…");
  S.meta = await get("data/meta.json");
  // Version key for the offline cache: a new run, or a re-typing of the same run (scraper/retype.js).
  const v = "?v=" + encodeURIComponent(S.meta.run_id + (S.meta.retyped_at ? "_" + S.meta.retyped_at : ""));
  progress("Loading prices…");
  const [prod, rates, changes, aliases, brands] = await Promise.all([
    get("data/products.json" + v),
    get("data/rates.json" + v).catch(() => null),
    get("data/changes_today.json" + v).catch(() => null),
    get("config/aliases.txt", "text").catch(() => ""),
    get("config/big_brands.txt", "text").catch(() => ""),
  ]);
  S.products = prod.products;
  S.byBarcode = new Map(S.products.map((p) => [p.barcode, p]));
  S.rates = rates || (S.meta.rates ? { valid_from: S.meta.rates.valid_from, rates: S.meta.rates.rates } : null);
  S.changes = changes;
  S.changeBy = new Map();
  if (changes && changes.price_changes) {
    // one change per product: the cheapest-now change if there is one (both run types update it)
    for (const c of changes.price_changes) {
      const had = S.changeBy.get(c.barcode);
      if (!had || (c.field === "cheapest_now" && had.field !== "cheapest_now")) S.changeBy.set(c.barcode, c);
    }
  }
  S.aliases = parseAliases(aliases);
  S.brands = parseBrands(brands, S.aliases);
  progress("Preparing search…");
  await new Promise((r) => setTimeout(r, 0));
  S.idx = buildIndex(S.products, S.aliases);
  // big-brand flag per product
  for (const p of S.products) {
    const f = fold(p.name);
    const b = S.brands.find((br) => br.match.some((m) => hasWord(f, m)));
    p._brand = b ? b.name : null;
  }
  // product types present in the data, most common first
  const t = new Map();
  for (const p of S.products) {
    if (p.status !== "active") continue;
    const x = t.get(p.type) || { id: p.type, label: shortLabel(p.type_label || p.type), count: 0, units: {} };
    x.count++;
    if (p.unit) x.units[p.unit] = (x.units[p.unit] || 0) + 1;
    t.set(p.type, x);
  }
  const order = (id) => { const i = TYPE_ORDER.indexOf(id); return i < 0 ? TYPE_ORDER.length - 1.5 : i; };
  S.types = [...t.values()].map((x) => ({ ...x, unit: Object.entries(x.units).sort((a, b) => b[1] - a[1])[0]?.[0] || "pc" }))
    .sort((a, b) => order(a.id) - order(b.id));
}

// Chip order = the order of scraper/types/product_types.js (household first, extra types, "other" last).
const TYPE_ORDER = ["laundry_powder", "laundry_liquid", "laundry_capsules", "fabric_softener", "laundry_additives", "bleach",
  "dish_liquid", "dishwasher_tablets", "dishwasher_salt_rinse", "universal_cleaner", "cream_cleaner", "kitchen_degreaser",
  "bathroom_cleaner", "glass_cleaner", "toilet_cleaner", "toilet_block", "floor_cleaner", "air_freshener", "toilet_paper",
  "paper_towels", "napkins", "tissues", "wet_wipes_baby", "wet_wipes_other", "shampoo", "conditioner", "hair_care_unclear",
  "shower_gel", "bar_soap", "liquid_soap", "toothpaste", "toothbrush", "mouthwash", "deodorant", "razor_shaving", "diapers",
  "feminine_pads", "tampons", "cotton_buds", "cotton_pads", "hand_body_cream", "sponges", "cloths", "cleaning_brushes", "gloves",
  "trash_bags", "foil_film", "disposable_tableware", "hair_dye", "nail_care", "makeup", "perfume", "face_care", "hair_styling",
  "hosiery", "hair_accessories", "insecticide", "shoe_care", "other"];

/** Type label without a long explanation in brackets ("wet wipes (baby)" keeps its bracket). */
export const shortLabel = (l) => String(l).replace(/\s*\(([^)]{13,})\)\s*/, "").trim();

/** Price per unit used for comparisons: regular, else current cheapest. */
export const ppuOf = (p) => (p.price_per_unit != null ? p.price_per_unit : p.price_per_unit_now);

// ── settings ──
const KEY = "pc.settings.v1";
export function loadSettings() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
  S.settings = { ...DEFAULTS, ...(s || {}), rates: { ...DEFAULTS.rates, ...((s && s.rates) || {}) } };
  return S.settings;
}
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(S.settings)); } catch {}
  window.dispatchEvent(new Event("settings-changed"));
}
export function resetSettings() {
  try { localStorage.removeItem(KEY); } catch {}
  loadSettings();
  window.dispatchEvent(new Event("settings-changed"));
  return S.settings;
}

// ── the deal being evaluated (kept while moving between screens, and across reloads) ──
const DKEY = "pc.deal.v1";
const DEAL0 = { price: "", currency: "USD", per: "piece", pcsPer: "", packSize: "", paid: "", free: "", offers: [], monthly: "" };
export let deal = { ...DEAL0 };
try { deal = { ...DEAL0, ...JSON.parse(localStorage.getItem(DKEY) || "{}") }; } catch {}
export function saveDeal() {
  try { localStorage.setItem(DKEY, JSON.stringify(deal)); } catch {}
}
export function clearDeal() {
  const cur = deal.currency;
  Object.keys(deal).forEach((k) => delete deal[k]);
  Object.assign(deal, { ...DEAL0, currency: cur, offers: [] });
  saveDeal();
}
