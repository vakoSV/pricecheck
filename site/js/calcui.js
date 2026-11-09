// Calculator UI: supplier inputs, margin result, offers / volume tiers, bundles.
// Used on the product page and on Compare by type.
import { S, deal, saveDeal, clearDeal, getShops, setShops } from "./state.js";
import * as C from "./calc.js";
import { esc, gel, signed, money, pct, unitName, srcLink, when } from "./ui.js";
import { t, tn } from "./i18n.js";

const PER = ["piece", "box", "pallet"]; // labels: per.<key> in the language files
const VERDICT_KEY = { "GOOD DEAL": "good", NEGOTIATE: "negotiate", AVOID: "avoid" }; // calc.js verdict → verdict.<key>
const piecesPerLabel = () => t(deal.per === "pallet" ? "calc.pcs_per_pallet" : "calc.pcs_per_box");
const perPc = () => "/" + t("unit.pc");

export function marginClass(m) {
  if (m == null) return "m-none";
  const v = m * 100;
  return v < C.num(S.settings.low) ? "m-red" : v < C.num(S.settings.high) ? "m-yellow" : "m-green";
}

/** Supplier price inputs (shared by the calculator and Compare by type). */
export function inputsHTML({ unit, packHint = "", showPack = true } = {}) {
  const per = deal.per || "piece";
  return `<div class="inputs">
    <label class="f wide"><span>${esc(t("calc.supplier_price"))}</span>
      <div class="pair"><input data-k="price" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(deal.price)}">
      <select data-k="currency">${C.SUPPLIER_CURRENCIES.map((c) => `<option ${c === deal.currency ? "selected" : ""}>${c}</option>`).join("")}</select></div></label>
    <div class="f wide"><span>${esc(t("calc.price_is_per"))}</span>
      <div class="seg" role="radiogroup">${PER.map((v) => `<button type="button" data-per="${v}" class="${v === per ? "on" : ""}" aria-pressed="${v === per}">${esc(t("per." + v))}</button>`).join("")}</div></div>
    <label class="f ${per === "piece" ? "hide" : ""}" data-show="pcs"><span>${esc(piecesPerLabel())}</span>
      <input data-k="pcsPer" inputmode="numeric" autocomplete="off" placeholder="${esc(t("calc.pcs_ph"))}" value="${esc(deal.pcsPer)}"></label>
    ${showPack ? `<label class="f"><span>${esc(t("calc.pack_size", { unit: unitName(unit) }))}</span>
      <input data-k="packSize" inputmode="decimal" autocomplete="off" value="${esc(deal.packSize)}"><small>${esc(packHint)}</small></label>` : ""}
    <div class="f"><span>${esc(t("calc.bundle"))} <small>${esc(t("common.optional"))}</small></span>
      <div class="pair"><input data-k="paid" inputmode="numeric" placeholder="10" value="${esc(deal.paid)}"><b>+</b><input data-k="free" inputmode="numeric" placeholder="1" value="${esc(deal.free)}"></div></div>
  </div>`;
}

/** Wire the inputs: every change updates `deal` and calls onChange (which re-renders results only). */
export function bindInputs(root, onChange, signal) {
  root.addEventListener("input", (e) => {
    const k = e.target.dataset && e.target.dataset.k;
    if (!k) return;
    deal[k] = e.target.value;
    saveDeal();
    onChange();
  }, { signal });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-per]");
    if (!b) return;
    deal.per = b.dataset.per;
    saveDeal();
    root.querySelectorAll("[data-per]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
    const pcs = root.querySelector('[data-show="pcs"]');
    if (pcs) {
      pcs.classList.toggle("hide", deal.per === "piece");
      pcs.querySelector("span").textContent = piecesPerLabel();
    }
    onChange();
  }, { signal });
}

const kindText = (k) => t("calc.kind_" + k); // regular / now / shopnow

/**
 * Shop chips (product pages): the shops selling the reference product, plus selected shops that
 * don't sell it (dimmed). With a selection the market price comes from those shops only.
 */
