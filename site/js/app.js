// Boot, header line, hash router, offline cache registration.
import { S, loadAll, loadSettings } from "./state.js";
import { esc, when, day } from "./ui.js";
import * as home from "./views/home.js";
import * as product from "./views/product.js";
import * as compare from "./views/compare.js";
import * as changes from "./views/changes.js";
import * as settings from "./views/settings.js";
import * as my from "./views/my.js";
import * as installPage from "./views/install.js";
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
  else if (path === "/my" || path.startsWith("/my/")) my.render(view, params, decodeURIComponent(path.slice(4)));
  else home.render(view, params);
  view.classList.toggle("wide", path === "/");
  document.documentElement.classList.toggle("on-install", path === "/install"); // its own QR code is on the page
  if (!same) requestAnimationFrame(() => window.scrollTo(0, scrolls.get(key) || 0));
}

let loaded = false;

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
