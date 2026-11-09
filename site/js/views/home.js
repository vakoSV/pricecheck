// Home: search box, type chips, result cards.
import { S, ppuOf } from "../state.js";
import { search, guessType } from "../search.js";
import { esc, card } from "../ui.js";

const PAGE = 40;
const st = { q: "", type: "", shown: PAGE };

export function render(view, params) {
  if (params.has("q")) st.q = params.get("q");
  if (params.has("t")) st.type = params.get("t");
  view.innerHTML = `
    <div class="searchbar">
      <input id="q" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="Search: Persil, ფეირი, toilet paper…" value="${esc(st.q)}" aria-label="Search products">
      <button type="button" class="clear" id="qx" aria-label="Clear search" ${st.q ? "" : "hidden"}>✕</button>
    </div>
    <div class="chips" id="chips">
      <button type="button" data-t="" class="${st.type ? "" : "on"}">All</button>
      ${S.types.map((t) => `<button type="button" data-t="${t.id}" class="${st.type === t.id ? "on" : ""}">${esc(t.label)} <small>${t.count}</small></button>`).join("")}
    </div>
    <div id="res"></div>`;
  const q = view.querySelector("#q"), qx = view.querySelector("#qx"), res = view.querySelector("#res"), chips = view.querySelector("#chips");
  let timer = 0;
  const run = () => {
    const t0 = performance.now();
    let all = st.q.trim() || st.type ? search(S.idx, st.q, st.type) : null;
    // A type without a query: active first, cheapest per unit first.
    if (all && !st.q.trim()) all = all.slice().sort((a, b) => (a.status !== "active") - (b.status !== "active") || (ppuOf(a) ?? 1e9) - (ppuOf(b) ?? 1e9));
    const ms = Math.round(performance.now() - t0);
    const url = "#/" + (st.q || st.type ? "?" + new URLSearchParams({ ...(st.q ? { q: st.q } : {}), ...(st.type ? { t: st.type } : {}) }) : "");
    history.replaceState(null, "", url);
    if (!all) {
      res.innerHTML = `<div class="empty"><p>Search in Latin or Georgian. Typos are fine.</p>
        <p class="muted">Or pick a product type above. Brand not sold in Georgia? <a href="#/compare">Compare by type →</a></p></div>`;
      return;
    }
    const gt = st.type || guessType(st.q, S.aliases) || "";
    const cmp = `<a class="cmp-link" href="#/compare${gt ? "?t=" + gt : ""}">Compare by type →</a>`;
    if (!all.length) {
      res.innerHTML = `<div class="empty"><p>No product matches “${esc(st.q)}”${st.type ? " in this type" : ""}.</p>
        <p>Brand not sold in Georgia? Compare the supplier's price with the market for the product type.</p>
        <a class="btn" href="#/compare${gt ? "?t=" + gt : ""}">Compare by type</a></div>`;
      return;
    }
    res.innerHTML = `<div class="count"><span>${all.length} product${all.length === 1 ? "" : "s"}${st.q && st.type ? "" : ""} <small class="muted">${ms} ms</small></span>${cmp}</div>
      <div class="cards">${all.slice(0, st.shown).map(card).join("")}</div>
      ${all.length > st.shown ? `<button type="button" class="btn more" id="more">Show more (${all.length - st.shown} left)</button>` : ""}`;
    const more = res.querySelector("#more");
    if (more) more.onclick = () => { st.shown += PAGE * 2; run(); };
  };
  q.addEventListener("input", () => {
    st.q = q.value;
    st.shown = PAGE;
    qx.hidden = !st.q;
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") q.blur(); });
  qx.onclick = () => { st.q = ""; q.value = ""; qx.hidden = true; st.shown = PAGE; run(); q.focus(); };
  chips.addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]");
    if (!b) return;
    st.type = st.type === b.dataset.t ? "" : b.dataset.t;
    st.shown = PAGE;
    chips.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x.dataset.t === st.type));
    run();
  });
  run();
  // keep the selected chip visible
  const on = chips.querySelector(".on");
  if (on && on.dataset.t) on.scrollIntoView({ inline: "center", block: "nearest" });
}