function shopsHTML(ref0, sv, sel) {
  const names = [...new Set((ref0 && ref0.stores || []).map((s) => s.store))];
  const extra = sel.filter((s) => !names.includes(s));
  if (!names.length && !extra.length) return "";
  const chip = (n, sold) => `<button type="button" class="chip ${sel.includes(n) ? "on" : ""} ${sold ? "" : "off"}" data-shop="${esc(n)}" aria-pressed="${sel.includes(n)}"${sold ? "" : ` title="${esc(t("shops.not_sold_title"))}"`}>${esc(n)}${sold ? "" : ` <small>${esc(t("shops.not_sold"))}</small>`}</button>`;
  let h = `<div class="shophead"><b>${esc(t("shops.title"))}</b> <small class="muted">${esc(t(sel.length ? "shops.only_selected" : "shops.none_selected"))}</small></div>
    <div class="chips">${names.map((n) => chip(n, true)).join("")}${extra.map((n) => chip(n, false)).join("")}${sel.length ? `<button type="button" class="chip clear" data-shopclear>✕ ${esc(t("shops.clear"))}</button>` : ""}</div>`;
  if (sv.active) {
    const r = sv.reg, n = sv.now;
    const price = r ? t(r.current ? "shops.market_current" : "shops.market_regular", { price: `<b>${gel(r.price)}</b>`, shop: esc(r.store) }) : esc(t("shops.no_price"));
    const now = n && (!r || n.store !== r.store || n.price !== r.price) ? " · " + t("shops.now_at", { price: gel(n.price), shop: esc(n.store) }) : "";
    h += `<div class="shopmk">${t("shops.market", { price })}${now} ${srcLink(ref0)}</div>`;
  } else if (sv.none) {
    h += `<div class="shopmk warn">${esc(t("shops.none_sell"))}</div>`;
  }
  return h;
}

/** How the market − X% selling price was worked out: "market 10.00 ₾ − 15%" (+ pack scaling, source). */
function marketSellNote(ev, ref) {
  if (!ev.market) return "";
  const below = C.num(S.settings.below);
  const txt = ev.marketScaled && ev.marketScaled.scaled
    ? esc(t("sell.note_scaled", { price: gel(ev.market.price), size: +ref.size.toFixed(3), unit: unitName(ref.unit), scaled: gel(ev.marketScaled.price), pack: deal.packSize, below }))
    : esc(t("sell.note", { price: gel(ev.market.price), below }));
  const kind = kindText(ev.market.kind);
  const src = ref.mine ? `${esc(t("my.badge_lc"))} ${srcLink(ref)}`
    : `${esc(ev.market.store ? t("sell.src_at", { kind, shop: ev.market.store }) : kind)}${ref._shopSel ? " " + esc(t("shops.your_selection")) : ""} ${srcLink(ref)}`;
  return `${txt}<br><span class="muted">${src}</span>`;
}

/** The selling price box: note under the price, and the reset link when I typed my own. */
function sellBoxUpdate(box, ev, ref, saved) {
  const below = C.num(S.settings.below);
  const note = box.querySelector("[data-sellnote]"), reset = box.querySelector("[data-sellreset]");
  box.classList.toggle("mine", ev.sellIsMine);
  reset.hidden = !ev.sellIsMine || ev.marketSell == null;
  reset.textContent = t("sell.reset", { below });
  if (ev.sellIsMine) {
    const when_ = saved && saved.date ? (saved.temp ? t("sell.not_saved_compare") : saved.pending ? t("sell.saved_on_save") : t("sell.saved", { date: when(saved.date) })) : "";
    note.innerHTML = `<b>${esc(t("sell.your_price"))}</b>${when_ ? " · " + esc(when_) : ""}${ev.marketSell != null ? `<br><span class="muted">${esc(t("sell.would_be", { below, price: gel(ev.marketSell) }))}</span>` : ""}`;
  } else if (ev.market) note.innerHTML = marketSellNote(ev, ref);
  else note.innerHTML = esc(t("sell.no_market"));
}

/** Lowest selling price that still gives the margin levels from Settings. */
function floorsHTML(ev) {
  if (ev.landed == null) return "";
  const s = S.settings;
  return `<div class="line sm"><span>${esc(t("sell.floor_low", { pct: C.num(s.low) }))}</span><b>${gel(ev.minLow)}</b></div>
    <div class="line sm"><span>${esc(t("sell.floor_high", { pct: C.num(s.high) }))}</span><b>${gel(ev.minHigh)}</b></div>`;
}

const missingText = (ev) => ev.ppp == null ? (C.num(deal.price) == null ? t("calc.need_price") : t(deal.per === "pallet" ? "calc.need_pcs_pallet" : "calc.need_pcs_box"))
  : !ev.rate ? t("calc.need_rate", { cur: deal.currency }) : "";

