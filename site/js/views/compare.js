// Compare by type: for brands not sold in Georgia. Market rows Cheapest / Typical / Big brands
// for the chosen type and size range, with my margin for each; tap a row for its products,
// tap a product to use it as the calculator reference.
import { S, deal, saveDeal, ppuOf } from "../state.js";
import * as C from "../calc.js";
import { esc, gel, pct, unitName, row, sizeText } from "../ui.js";
import { inputsHTML, bindInputs, marginClass, mountCalc } from "../calcui.js";

const st = { type: "", open: "", ref: null };

function market(type, unit, size) {
  const all = S.products.filter((p) => p.status === "active" && p.type === type && p.unit === unit && p.size &&
    ppuOf(p) != null && p.size >= 0.5 * size && p.size <= 2 * size).sort((a, b) => ppuOf(a) - ppuOf(b));
  const brands = all.filter((p) => p._brand);
  const mid = all.length >> 1;
  return {
    all,
    rows: [
      { key: "cheapest", label: "Cheapest", ppu: all.length ? ppuOf(all[0]) : null, items: all.slice(0, 10), note: "lowest price per unit" },
      { key: "typical", label: "Typical", ppu: C.median(all.map(ppuOf)), items: all.slice(Math.max(0, mid - 5), mid + 5), note: "median" },
      { key: "brands", label: "Big brands", ppu: C.median(brands.map(ppuOf)), items: brands, note: brands.length + " product" + (brands.length === 1 ? "" : "s") + ", median" },
    ],
  };
}

export function render(view, params) {
  if (params.get("t")) st.type = params.get("t");
  if (!st.type || !S.types.find((t) => t.id === st.type)) st.type = S.types[0] ? S.types[0].id : "";
  const tinfo = () => S.types.find((t) => t.id === st.type) || { unit: "pc" };
  view.innerHTML = `
    <h1 class="h">Compare by type</h1>
    <p class="hint">For a brand that is not sold in Georgia: compare the supplier's price with what similar products sell for.</p>
    <div class="inputs">
      <label class="f wide"><span>Product type</span>
        <select id="ctype">${S.types.map((t) => `<option value="${t.id}" ${t.id === st.type ? "selected" : ""}>${esc(t.label)} (${t.count})</option>`).join("")}</select></label>
    </div>
    <div id="cin">${inputsHTML({ unit: tinfo().unit })}</div>
    <div id="cmk"></div>
    <div class="note warn">Unknown brand: buy a small amount first to test quality.</div>
    <div id="ccalc"></div>`;
  const cin = view.querySelector("#cin"), cmk = view.querySelector("#cmk"), ccalc = view.querySelector("#ccalc");
  let calc = null;

  const draw = () => {
    const t = tinfo();
    const size = C.num(deal.packSize);
    if (!(size > 0)) { cmk.innerHTML = `<div class="note">Enter the supplier pack size (${unitName(t.unit)}) to see the market.</div>`; return; }
    const m = market(st.type, t.unit, size);
    const ev = C.evaluate(deal, { size: 1, regular_price: 1 }, S.settings, S.rates && S.rates.rates); // landed cost only
    const below = 1 - C.num(S.settings.below) / 100;
    cmk.innerHTML = `<h2>Market: ${m.all.length} product${m.all.length === 1 ? "" : "s"} <small class="muted">${+(0.5 * size).toFixed(3)}–${+(2 * size).toFixed(3)} ${unitName(t.unit)}</small></h2>
      ${ev.landed != null ? `<p class="hint">Your landed cost: <b>${gel(ev.landed)}</b> per piece.</p>` : `<p class="hint">Enter the supplier price to see your margin.</p>`}
      <div class="mrows">${m.rows.map((r) => {
        const pack = r.ppu != null ? r.ppu * size : null;
        const sell = pack != null ? pack * below : null;
        const mg = C.marginOf(sell, ev.landed);
        return `<div class="mrow ${st.open === r.key ? "open" : ""}" data-row="${r.key}">
          <button type="button" class="mhead" data-open="${r.key}" aria-expanded="${st.open === r.key}">
            <span class="ml"><b>${r.label}</b><small>${esc(r.note)}</small></span>
            <span class="mv"><small>per ${unitName(t.unit)}</small><b>${gel(r.ppu)}</b></span>
            <span class="mv"><small>for ${esc(deal.packSize)} ${unitName(t.unit)}</small><b>${gel(pack)}</b></span>
            <span class="mv"><small>my margin</small><b class="pm ${marginClass(mg)}">${pct(mg)}</b></span>
          </button>
          ${st.open === r.key ? `<div class="list">${r.items.length ? r.items.map((p) => row(p, `<span class="use ${st.ref === p ? "on" : ""}">${st.ref === p ? "reference" : "use"}</span>`, `href="#" data-ref="${esc(p.barcode)}"`)).join("") : `<p class="muted">No products.</p>`}</div>` : ""}
        </div>`;
      }).join("")}</div>`;
    if (calc) calc.update();
  };

  const drawCalc = () => {
    if (!st.ref) { ccalc.innerHTML = ""; calc = null; return; }
    ccalc.innerHTML = `<h2 id="cc">Calculator</h2><div class="calc" id="ccb"></div>`;
    calc = mountCalc(ccalc.querySelector("#ccb"), {
      showInputs: false,
      getRef: () => st.ref,
      unit: tinfo().unit,
      header: (r) => `<div class="refcard"><span>Market reference:</span> <a href="#/p/${esc(r.barcode)}?keep=1"><b>${esc(r.name)}</b></a> <span class="muted">${esc(sizeText(r))} · ${gel(r.regular_price ?? r.cheapest_now)}</span></div>`,
      onClear: () => { cin.innerHTML = inputsHTML({ unit: tinfo().unit }); draw(); drawCalc(); },
    });
  };

  bindInputs(cin, draw);
  view.querySelector("#ctype").addEventListener("change", (e) => {
    st.type = e.target.value; st.open = ""; st.ref = null;
    history.replaceState(null, "", "#/compare?t=" + st.type);
    cin.innerHTML = inputsHTML({ unit: tinfo().unit });
    draw(); drawCalc();
  });
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
  history.replaceState(null, "", "#/compare?t=" + st.type);
  draw(); drawCalc();
  saveDeal();
}
