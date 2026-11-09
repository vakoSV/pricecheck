// Compare by type: for brands not sold in Georgia. Market rows Cheapest / Typical / Big brands
// for the chosen type and size range, with my margin for each; tap a row for its products,
// tap a product to use it as the calculator reference.
import { S, deal, saveDeal, ppuOf } from "../state.js";
import * as C from "../calc.js";
import { esc, gel, pct, unitName, row, sizeText, srcLink } from "../ui.js";
import { inputsHTML, bindInputs, marginClass, mountCalc } from "../calcui.js";
import { findTypes } from "../search.js";
import { t, tn, typeName } from "../i18n.js";

const st = { type: "", open: "", ref: null, tq: "" };
const urlOf = () => "#/compare?t=" + st.type + (st.tq.trim() ? "&q=" + encodeURIComponent(st.tq.trim()) : "");

function market(type, unit, size) {
  const all = S.products.filter((p) => p.status === "active" && p.type === type && p.unit === unit && p.size &&
    ppuOf(p) != null && p.size >= 0.5 * size && p.size <= 2 * size).sort((a, b) => ppuOf(a) - ppuOf(b));
  const brands = all.filter((p) => p._brand);
  // Each row's number is one real product's price per unit (the middle one for "median"),
  // so every number can be checked on its dazoge.info page.
  const midOf = (a) => (a.length ? a[(a.length - 1) >> 1] : null);
  const mid = (all.length - 1) >> 1;
  // "Cheapest" = the product at the 10th percentile of price per unit (nearest rank), so one odd
  // product can't distort it. Its list shows the whole range, cheapest first.
  const p10 = all.length ? all[Math.max(0, Math.ceil(0.1 * all.length) - 1)] : null;
  const row = (key, label, src, items, note) => ({ key, label, src, ppu: src ? ppuOf(src) : null, items, note });
  return {
    all,
    rows: [
      row("cheapest", t("cmp.cheapest"), p10, all, t("cmp.cheapest_note")),
      row("typical", t("cmp.typical"), midOf(all), all.slice(Math.max(0, mid - 5), mid + 5), t("cmp.typical_note")),
      row("brands", t("cmp.brands"), midOf(brands), brands, tn("cmp.brands_note", brands.length)),
    ],
  };
}