/** The margin box, shown big next to the selling price. */
function marginHTML(ev) {
  const missing = missingText(ev);
  return `<div class="margin ${marginClass(ev.margin)}"><div class="big">${ev.margin == null ? "–" : pct(ev.margin)}</div><div class="lbl">${esc(t("calc.margin"))}${missing ? " · " + esc(missing) : ""}</div></div>`;
}

/** The rest of the results: profit, landed cost, promo margin, suggestion. */
export function resultsHTML(ev, ref) {
  const s = S.settings;
  const cur = deal.currency;
  if (!ref) return `<div class="note">${esc(t("calc.pick_ref"))}</div>`;
  const n = C.piecesPerUnit(deal) || 1, bf = C.bundleFactor(deal);
  const quoted = (pp) => (pp == null ? "–" : money(pp, cur) + perPc() + (deal.per !== "piece" || bf !== 1 ? " " + esc(t(bf !== 1 ? "calc.quoted_bundle" : "calc.quoted", { price: money((pp * n) / bf, cur), per: t("per_word." + deal.per), bundle: deal.paid + "+" + deal.free })) : ""));
  let h = "";
  if (cur === "GEL") h += `<div class="costnote">${esc(t("calc.costnote_gel", { pct: C.num(s.local) }))}</div>`;
  h += `<div class="line"><span>${esc(t(ev.profit != null && ev.profit < 0 ? "calc.loss_pc" : "calc.profit_pc"))}</span><b class="${ev.profit < 0 ? "neg" : ""}">${signed(ev.profit)}</b></div>`;
  h += `<div class="line sm"><span>${esc(t("calc.landed"))}</span><b>${gel(ev.landed)}</b></div>`;
  if (ev.ppp != null && ev.rate) h += cur === "GEL"
    ? `<div class="expl">${esc(t("calc.expl_gel", { price: money(ev.ppp, cur) + perPc(), pct: C.num(s.local) }))}</div>`
    : `<div class="expl">${esc(t("calc.expl_import", { price: money(ev.ppp, cur) + perPc(), rate: ev.rate.toFixed(4), vat: C.num(s.vat), freight: C.num(s.freight) }))}</div>`;
  if (ev.promo) {
    h += `<div class="promo-box"><div class="line"><span>${esc(t("calc.promo_intro", { price: gel(ev.promo.sell) }))}${ev.promo.store ? " (" + esc(ev.promo.store) + ")" : ""} ${srcLink(ref)}</span></div>
      <div class="line"><span>${esc(t("calc.margin"))}</span><b class="pm ${marginClass(ev.promo.margin)}">${pct(ev.promo.margin)}</b></div>
      <div class="line"><span>${esc(t("calc.promo_profit"))}</span><b>${signed(ev.promo.profit)}</b></div></div>`;
  }
  const good = `<div>${t("calc.good_at", { pct: C.num(s.high), price: `<b>${quoted(ev.goodPrice)}</b>` })}</div>`;
  const walk = `<div>${t("calc.walk_above", { pct: C.num(s.low), price: `<b>${quoted(ev.walkPrice)}</b>` })}</div>`;
  if (ev.verdict) {
    h += `<div class="verdict v-${ev.verdict.replace(" ", "-").toLowerCase()}"><div><span class="k">${esc(t("calc.suggestion"))}</span> <b>${esc(t("verdict." + VERDICT_KEY[ev.verdict]))}</b> <small>${esc(t("calc.hint_only"))}</small></div>
      ${good}${walk}</div>`;
  } else if (ev.goodPrice != null) {
    h += `<div class="verdict">${good}${walk}</div>`;
  }
  return h;
}

/** Offers / volume tiers. Row 1 is the main price above; more rows are "N pieces for price". */
function offersRowsHTML() {
  const cur = deal.currency;
  const n = C.piecesPerUnit(deal);
  const main = C.num(deal.price) != null ? esc(tn("offers.main_qty", n, { n: n || "?", price: money(C.num(deal.price), cur) })) + (C.bundleFactor(deal) !== 1 ? " " + esc(t("offers.plus_bundle", { bundle: deal.paid + "+" + deal.free })) : "") : esc(t("offers.enter_price"));
  let h = `<div class="offer" data-i="0"><div class="oh"><b>#1</b> <span>${esc(t("offers.main"))} ${main}</span></div><div class="oo" data-out="0"></div></div>`;
  (deal.offers || []).forEach((o, j) => {
    const i = j + 1;
    h += `<div class="offer" data-i="${i}"><div class="oh"><b>#${i + 1}</b>
      <input data-o="pcs" data-j="${j}" inputmode="numeric" placeholder="${esc(t("offers.pcs_ph"))}" value="${esc(o.pcs)}" aria-label="${esc(t("offers.pcs_aria"))}"><span>${esc(t("offers.pcs_for"))}</span>
      <input data-o="price" data-j="${j}" inputmode="decimal" placeholder="${esc(t("offers.price_ph"))}" value="${esc(o.price)}" aria-label="${esc(t("offers.price_aria"))}"><span>${cur}</span>
      <button type="button" class="x" data-del="${j}" aria-label="${esc(t("offers.remove"))}">✕</button></div><div class="oo" data-out="${i}"></div></div>`;
  });
  return h;
}

