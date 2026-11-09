// "My products": market prices the user entered for products that are not on Dazoge.
// Saved on this phone only (localStorage). Each item:
//   { id, name, price (GEL shelf price), sizeVal, sizeUnit (ml|l|g|kg|pc), link, note,
//     date (last save, ISO), created (ISO), deal (last supplier inputs),
//     sell ({ price, date }: my own selling price, when I typed one) }
import { buildIndex, search } from "./search.js";

const KEY = "pc.my.v1";
export const SIZE_UNITS = ["ml", "l", "g", "kg", "pc"];

export function loadMy() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
function store(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
export const getMy = (id) => loadMy().find((m) => m.id === id) || null;

/** Insert or update; returns the saved item (with id and date) or null if the phone refused. */
export function saveMy(item) {
  const list = loadMy();
  const now = new Date().toISOString();
  const it = { ...item, date: now };
  if (!it.id) { it.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); it.created = now; }
  const i = list.findIndex((m) => m.id === it.id);
  if (i >= 0) list[i] = { ...list[i], ...it }; else list.push(it);
  return store(list) ? it : null;
}
/** Keep the last supplier inputs without changing the item's date. */
export function saveMyDeal(id, deal) {
  const list = loadMy();
  const m = list.find((x) => x.id === id);
  if (!m) return;
  m.deal = JSON.parse(JSON.stringify(deal));
  store(list);
}
/** Keep my typed selling price ({ price, date } or null) without changing the item's date. */
export function saveMySell(id, sell) {
  const list = loadMy();
  const m = list.find((x) => x.id === id);
  if (!m) return;
  m.sell = sell;
  store(list);
}
export function deleteMy(id) { store(loadMy().filter((m) => m.id !== id)); }

export const newestFirst = (list) => list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));

/** Size in the base unit used by the calculator (l, kg, pc), or null. */
export function baseSize(m) {
  const v = Number(String(m.sizeVal ?? "").replace(",", "."));
  if (!(v > 0) || !m.sizeUnit) return null;
  if (m.sizeUnit === "ml") return { size: v / 1000, unit: "l" };
  if (m.sizeUnit === "g") return { size: v / 1000, unit: "kg" };
  return { size: v, unit: m.sizeUnit };
}

/** The item as a product-like object the calculator and cards understand. */
export function asProduct(m) {
  const price = Number(String(m.price ?? "").replace(",", "."));
  const bs = baseSize(m);
  const p = price > 0 ? price : null;
  return {
    barcode: "my:" + m.id, myId: m.id, mine: true, name: m.name || "–", status: "active", type: "", type_label: "",
    regular_price: p, regular_price_store: "my price (not Dazoge)", cheapest_now: p, cheapest_now_store: null,
    size: bs ? bs.size : null, unit: bs ? bs.unit : null,
    price_per_unit: p != null && bs ? p / bs.size : null, price_per_unit_now: null,
    link: m.link && /^https?:\/\//i.test(m.link.trim()) ? m.link.trim() : null,
    often_on_promo: false, stores: [], date: m.date, note: m.note || "",
  };
}

/** Search my products with the same rules as the main search. */
export function searchMy(q, aliasGroups) {
  const items = loadMy().map(asProduct);
  if (!items.length || !String(q || "").trim()) return [];
  return search(buildIndex(items, aliasGroups), q, "");
}
