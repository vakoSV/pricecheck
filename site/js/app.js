// Boot, header line, hash router, offline cache registration.
import { S, loadAll, loadSettings } from "./state.js";
import { esc, when, day } from "./ui.js";
import * as home from "./views/home.js";
import * as product from "./views/product.js";
import * as compare from "./views/compare.js";
import * as changes from "./views/changes.js";
import * as settings from "./views/settings.js";

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
    return `${k} ${o ? `<b title="your rate">${o}*</b>` : (+v).toFixed(4)}`;
  }).join(" · ") : "no rates";
  info.innerHTML = `<span>Full ${esc(when(m.last_full_update))} · Quick ${esc(when(m.last_quick_update))}</span>
    <span>${rates}${r && r.valid_from ? ` <small>(NBG ${esc(day(r.valid_from))})</small>` : ""}</span>`;
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
  else home.render(view, params);
  if (!same) requestAnimationFrame(() => window.scrollTo(0, scrolls.get(key) || 0));
}

async function boot() {
  loadSettings();
  const msg = (t) => { view.innerHTML = `<div class="loading"><div class="spin"></div><p>${esc(t)}</p></div>`; };
  try {
    await loadAll(msg);
  } catch (e) {
    console.error(e);
    if (/meta\.json: HTTP 404/.test(e.message)) {
      view.innerHTML = `<div class="empty"><p>No price data has been published yet.</p><p class="muted">It appears after the first price update from the PC.</p></div>`;
      return;
    }
    view.innerHTML = `<div class="empty"><p class="err">Could not load the price data.</p><p class="muted">${esc(e.message)}</p>
      <p>${navigator.onLine ? "" : "You are offline and the data is not saved on this phone yet. "}Try again when the connection is better.</p>
      <button class="btn" onclick="location.reload()">Try again</button></div>`;
    return;
  }
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
boot();
