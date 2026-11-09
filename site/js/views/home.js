// Home: search box, category dropdown, sort, product grid with page numbers.
// With no search text it lists every product of the chosen category, so the page is never empty.
import { S, ppuOf } from "../state.js";
import { search, guessType } from "../search.js";
import { esc, card, gel, when, sizeText, perUnitText, img } from "../ui.js";
import { searchMy } from "../my.js";

/**
 * What to do when the product is not on Dazoge: compare by type, search online, enter the
 * market price myself. Big when the search found nothing, compact under every result list.
 */
function noMatchHTML(q, typeHint, big, where = "") {
  const qs = encodeURIComponent(q.trim());
  const cmp = `#/compare?q=${qs}${typeHint ? "&t=" + encodeURIComponent(typeHint) : ""}`;
  const google = "https://www.google.com/search?q=" + encodeURIComponent(q.trim() + " ფასი");
  const btns = `<div class="nm-btns">
      <a class="btn" href="${cmp}">Compare by type</a>
      <a class="btn ghost" href="${esc(google)}" target="_blank" rel="noopener">Search online ↗</a>
      <a class="btn ghost" href="#/my/new?name=${qs}">Enter market price myself</a>
    </div>`;
  return big
    ? `<div class="nomatch big"><p><b>No Dazoge product matches “${esc(q.trim())}”${where}.</b></p>
        <p class="muted">Not sold in Georgia's big shops? Compare with the product type, look up the price online, or enter a shelf price you found.</p>${btns}</div>`
    : `<div class="nomatch"><p class="muted">Not the right product?</p>${btns}</div>`;
}

/** Card for one of my saved prices (opens its own page with the calculator). */
function myCard(p) {
  return `<a class="card mycard" href="#/my/${encodeURIComponent(p.myId)}">
    <div class="cimg">${img(p, "thumb")}</div>
    <div class="cb">
      <div class="nm">${esc(p.name)}</div>
      <div class="ft"><span class="badge mine">My price (not Dazoge)</span></div>
      <div class="meta">${esc(when(p.date, false))}${p.size ? " · " + esc(sizeText(p)) : ""}</div>
      <div class="pr"><span class="k">Shelf</span> <b>${gel(p.regular_price)}</b></div>
      <div class="ft"><span class="ppu">${perUnitText(p)}</span></div>
    </div>
  </a>`;
}

const PER_PAGE = 20;
const SORTS = [
  ["relevance", "Relevance"],
  ["name", "Name"],
  ["price", "Regular price: low–high"],
  ["ppu", "Price per unit: low–high"],
  ["change", "Biggest price change"],
];
// cat: "" = all, "s:<section id>" = a section, otherwise a type id. sort: "" = default for the situation.
const st = { q: "", cat: "", sort: "", page: 1 };

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const n = (x) => x.toLocaleString("en-US");

let nameRank = null; // barcode -> position in name order (computed once per data load)
function rankByName() {
  if (nameRank && nameRank.src === S.products) return nameRank.map;
  const col = new Intl.Collator(["ka", "en"], { sensitivity: "base", numeric: true });
  // sort by the first letter: leading "/", quotes and numbers ("557 …", "/ხელსახოცი …") are skipped
  const key = (p) => p.name.replace(/^[^\p{L}]+/u, "") || p.name;
  const order = S.products.map((p) => [key(p), p]).sort((a, b) => col.compare(a[0], b[0])).map((x) => x[1]);
  nameRank = { src: S.products, map: new Map(order.map((p, i) => [p.barcode, i])) };
  return nameRank.map;
}

/** Relative size of the latest price change: since the last update, else the last regular-price change. */
function changeSize(p) {
  const c = S.changeBy.get(p.barcode);
  if (c && c.old > 0) return Math.abs(c.new - c.old) / c.old;
  const l = p.last_change;
  if (l && l.old_regular_price > 0 && l.new_regular_price != null) return Math.abs(l.new_regular_price - l.old_regular_price) / l.old_regular_price;
  return null;
}

function inCategory(cat) {
  if (!cat) return () => true;
  if (cat.startsWith("s:")) {
    const s = S.sections.find((x) => "s:" + x.id === cat);
    const set = new Set(s ? s.types.map((t) => t.id) : []);
    return (p) => set.has(p.type);
  }
  return (p) => p.type === cat;
}

function validCat(cat) {
  if (!cat) return true;
  if (cat.startsWith("s:")) return S.sections.some((x) => "s:" + x.id === cat);
  return S.allTypes.some((t) => t.id === cat);
}

function effectiveSort() {
  const s = st.sort || (st.q.trim() ? "relevance" : "name");
  return s === "relevance" && !st.q.trim() ? "name" : s;
}

function sortList(list, how) {
  if (how === "relevance") return list; // search() already ranks best first
  const rank = rankByName();
  const byName = (a, b) => rank.get(a.barcode) - rank.get(b.barcode);
  const listed = (a, b) => (a.status !== "active") - (b.status !== "active");
  const nullsLast = (f, dir = 1) => (a, b) => {
    const x = f(a), y = f(b);
    if (x == null || y == null) return (x == null) - (y == null);
    return dir * (x - y);
  };
  const key = {
    name: () => 0,
    price: nullsLast((p) => p.regular_price ?? p.cheapest_now),
    ppu: nullsLast(ppuOf),
    change: nullsLast(changeSize, -1),
  }[how] || (() => 0);
  return list.slice().sort((a, b) => listed(a, b) || key(a, b) || byName(a, b));
}

