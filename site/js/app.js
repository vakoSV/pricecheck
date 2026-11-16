// Boot, header line, hash router, offline cache registration.
import { S, loadAll, loadSettings } from "./state.js";
import { esc, when, day, toast, syncHearts } from "./ui.js";
import * as home from "./views/home.js";
import * as product from "./views/product.js";
import * as compare from "./views/compare.js";
import * as changes from "./views/changes.js";
import * as settings from "./views/settings.js";
import * as my from "./views/my.js";
import * as installPage from "./views/install.js";
import * as buylistPage from "./views/buylist.js";
import * as buy from "./buylist.js";
import { initInstall, syncInstallButtons } from "./install.js";
import { t, loadLang, setLang, applyStatic } from "./i18n.js";

const view = document.getElementById("view");
const info = document.getElementById("info");
const scrolls = new Map();
let current = "";

function header() {
  const m = S.meta;
  const r = S.rates;
  const ov = S.settings.rates;
  const rates = r && r.rates ? Object.entries(r.rates).map(([k, v]) => {
    const o = ov[k];
    return `${k} ${o ? `<b title="${esc(t("app.your_rate"))}">${o}*</b>` : (+v).toFixed(4)}`;
  }).join(" · ") : esc(t("app.no_rates"));
  info.innerHTML = `<span>${esc(t("app.updated", { full: when(m.last_full_update), quick: when(m.last_quick_update) }))}</span>
    <span>${rates}${r && r.valid_from ? ` <small>(${esc(t("app.nbg_of", { date: day(r.valid_from) }))})</small>` : ""}</span>`;
}

function route() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  const params = new URLSearchParams(qs || "");
  if (current) scrolls.set(current, window.scrollY);
  const key = path;
  const same = key === current;
  current = key;
  document.querySelectorAll("nav.tabs-bottom a").forEach((a) => {
    const t = a.dataset.tab;
    a.classList.toggle("on", t === "home" ? path === "/" || path.startsWith("/p/") : path.startsWith("/" + t));
  });
  header();
  if (path.startsWith("/p/")) product.render(view, params, decodeURIComponent(path.slice(3)));
  else if (path === "/compare") compare.render(view, params);
  else if (path === "/changes") changes.render(view, params);
  else if (path === "/settings") settings.render(view, params);
  else if (path === "/install") installPage.render(view, params);
  else if (path === "/buy") buylistPage.render(view, params);
  else if (path === "/my" || path.startsWith("/my/")) my.render(view, params, decodeURIComponent(path.slice(4)));
  else home.render(view, params);
  view.classList.toggle("wide", path === "/" || path === "/buy");
  document.documentElement.classList.toggle("on-install", path === "/install"); // its own QR code is on the page
  if (!same) requestAnimationFrame(() => window.scrollTo(0, scrolls.get(key) || 0));
}

let loaded = false;

// ── Buy list: hearts, the count on the menu, Undo, sync messages ──
function updateBadge() {
  const el = document.getElementById("buycount");
  if (!el) return;
  const n = buy.count();
  el.textContent = n > 999 ? "999+" : String(n);
  el.hidden = !n;
}
// a heart never opens the card it sits on (capture phase: no other handler sees the tap)
document.addEventListener("click", (e) => {
  const h = e.target.closest("[data-heart]");
  if (!h) return;
  e.preventDefault();
  e.stopPropagation();
  const id = h.dataset.heart;
  const before = buy.addedOf(id);
  const r = buy.toggle(id);
  if (!r.ok) { toast(t("buy.need_token"), { ms: 5000 }); return; }
  if (!r.saved && current === "/buy") {
    toast(t("buy.removed"), { action: t("buy.undo"), ms: 5000, onAction: () => { if (!buy.isSaved(id)) buy.toggle(id, { added: before }); } });
  }
}, true);
buy.onChange((why, d) => {
  syncHearts();
  updateBadge();
  if (why === "error") toast(t("buy.err." + d.kind, { status: d.status }), { ms: 6000 });
  if (loaded && current === "/buy" && why !== "busy") buylistPage.render(view, new URLSearchParams(location.hash.split("?")[1] || ""));
});

// EN / ქა switch: new words for the fixed parts, the header line and the current screen
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-lang]");
  if (!b) return;
  await setLang(b.dataset.lang);
  applyStatic();
  syncInstallButtons();
  if (loaded) { header(); route(); }
});

async function boot() {
  loadSettings();
  try { await loadLang(); } catch (e) { console.warn(e); }
  applyStatic();
  buy.load(); // in parallel with the price data; hearts update when it arrives
  const msg = (text) => { view.innerHTML = `<div class="loading"><div class="spin"></div><p>${esc(text)}</p></div>`; };
  msg(t("app.loading"));
  try {
    await loadAll(msg);
  } catch (e) {
    console.error(e);
    if (/meta\.json: HTTP 404/.test(e.message)) {
      view.innerHTML = `<div class="empty"><p>${esc(t("app.no_data"))}</p><p class="muted">${esc(t("app.no_data_hint"))}</p></div>`;
      return;
    }
    view.innerHTML = `<div class="empty"><p class="err">${esc(t("app.load_error"))}</p><p class="muted">${esc(e.message)}</p>
      <p>${navigator.onLine ? "" : esc(t("app.offline_no_data")) + " "}${esc(t("app.try_later"))}</p>
      <button class="btn" onclick="location.reload()">${esc(t("app.try_again"))}</button></div>`;
    return;
  }
  loaded = true;
  window.addEventListener("hashchange", route);
  window.addEventListener("settings-changed", header);
  route();
  // When the phone comes back to this tab, check for a newer update and offer a reload.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    if (!buy.status().pending && !buy.status().busy) buy.load(); // changes made on the other device
    try {
      const m = await (await fetch("data/meta.json", { cache: "no-store" })).json();
      if (m.run_id !== S.meta.run_id) document.getElementById("newdata").hidden = false;
    } catch {}
  });
}

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost") && !/[?&]nosw\b/.test(location.search)) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("service worker:", e));
}
initInstall();
boot();
