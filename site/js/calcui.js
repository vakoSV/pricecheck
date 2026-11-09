// Calculator UI: supplier inputs, margin result, offers / volume tiers, bundles.
// Used on the product page and on Compare by type.
import { S, deal, saveDeal, clearDeal } from "./state.js";
import * as C from "./calc.js";
import { esc, gel, signed, money, pct, unitName } from "./ui.js";

const PER = [["piece", "piece"], ["box", "box"], ["pallet", "pallet"]];

export function marginClass(m) {
  if (m == null) return "m-none";
  const v = m * 100;
  return v < C.num(S.settings.low) ? "m-red" : v < C.num(S.settings.high) ? "m-yellow" : "m-green";
}

/** Supplier price inputs (shared by the calculator and Compare by type). */
export function inputsHTML({ unit, packHint = "", showPack = true } = {}) {
  const per = deal.per || "piece";
  return `<div class="inputs">
    <label class="f wide"><span>Supplier price</span>
      <div class="pair"><input data-k="price" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(deal.price)}">
      <select data-k="currency">${C.CURRENCIES.map((c) => `<option ${c === deal.currency ? "selected" : ""}>${c}</option>`).join("")}</select></div></label>
    <div class="f wide"><span>Price is per</span>
      <div class="seg" role="radiogroup">${PER.map(([v, l]) => `<button type="button" data-per="${v}" class="${v === per ? "on" : ""}" aria-pressed="${v === per}">${l}</button>`).join("")}</div></div>
    <label class="f ${per === "piece" ? "hide" : ""}" data-show="pcs"><span>Pieces per ${per === "pallet" ? "pallet" : "box"}</span>
      <input data-k="pcsPer" inputmode="numeric" autocomplete="off" placeholder="e.g. 12" value="${esc(deal.pcsPer)}"></label>
    ${showPack ? `<label class="f"><span>Supplier pack size (${unitName(unit)})</span>
      <input data-k="packSize" inputmode="decimal" autocomplete="off" value="${esc(deal.packSize)}"><small>${esc(packHint)}</small></label>` : ""}
    <div class="f"><span>Bundle: paid + free <small>(optional)</small></span>
      <div class="pair"><input data-k="paid" inputmode="numeric" placeholder="10" value="${esc(deal.paid)}"><b>+</b><input data-k="free" inputmode="numeric" placeholder="1" value="${esc(deal.free)}"></div></div>
  </div>`;
}

/** Wire the inputs: every change updates `deal` and calls onChange (which re-renders results only). */
export function bindInputs(root, onChange) {
  root.addEventListener("input", (e) => {
    const k = e.target.dataset && e.target.dataset.k;
    if (!k) return;
    deal[k] = e.target.value;
    saveDeal();
    onChange();
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-per]");
    if (!b) return;
    deal.per = b.dataset.per;
    saveDeal();
    root.querySelectorAll("[data-per]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
    const pcs = root.querySelector('[data-show="pcs"]');
    if (pcs) {
      pcs.classList.toggle("hide", deal.per === "piece");
      pcs.querySelector("span").textContent = "Pieces per " + (deal.per === "pallet" ? "pallet" : "box");
    }
    onChange();
  });
}

/** Explanation of where the sell price comes from. */
function sellNote(ev, ref) {
  if (!ev.market) return "";
  const s = S.settings;
  let t = `market ${ev.market.kind === "regular" ? "regular" : "current (no regular price yet)"} ${gel(ev.market.price)}${ev.market.store ? " at " + esc(ev.market.store) : ""}`;
  if (ev.marketScaled && ev.marketScaled.scaled) t += `, scaled ${+ref.size.toFixed(3)} → ${esc(deal.packSize)} ${unitName(ref.unit)} = ${gel(ev.marketScaled.price)}`;
  return t + ` − ${C.num(s.below)}%`;
}