function offersOut(root, ev) {
  const n = C.piecesPerUnit(deal);
  // Row 1: one quoted unit; with a bundle the free pieces come on top (cash = what is paid).
  const rows = [{ ppp: ev.ppp, pcs: n ? n / C.bundleFactor(deal) : null }, ...(deal.offers || []).map((o) => ({ pcs: o.pcs, price: o.price }))];
  const r = C.evaluateOffers(rows, ev.sell, ev.rate, S.settings, deal.monthly, deal.currency);
  const cur = deal.currency;
  r.rows.forEach((o, i) => {
    const el = root.querySelector(`[data-out="${i}"]`);
    if (!el) return;
    el.parentElement.classList.toggle("best", i === r.best && r.rows.length > 1);
    if (o.ppp == null) { el.innerHTML = `<span class="muted">${i ? esc(t("offers.enter_row")) : ""}</span>`; return; }
    el.innerHTML = `<div class="og">
      <span><small>${esc(t("offers.price_pc"))}</small><b>${money(o.ppp, cur)}</b></span>
      <span><small>${esc(t("offers.landed_pc"))}</small><b>${gel(o.landed)}</b></span>
      <span><small>${esc(t("calc.margin"))}</small><b class="${marginClass(o.margin)} pm">${pct(o.margin)}</b></span>
      <span><small>${esc(t("offers.profit_pc"))}</small><b>${signed(o.profit)}</b></span>
      <span><small>${esc(t("offers.cash"))}</small><b>${o.cash != null ? gel(o.cash, 0) : "–"}</b></span>
      ${o.months != null ? `<span><small>${esc(t("offers.to_sell"))}</small><b>${esc(t("offers.months", { n: o.months < 10 ? o.months.toFixed(1) : Math.round(o.months) }))}</b></span>` : ""}
      ${i > 0 && o.savePerPiece != null ? `<span class="wide"><small>${esc(t("offers.vs_first"))}</small><b class="${o.savePerPiece >= 0 ? "pos" : "neg"}">${esc(t(o.savePerPiece >= 0 ? "offers.saves" : "offers.costs", { pc: gel(Math.abs(o.savePerPiece)) + perPc(), total: gel(Math.abs(o.saveTotal), 0) }))}</b></span>` : ""}
      ${i === r.best && r.rows.length > 1 ? `<span class="wide tag-best">${esc(t("offers.best"))}</span>` : ""}
    </div>`;
  });
}

// Selling prices typed where nothing is saved (Compare by type): kept until the page is reloaded.
const memSell = new Map();
const MEM_SELL = {
  key: (ref) => (ref ? ref.barcode : null),
  get: (k) => memSell.get(k) || null,
  set: (k, price) => { const v = price > 0 ? { price, date: new Date().toISOString(), temp: true } : null; if (v) memSell.set(k, v); else memSell.delete(k); return v; },
};

/**
 * Mount the full calculator into `el`.
 * opts: { getRef(): product, unit, packHint, header(ref) → html, showInputs,
 *         sellStore: { key(ref), get(key) → {price, date}|null, set(key, price|null) } where my typed
 *         selling price is kept (default: memory only) }
 */