export function render(view, params) {
  if (params.has("q")) {
    // opened from a search: put the search text in the type box and pick the best type
    st.tq = params.get("q");
    const best = findTypes(S.idx, st.tq, S.types, S.aliases)[0];
    if (!params.get("t") && best) st.type = best.id;
  }
  if (params.get("t")) st.type = params.get("t");
  if (!st.type || !S.types.find((t) => t.id === st.type)) st.type = S.types[0] ? S.types[0].id : "";
  const tinfo = () => S.types.find((t) => t.id === st.type) || { unit: "pc" };
  view.innerHTML = `
    <h1 class="h">${esc(t("cmp.title"))}</h1>
    <p class="hint">${esc(t("cmp.hint"))}</p>
    <div class="inputs">
      <label class="f wide"><span>${esc(t("cmp.find_type"))}</span>
        <div class="searchbar"><input id="tq" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="${esc(t("cmp.find_ph"))}" value="${esc(st.tq)}" aria-label="${esc(t("cmp.find_type"))}">
          <button type="button" class="clear" id="tqx" aria-label="${esc(t("common.clear"))}" ${st.tq ? "" : "hidden"}>✕</button></div></label>
      <div class="f wide typematch" id="tmatch"></div>
      <label class="f wide"><span>${esc(t("cmp.type"))}</span>
        <select id="ctype">${S.types.map((x) => `<option value="${x.id}" ${x.id === st.type ? "selected" : ""}>${esc(typeName(x.id, x.label))} (${x.count})</option>`).join("")}</select></label>
    </div>
    <div id="cin">${inputsHTML({ unit: tinfo().unit })}</div>
    <div id="cmk"></div>
    <div class="note warn">${esc(t("cmp.unknown_brand"))}</div>
    <div id="ccalc"></div>`;
  const cin = view.querySelector("#cin"), cmk = view.querySelector("#cmk"), ccalc = view.querySelector("#ccalc");
  let calc = null;

  const draw = () => {
    const ti = tinfo();
    const size = C.num(deal.packSize);
    if (!(size > 0)) { cmk.innerHTML = `<div class="note">${esc(t("cmp.need_size", { unit: unitName(ti.unit) }))}</div>`; return; }
    const m = market(st.type, ti.unit, size);
    const ev = C.evaluate(deal, { size: 1, regular_price: 1 }, S.settings, S.rates && S.rates.rates); // landed cost only
    const below = 1 - C.num(S.settings.below) / 100;
    cmk.innerHTML = `<h2>${esc(tn("cmp.market", m.all.length))} <small class="muted">${+(0.5 * size).toFixed(3)}–${+(2 * size).toFixed(3)} ${unitName(ti.unit)}</small></h2>
      ${ev.landed != null ? `<p class="hint">${t("cmp.landed", { price: `<b>${gel(ev.landed)}</b>` })}${deal.currency === "GEL" ? ` <span class="costnote">${esc(t("calc.costnote_gel", { pct: C.num(S.settings.local) }))}</span>` : ""}</p>` : `<p class="hint">${esc(t("cmp.need_price"))}</p>`}
      <div class="mrows">${m.rows.map((r) => {
        const pack = r.ppu != null ? r.ppu * size : null;
        const sell = pack != null ? pack * below : null;
        const mg = C.marginOf(sell, ev.landed);
        return `<div class="mrow ${st.open === r.key ? "open" : ""}" data-row="${r.key}">
          <button type="button" class="mhead" data-open="${r.key}" aria-expanded="${st.open === r.key}">
            <span class="ml"><b>${esc(r.label)}</b><small>${esc(r.note)}</small></span>
            <span class="mv"><small>${esc(t("cmp.per_unit", { unit: unitName(ti.unit) }))}</small><b>${gel(r.ppu)}</b></span>
            <span class="mv"><small>${esc(t("cmp.for_pack", { size: deal.packSize, unit: unitName(ti.unit) }))}</small><b>${gel(pack)}</b></span>
            <span class="mv"><small>${esc(t("cmp.my_margin"))}</small><b class="pm ${marginClass(mg)}">${pct(mg)}</b></span>
          </button>
          ${r.src ? `<div class="msrc"><span>${esc(t("cmp.from"))} ${esc(r.src.name)} · ${esc(sizeText(r.src))} · ${gel(r.src.regular_price ?? r.src.cheapest_now)}</span> ${srcLink(r.src)}</div>` : ""}
          ${st.open === r.key ? `<div class="list">${r.items.length ? r.items.map((p) => row(p, `${p === r.src ? `<span class="srcmark">${esc(t(r.key === "cheapest" ? "cmp.mark_p10" : "cmp.mark_row"))}</span>` : ""}<span class="use ${st.ref === p ? "on" : ""}">${esc(t(st.ref === p ? "common.reference" : "common.use"))}</span>`, `href="#" data-ref="${esc(p.barcode)}"`)).join("") : `<p class="muted">${esc(t("cmp.no_products"))}</p>`}</div>` : ""}
        </div>`;
      }).join("")}</div>`;
    if (calc) calc.update();
  };

  const drawCalc = () => {
    if (!st.ref) { ccalc.innerHTML = ""; calc = null; return; }
    ccalc.innerHTML = `<h2 id="cc">${esc(t("calc.title"))}</h2><div class="calc" id="ccb"></div>`;
    calc = mountCalc(ccalc.querySelector("#ccb"), {
      showInputs: false,
      getRef: () => st.ref,
      unit: tinfo().unit,
      header: (r) => `<div class="refcard"><span>${esc(t("calc.ref"))}</span> <a href="#/p/${esc(r.barcode)}?keep=1"><b>${esc(r.name)}</b></a> <span class="muted">${esc(sizeText(r))} · ${gel(r.regular_price ?? r.cheapest_now)}</span> ${srcLink(r)}</div>`,
      onClear: () => { cin.innerHTML = inputsHTML({ unit: tinfo().unit }); draw(); drawCalc(); },
    });
  };

  bindInputs(cin, draw);
  const tq = view.querySelector("#tq"), tqx = view.querySelector("#tqx"), tmatch = view.querySelector("#tmatch"), csel = view.querySelector("#ctype");
  const drawMatches = () => {
    const q = st.tq.trim();
    if (!q) { tmatch.innerHTML = ""; return; }
    const found = findTypes(S.idx, q, S.types, S.aliases).slice(0, 8);
    tmatch.innerHTML = found.length
      ? found.map((m) => {
        const ty = S.types.find((x) => x.id === m.id);
        return `<button type="button" class="tm ${m.id === st.type ? "on" : ""}" data-type="${m.id}">${esc(typeName(ty.id, ty.label))} <small>${ty.count}${m.via === "products" ? " · " + esc(tn("cmp.matching", m.hits)) : ""}</small></button>`;
      }).join("")
      : `<p class="muted small">${esc(t("cmp.no_type", { q: "“" + q + "”" }))}</p>`;
  };
  const setType = (id) => {
    st.type = id; st.open = ""; st.ref = null;
    csel.value = id;
    history.replaceState(null, "", urlOf());
    cin.innerHTML = inputsHTML({ unit: tinfo().unit });
    drawMatches();
    draw(); drawCalc();
  };
  tq.addEventListener("input", () => { st.tq = tq.value; tqx.hidden = !st.tq; drawMatches(); history.replaceState(null, "", urlOf()); });
  tq.addEventListener("keydown", (e) => { if (e.key === "Enter") { const b = tmatch.querySelector("[data-type]"); if (b) setType(b.dataset.type); tq.blur(); } });
  tqx.onclick = () => { st.tq = ""; tq.value = ""; tqx.hidden = true; drawMatches(); history.replaceState(null, "", urlOf()); tq.focus(); };
  tmatch.addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) setType(b.dataset.type); });
  csel.addEventListener("change", (e) => setType(e.target.value));
  cmk.addEventListener("click", (e) => {
    const o = e.target.closest("[data-open]");
    if (o) { st.open = st.open === o.dataset.open ? "" : o.dataset.open; draw(); return; }
    const a = e.target.closest("[data-ref]");
    if (a) {
      e.preventDefault();
      const p = S.byBarcode.get(a.dataset.ref);
      st.ref = st.ref === p ? null : p;
      draw(); drawCalc();
      if (st.ref) view.querySelector("#cc").scrollIntoView({ behavior: "smooth" });
    }
  });
  history.replaceState(null, "", urlOf());
  drawMatches();
  draw(); drawCalc();
  saveDeal();
}