/** The result block: margin first and big, then profit, promo margin, suggestion. */
export function resultsHTML(ev, ref) {
  const s = S.settings;
  const cur = deal.currency;
  if (!ref) return `<div class="note">Pick a market reference product.</div>`;
  if (!ev.market) return `<div class="note">This product has no market price, so no margin can be calculated. Pick a similar product below as the reference.</div>`;
  const missing = ev.ppp == null ? (C.num(deal.price) == null ? "Enter the supplier price." : "Enter the pieces per " + (deal.per === "pallet" ? "pallet" : "box") + ".")
    : !ev.rate ? `No exchange rate for ${cur}. Set one in Settings.` : "";
  const n = C.piecesPerUnit(deal) || 1, bf = C.bundleFactor(deal);
  const quoted = (pp) => (pp == null ? "–" : money(pp, cur) + "/pc" + (deal.per !== "piece" || bf !== 1 ? ` (= ${money((pp * n) / bf, cur)} per ${deal.per}${bf !== 1 ? `, with the ${esc(deal.paid)}+${esc(deal.free)} bundle` : ""})` : ""));
  let h = `<div class="margin ${marginClass(ev.margin)}"><div class="big">${ev.margin == null ? "–" : pct(ev.margin)}</div><div class="lbl">margin${missing ? " · " + esc(missing) : ""}</div></div>`;
  h += `<div class="line"><span>${ev.profit != null && ev.profit < 0 ? "Loss" : "Profit"} per piece</span><b class="${ev.profit < 0 ? "neg" : ""}">${signed(ev.profit)}</b></div>`;
  h += `<div class="line sm"><span>Sell price</span><b>${gel(ev.sell)}</b></div><div class="expl">${sellNote(ev, ref)}</div>`;
  h += `<div class="line sm"><span>Landed cost</span><b>${gel(ev.landed)}</b></div>`;
  if (ev.ppp != null && ev.rate) h += `<div class="expl">${money(ev.ppp, cur)}/pc × ${ev.rate.toFixed(4)} × VAT ${C.num(s.vat)}% × freight ${C.num(s.freight)}%</div>`;
  if (ev.promo) {
    h += `<div class="promo-box"><div class="line"><span>Often on promo. At the cheapest promo price ${gel(ev.promo.sell)}${ev.promo.store ? " (" + esc(ev.promo.store) + ")" : ""}</span></div>
      <div class="line"><span>margin</span><b class="pm ${marginClass(ev.promo.margin)}">${pct(ev.promo.margin)}</b></div>
      <div class="line"><span>profit per piece</span><b>${signed(ev.promo.profit)}</b></div></div>`;
  }
  if (ev.verdict) {
    h += `<div class="verdict v-${ev.verdict.replace(" ", "-").toLowerCase()}"><div><span class="k">Suggestion</span> <b>${ev.verdict}</b> <small>(hint only)</small></div>
      <div>Good deal (${C.num(s.high)}%) at ≤ <b>${quoted(ev.goodPrice)}</b></div>
      <div>Walk away (${C.num(s.low)}%) above <b>${quoted(ev.walkPrice)}</b></div></div>`;
  } else if (ev.goodPrice != null) {
    h += `<div class="verdict"><div>Good deal (${C.num(s.high)}%) at ≤ <b>${quoted(ev.goodPrice)}</b></div><div>Walk away (${C.num(s.low)}%) above <b>${quoted(ev.walkPrice)}</b></div></div>`;
  }
  return h;
}

/** Offers / volume tiers. Row 1 is the main price above; more rows are "N pieces for price". */
function offersRowsHTML() {
  const cur = deal.currency;
  const n = C.piecesPerUnit(deal);
  const main = C.num(deal.price) != null ? `${n || "?"} pc${n === 1 ? "" : "s"} for ${money(C.num(deal.price), cur)}${C.bundleFactor(deal) !== 1 ? ` + bundle ${esc(deal.paid)}+${esc(deal.free)}` : ""}` : "enter the supplier price above";
  let h = `<div class="offer" data-i="0"><div class="oh"><b>#1</b> <span>Main price: ${main}</span></div><div class="oo" data-out="0"></div></div>`;
  (deal.offers || []).forEach((o, j) => {
    const i = j + 1;
    h += `<div class="offer" data-i="${i}"><div class="oh"><b>#${i + 1}</b>
      <input data-o="pcs" data-j="${j}" inputmode="numeric" placeholder="pcs" value="${esc(o.pcs)}" aria-label="pieces"><span>pcs for</span>
      <input data-o="price" data-j="${j}" inputmode="decimal" placeholder="price" value="${esc(o.price)}" aria-label="price"><span>${cur}</span>
      <button type="button" class="x" data-del="${j}" aria-label="remove offer">✕</button></div><div class="oo" data-out="${i}"></div></div>`;
  });
  return h;
}