export function mountCalc(el, opts) {
  const showInputs = opts.showInputs !== false;
  const store = opts.sellStore || MEM_SELL;
  // mounting again into the same element (clear, a new size…) drops the previous listeners
  if (el._calcAbort) el._calcAbort.abort();
  const ac = (el._calcAbort = new AbortController());
  const signal = ac.signal;
  el.innerHTML = `
    <div class="refbar" data-ref></div>
    ${showInputs ? inputsHTML({ unit: opts.unit, packHint: opts.packHint, showPack: opts.showPack !== false }) : ""}
    ${opts.shops ? `<div class="shops" data-shops></div>` : ""}
    <div class="sellgrid">
      <div class="sellbox" data-sellbox>
        <label><span class="k">${esc(t("sell.title"))}</span>
          <span class="sellin"><input data-sell inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="${esc(t("sell.aria"))}"><b>₾</b></span></label>
        <div class="expl" data-sellnote></div>
        <button type="button" class="linkbtn" data-sellreset hidden></button>
      </div>
      <div data-margin></div>
    </div>
    <div class="floors" data-floors></div>
    <div class="results" data-res></div>
    <h3>${esc(t("offers.title"))}</h3>
    <p class="hint">${esc(t("offers.hint"))}</p>
    <div class="offers" data-offers>${offersRowsHTML()}</div>
    <div class="row2"><button type="button" class="btn" data-add>+ ${esc(t("offers.add"))}</button>
      <label class="f inline"><span>${esc(t("offers.monthly"))}</span><input data-k="monthly" inputmode="numeric" placeholder="${esc(t("offers.pcs_ph"))}" value="${esc(deal.monthly)}"></label></div>
    <div class="row2"><button type="button" class="btn ghost" data-clear>${esc(t("calc.clear"))}</button></div>`;
  const resEl = el.querySelector("[data-res]");
  const offEl = el.querySelector("[data-offers]");
  const refEl = el.querySelector("[data-ref]");
  const sellBox = el.querySelector("[data-sellbox]"), sellIn = el.querySelector("[data-sell]");
  const marginEl = el.querySelector("[data-margin]"), floorsEl = el.querySelector("[data-floors]");
  let sellKey, saved = null; // my typed selling price for the current key: { price, date } or null
  const update = (tidySell) => {
    const ref0 = opts.getRef();
    // product pages: the market price from my selected shops only (none selected = all shops)
    let ref = ref0;
    if (shopsEl) { const sel = getShops(), sv = C.shopView(ref0, sel); ref = sv.ref; shopsEl.innerHTML = shopsHTML(ref0, sv, sel); }
    sellKey = store.key(ref0);
    saved = store.get(sellKey);
    refEl.innerHTML = opts.header ? opts.header(ref0) : "";
    const ev = C.evaluate(deal, ref, S.settings, S.rates && S.rates.rates, saved ? saved.price : null);
    // don't rewrite the price while it is being typed
    if (tidySell === true || document.activeElement !== sellIn) sellIn.value = ev.sell != null ? ev.sell.toFixed(2) : "";
    sellBoxUpdate(sellBox, ev, ref, saved);
    marginEl.innerHTML = marginHTML(ev);
    floorsEl.innerHTML = floorsHTML(ev);
    resEl.innerHTML = resultsHTML(ev, ref);
    // main row text depends on inputs
    const head = offEl.querySelector('[data-i="0"] .oh span');
    if (head) { const tmp = document.createElement("div"); tmp.innerHTML = offersRowsHTML(); head.innerHTML = tmp.querySelector('[data-i="0"] .oh span').innerHTML; }
    offersOut(offEl, ev);
  };
  // my own selling price: typing replaces market − X%; an empty field goes back to the market price
  sellIn.addEventListener("input", () => {
    const raw = sellIn.value.trim();
    if (!raw) saved = store.set(sellKey, null);
    else { const v = C.num(raw); if (!(v > 0)) return; saved = store.set(sellKey, Math.round(v * 100) / 100); }
    update();
  }, { signal });
  sellIn.addEventListener("blur", () => update(true), { signal }); // tidy the number when leaving the field
  const shopsEl = el.querySelector("[data-shops]");
  if (shopsEl) shopsEl.addEventListener("click", (e) => {
    const c = e.target.closest("[data-shop]");
    if (e.target.closest("[data-shopclear]")) setShops([]);
    else if (c) { const n = c.dataset.shop, sel = getShops(); setShops(sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n]); }
    else return;
    update();
  }, { signal });
  sellBox.querySelector("[data-sellreset]").addEventListener("click", () => { saved = store.set(sellKey, null); update(); }, { signal });
  if (showInputs) bindInputs(el, update, signal);
  else el.addEventListener("input", (e) => { if (e.target.dataset.k) { deal[e.target.dataset.k] = e.target.value; saveDeal(); update(); } }, { signal });
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
  }, { signal });
  update();
  return { update };
}