/** Page buttons: 1 … 4 5 6 … 239 (one neighbour each side on a phone, two on desktop). */
function pager(page, pages) {
  if (pages <= 1) return "";
  const w = matchMedia("(max-width: 559px)").matches ? 1 : 2;
  const nums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= w) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const b = (p, label, attrs = "") => `<button type="button" data-page="${p}" ${attrs}>${label}</button>`;
  return `<nav class="pager" aria-label="Pages">
    ${b(page - 1, "‹", `class="pn" aria-label="Previous page" ${page <= 1 ? "disabled" : ""}`)}
    ${nums.map((x) => (x === "…" ? `<span class="gap">…</span>` : b(x, x, x === page ? `class="on" aria-current="page"` : `aria-label="Page ${x}"`))).join("")}
    ${b(page + 1, "›", `class="pn" aria-label="Next page" ${page >= pages ? "disabled" : ""}`)}
  </nav>`;
}

function catOptions() {
  const total = S.products.length;
  const opt = (v, label) => `<option value="${esc(v)}" ${st.cat === v ? "selected" : ""}>${esc(label)}</option>`;
  return opt("", `All products (${n(total)})`) + S.sections.map((s) =>
    `<optgroup label="${esc(s.label)} (${n(s.total)})">
      ${opt("s:" + s.id, `All ${s.label.toLowerCase()} (${n(s.total)})`)}
      ${s.types.map((t) => opt(t.id, `${cap(t.label)} (${n(t.total)})`)).join("")}
    </optgroup>`).join("");
}

export function render(view, params) {
  if (params.has("q")) st.q = params.get("q");
  if (params.has("c")) st.cat = params.get("c");
  else if (params.has("t")) st.cat = params.get("t"); // older links
  if (params.has("s")) st.sort = params.get("s");
  if (params.has("p")) st.page = Math.max(1, parseInt(params.get("p"), 10) || 1);
  if (!validCat(st.cat)) st.cat = "";
  if (st.sort && !SORTS.some(([k]) => k === st.sort)) st.sort = "";

  view.innerHTML = `
    <div class="searchbar">
      <input id="q" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="Search: Persil, ფეირი, toilet paper…" value="${esc(st.q)}" aria-label="Search products">
      <button type="button" class="clear" id="qx" aria-label="Clear search" ${st.q ? "" : "hidden"}>✕</button>
    </div>
    <label class="catsel"><span>Category</span>
      <select id="cat" aria-label="Category">${catOptions()}</select>
    </label>
    <div id="res"></div>`;
  const q = view.querySelector("#q"), qx = view.querySelector("#qx"), res = view.querySelector("#res"), cat = view.querySelector("#cat");
  let timer = 0;

  const run = () => {
    const query = st.q.trim();
    const filter = inCategory(st.cat);
    let list = query ? search(S.idx, query, "").filter(filter) : S.products.filter(filter);
    const how = effectiveSort();
    list = sortList(list, how);
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (st.page > pages) st.page = pages;

    const ps = new URLSearchParams();
    if (st.q) ps.set("q", st.q);
    if (st.cat) ps.set("c", st.cat);
    if (st.sort) ps.set("s", st.sort);
    if (st.page > 1) ps.set("p", st.page);
    history.replaceState(null, "", "#/" + (ps.toString() ? "?" + ps : ""));

    const typeHint = (!st.cat.startsWith("s:") && st.cat) || guessType(st.q, S.aliases) || "";
    // my own saved prices (not Dazoge) that match the search, shown first on page 1
    const mine = query ? searchMy(query, S.aliases) : [];
    const mineHTML = mine.length && st.page === 1
      ? `<h2 class="mine-h">My prices <small class="muted">entered by me, not Dazoge</small></h2><div class="grid">${mine.map(myCard).join("")}</div>` : "";
    if (!list.length) {
      res.innerHTML = mineHTML + noMatchHTML(st.q, typeHint, true, st.cat ? " in this category" : "");
      return;
    }
    const from = (st.page - 1) * PER_PAGE;
    const sortSel = `<select id="sort" class="sortsel" aria-label="Sort">
      ${SORTS.filter(([k]) => k !== "relevance" || query).map(([k, l]) => `<option value="${k}" ${k === how ? "selected" : ""}>${l}</option>`).join("")}
    </select>`;
    res.innerHTML = mineHTML + `<div class="count">
        <span><b>${n(list.length)}</b> product${list.length === 1 ? "" : "s"}${mine.length ? " on Dazoge" : ""}</span>
        ${sortSel}
      </div>
      <div class="grid">${list.slice(from, from + PER_PAGE).map(card).join("")}</div>
      ${pager(st.page, pages)}
      ${query ? noMatchHTML(st.q, typeHint, false) : ""}`;
    res.querySelector("#sort").onchange = (e) => { st.sort = e.target.value; st.page = 1; run(); };
  };

  res.addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (!b || b.disabled) return;
    st.page = +b.dataset.page;
    run();
    window.scrollTo({ top: 0 });
  });
  q.addEventListener("input", () => {
    // starting or clearing a search goes back to the default sort (relevance / name)
    if (!st.q.trim() !== !q.value.trim()) st.sort = "";
    st.q = q.value;
    st.page = 1;
    qx.hidden = !st.q;
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") q.blur(); });
  qx.onclick = () => { st.q = ""; q.value = ""; st.sort = ""; qx.hidden = true; st.page = 1; run(); q.focus(); };
  cat.addEventListener("change", () => { st.cat = cat.value; st.page = 1; run(); });
  run();
}