function offersOut(root, ev) {
  const n = C.piecesPerUnit(deal);
  // Row 1: one quoted unit; with a bundle the free pieces come on top (cash = what is paid).
  const rows = [{ ppp: ev.ppp, pcs: n ? n / C.bundleFactor(deal) : null }, ...(deal.offers || []).map((o) => ({ pcs: o.pcs, price: o.price }))];
  const r = C.evaluateOffers(rows, ev.sell, ev.rate, S.settings, deal.monthly);
  const cur = deal.currency;
  r.rows.forEach((o, i) => {
    const el = root.querySelector(`[data-out="${i}"]`);
    if (!el) return;
    el.parentElement.classList.toggle("best", i === r.best && r.rows.length > 1);
    if (o.ppp == null) { el.innerHTML = `<span class="muted">${i ? "enter pieces and price" : ""}</span>`; return; }
    el.innerHTML = `<div class="og">
      <span><small>price/pc</small><b>${money(o.ppp, cur)}</b></span>
      <span><small>landed/pc</small><b>${gel(o.landed)}</b></span>
      <span><small>margin</small><b class="${marginClass(o.margin)} pm">${pct(o.margin)}</b></span>
      <span><small>profit/pc</small><b>${signed(o.profit)}</b></span>
      <span><small>cash needed</small><b>${o.cash != null ? gel(o.cash, 0) : "–"}</b></span>
      ${o.months != null ? `<span><small>to sell</small><b>${o.months < 10 ? o.months.toFixed(1) : Math.round(o.months)} mo</b></span>` : ""}
      ${i > 0 && o.savePerPiece != null ? `<span class="wide"><small>vs #1</small><b class="${o.savePerPiece >= 0 ? "pos" : "neg"}">${o.savePerPiece >= 0 ? "saves" : "costs"} ${gel(Math.abs(o.savePerPiece))}/pc · ${gel(Math.abs(o.saveTotal), 0)} total</b></span>` : ""}
      ${i === r.best && r.rows.length > 1 ? `<span class="wide tag-best">best price per piece</span>` : ""}
    </div>`;
  });
}

/**
 * Mount the full calculator into `el`.
 * opts: { getRef(): product, unit, packHint, header(ref) → html, showInputs }
 */
export function mountCalc(el, opts) {
  const showInputs = opts.showInputs !== false;
  el.innerHTML = `
    <div class="refbar" data-ref></div>
    ${showInputs ? inputsHTML({ unit: opts.unit, packHint: opts.packHint }) : ""}
    <div class="results" data-res></div>
    <h3>Offers / volume tiers</h3>
    <p class="hint">Add the supplier's other prices, e.g. "100 pcs for 160" or "300 pcs for 450". Free goods: count them in the pieces.</p>
    <div class="offers" data-offers>${offersRowsHTML()}</div>
    <div class="row2"><button type="button" class="btn" data-add>+ Add offer</button>
      <label class="f inline"><span>My monthly sales</span><input data-k="monthly" inputmode="numeric" placeholder="pcs" value="${esc(deal.monthly)}"></label></div>
    <div class="row2"><button type="button" class="btn ghost" data-clear>Clear supplier inputs</button></div>`;
  const resEl = el.querySelector("[data-res]");
  const offEl = el.querySelector("[data-offers]");
  const refEl = el.querySelector("[data-ref]");
  const update = () => {
    const ref = opts.getRef();
    refEl.innerHTML = opts.header ? opts.header(ref) : "";
    const ev = C.evaluate(deal, ref, S.settings, S.rates && S.rates.rates);
    resEl.innerHTML = resultsHTML(ev, ref);
    // main row text depends on inputs
    const head = offEl.querySelector('[data-i="0"] .oh span');
    if (head) { const tmp = document.createElement("div"); tmp.innerHTML = offersRowsHTML(); head.innerHTML = tmp.querySelector('[data-i="0"] .oh span').innerHTML; }
    offersOut(offEl, ev);
  };
  if (showInputs) bindInputs(el, update);
  else el.addEventListener("input", (e) => { if (e.target.dataset.k) { deal[e.target.dataset.k] = e.target.value; saveDeal(); update(); } });
  offEl.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.dataset.o) return;
    deal.offers[+t.dataset.j][t.dataset.o] = t.value;
    saveDeal();
    update();
  });
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-add]")) {
      deal.offers = deal.offers || [];
      deal.offers.push({ pcs: "", price: "" });
      saveDeal();
      offEl.innerHTML = offersRowsHTML();
      update();
      const ins = offEl.querySelectorAll('[data-o="pcs"]');
      if (ins.length) ins[ins.length - 1].focus();
    } else if (e.target.closest("[data-del]")) {
      deal.offers.splice(+e.target.closest("[data-del]").dataset.del, 1);
      saveDeal();
      offEl.innerHTML = offersRowsHTML();
      update();
    } else if (e.target.closest("[data-clear]")) {
      const keepPack = deal.packSize;
      clearDeal();
      deal.packSize = keepPack;
      saveDeal();
      if (opts.onClear) opts.onClear(); else mountCalc(el, opts);
    }
  });
  update();
  return { update };
}
