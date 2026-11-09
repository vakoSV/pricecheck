// Interface language (English / Georgian). All wording lives in site/i18n/en.json and
// site/i18n/ka.json (same keys); this module only looks it up. Product names, shop names and other
// Dazoge data are never translated. The choice is kept on this phone (pc.lang.v1).
//   t("key", { name: value })  → the text, with {name} placeholders filled in
//   tn("key", n, vars)          → "key_one" when n is 1, else "key_other" ({n} is filled in)
const KEY = "pc.lang.v1";
export const LANGS = ["en", "ka"];

let base = {}; // English: also the fallback for a key missing in another language
let dict = {};
export let lang = "en";

async function get(l) {
  const r = await fetch("i18n/" + l + ".json");
  if (!r.ok) throw new Error("i18n/" + l + ".json: HTTP " + r.status);
  return r.json();
}

/** Load the saved language (default English). */
export async function loadLang() {
  let l = "en";
  try { l = localStorage.getItem(KEY) || "en"; } catch {}
  if (!LANGS.includes(l)) l = "en";
  base = await get("en");
  dict = base;
  if (l !== "en") { try { dict = await get(l); } catch (e) { console.warn(e); l = "en"; } }
  lang = l;
  document.documentElement.lang = l;
}

/** Switch language and remember it; returns once the new words are loaded. */
export async function setLang(l) {
  if (!LANGS.includes(l)) return;
  dict = l === "en" ? base : await get(l);
  lang = l;
  document.documentElement.lang = l;
  try { localStorage.setItem(KEY, l); } catch {}
}

export function t(key, vars) {
  let s = dict[key];
  if (s == null) s = base[key];
  if (s == null) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return s;
}
export const tn = (key, n, vars) => t(key + (n === 1 ? "_one" : "_other"), { n, ...vars });
/** True when the key exists (in the language or in English). */
export const has = (key) => dict[key] != null || base[key] != null;

/** Fill the fixed parts of index.html: data-i18n (text), data-i18n-html, data-i18n-aria, data-i18n-ph. */
export function applyStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll("[data-lang]").forEach((b) => { const on = b.dataset.lang === lang; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
}

/** Display name of a product type (our own classification, so it is translated). */
export const typeName = (id, fallback = "") => (has("type." + id) ? t("type." + id) : fallback || id);
