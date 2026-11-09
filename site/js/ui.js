// Small UI helpers: escaping, number/date formatting, product images, result cards.
import { S, ppuOf, shortLabel } from "./state.js";
import { SYMBOL } from "./calc.js";
import { t, typeName } from "./i18n.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const gel = (x, d = 2) => (x == null || !isFinite(x) ? "–" : x.toFixed(d) + " ₾");
export const signed = (x, d = 2) => (x == null || !isFinite(x) ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(d) + " ₾");
export const money = (x, cur, d = 2) => (x == null || !isFinite(x) ? "–" : (cur === "GEL" ? x.toFixed(d) + " ₾" : SYMBOL[cur] + x.toFixed(x < 0.1 ? 4 : d)));
export const pct = (m, d = 1) => (m == null || !isFinite(m) ? "–" : (m * 100).toFixed(d) + "%");
export const unitName = (u) => ({ l: t("unit.l"), kg: t("unit.kg"), pc: t("unit.pc") })[u] || u || "";

export function sizeText(p) {
  if (!p.size) return "";
  if (p.unit === "l") return p.size < 1 ? Math.round(p.size * 1000) + " " + t("unit.ml") : +p.size.toFixed(3) + " " + t("unit.l");
  if (p.unit === "kg") return p.size < 1 ? Math.round(p.size * 1000) + " " + t("unit.g") : +p.size.toFixed(3) + " " + t("unit.kg");
  return p.size + " " + t("unit.pc");
}

const TZ = "Asia/Tbilisi";
export function when(iso, withTime = true) {
  if (!iso) return t("common.never");
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  // "9 Nov, 16:48" (Tbilisi time); month names from the language files, so they don't depend on the
  // browser's own language data (some phones have none for Georgian)
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ })
    .formatToParts(d).map((x) => [x.type, x.value]));
  const date = +parts.day + " " + t("date.months").split(",")[+parts.month - 1];
  return withTime ? date + ", " + parts.hour + ":" + parts.minute : date;
}
export const day = (ymd) => (ymd ? when(ymd + "T12:00:00Z", false) : "");

// ── images: image_url → cdn …/[barcode].jpg → .webp → placeholder ──
const CDN = "https://cdn.dazoge.info/product-images/";
export const PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#8883"/><path d="M20 44l9-12 7 9 5-6 7 9z" fill="#8888"/><circle cx="26" cy="24" r="4" fill="#8888"/></svg>');
export function imgSources(p) {
  const list = [p.image_url, CDN + p.barcode + ".jpg", CDN + p.barcode + ".webp"].filter(Boolean);
  return [...new Set(list)];
}
export function img(p, cls = "thumb") {
  if (p.mine) return `<img class="${cls}" alt="" src="${PLACEHOLDER}">`; // my own prices have no picture
  const src = imgSources(p);
  return `<img class="${cls}" loading="lazy" decoding="async" alt="" src="${esc(src[0])}" data-alt="${esc(src.slice(1).join(" "))}">`;
}
// One capturing listener walks each failed image down its list of sources.
document.addEventListener("error", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLImageElement) || !el.dataset) return;
  const rest = (el.dataset.alt || "").split(" ").filter(Boolean);
  if (rest.length) { el.dataset.alt = rest.slice(1).join(" "); el.src = rest[0]; }
  else if (el.src !== PLACEHOLDER) { el.dataset.alt = ""; el.src = PLACEHOLDER; }
}, true);

/** Small link to the exact dazoge.info page a market number came from. */
export function srcLink(p, label = t("common.check_source")) {
  return p && p.link ? `<a class="src" href="${esc(p.link)}" target="_blank" rel="noopener" title="${esc(t(p.mine ? "common.check_source_mine_title" : "common.check_source_title"))}">${esc(label)} ↗</a>` : "";
}

export function badges(p) {
  let h = "";
  if (p.status !== "active") h += `<span class="badge gone">${esc(t("badge.not_listed"))}</span>`;
  if (p.promo_now) h += `<span class="badge promo">${esc(t("badge.promo"))}${p.discount_pct ? " −" + Math.round(p.discount_pct) + "%" : ""}</span>`;
  if (p.often_on_promo) h += `<span class="badge often">${esc(t("badge.often_promo"))}</span>`;
  return h;
}

export function changeText(c) {
  if (!c) return "";
  const d = c.new - c.old;
  const up = d > 0;
  return `<span class="chg ${up ? "up" : "down"}" title="${esc(t(c.field === "regular_price" ? "change.title_regular" : "change.title_cheapest"))}">${up ? "▲" : "▼"} ${Math.abs(d).toFixed(2)} ₾</span>`;
}

export function perUnitText(p) {
  const u = ppuOf(p);
  return u == null ? "" : `${u.toFixed(2)} ₾/${unitName(p.unit)}`;
}

/** Product card for the home grid (2 columns on a phone, 3 on desktop). */
export function card(p) {
  const reg = `<div class="pr"><span class="k">${esc(t("card.regular"))}</span> <b>${gel(p.regular_price)}</b></div>`;
  const now = p.cheapest_now != null
    ? `<div class="pr"><span class="k">${esc(t("card.now"))}</span> <b class="${p.promo_now ? "promo-t" : ""}">${gel(p.cheapest_now)}</b></div>` : "";
  return `<a class="card" href="#/p/${encodeURIComponent(p.barcode)}">
    <div class="cimg">${img(p, "thumb")}</div>
    <div class="cb">
      <div class="nm">${esc(p.name)}</div>
      <div class="meta">${esc(sizeText(p))}${p.size ? " · " : ""}${esc(typeName(p.type, shortLabel(p.type_label || "")))}</div>
      ${reg}${now}
      <div class="ft"><span class="ppu">${perUnitText(p)}</span>${changeText(S.changeBy.get(p.barcode))}${badges(p)}</div>
    </div>
  </a>`;
}

/** Compact one-line product row (lists inside other screens). */
export function row(p, extra = "", attrs = "") {
  return `<a class="row" ${attrs || `href="#/p/${encodeURIComponent(p.barcode)}"`}>
    ${img(p, "thumb sm")}
    <div class="rb"><div class="nm1">${esc(p.name)}</div><div class="meta">${esc(sizeText(p))} · ${perUnitText(p)} · ${gel(p.regular_price ?? p.cheapest_now)}${p._brand ? " · " + esc(p._brand) : ""}</div></div>
    ${extra}
  </a>`;
}
