// My products: market prices entered by hand for products that are not on Dazoge.
//   #/my              list, newest first, with edit and delete
//   #/my/new?name=…   form + calculator (name pre-filled from the search)
//   #/my/<id>         the same form for a saved product (edit), + calculator
import { deal, saveDeal } from "../state.js";
import { esc, gel, when, sizeText, perUnitText, srcLink } from "../ui.js";
import { mountCalc } from "../calcui.js";
import { loadMy, getMy, saveMy, saveMyDeal, deleteMy, newestFirst, asProduct, baseSize, SIZE_UNITS } from "../my.js";

const DEAL_KEYS = ["price", "currency", "per", "pcsPer", "packSize", "paid", "free", "offers", "monthly"];

export function render(view, params, sub) {
  if (!sub) return renderList(view);
  if (sub === "new") return renderForm(view, null, params.get("name") || "");
  const m = getMy(sub);
  if (!m) {
    view.innerHTML = `<div class="empty"><p>This saved product is not on this phone any more.</p><a class="btn" href="#/my">My products</a></div>`;
    return;
  }
  renderForm(view, m, "");
}

function renderList(view) {
  const list = newestFirst(loadMy());
  view.innerHTML = `
    <h1 class="h">My products</h1>
    <p class="hint">Market prices you entered yourself for products that are not on Dazoge. Saved on this phone only.</p>
    <a class="btn" href="#/my/new">+ Enter a market price</a>
    <div class="list mylist">${list.length ? list.map((m) => {
      const p = asProduct(m);
      return `<div class="row myrow">
        <a class="rb" href="#/my/${esc(m.id)}">
          <div class="nm1">${esc(p.name)}</div>
          <div class="meta">${gel(p.regular_price)}${p.size ? " · " + esc(sizeText(p)) + " · " + perUnitText(p) : ""} · ${esc(when(m.date))}</div>
          ${m.note ? `<div class="meta">${esc(m.note)}</div>` : ""}
        </a>
        <span class="acts"><a class="btn sm ghost" href="#/my/${esc(m.id)}">Edit</a><button type="button" class="btn sm ghost danger" data-del="${esc(m.id)}">Delete</button></span>
      </div>`;
    }).join("") : `<p class="muted">Nothing saved yet. When a search finds nothing on Dazoge, tap “Enter market price myself”.</p>`}</div>`;
  view.querySelector(".mylist").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    const m = getMy(b.dataset.del);
    if (m && confirm(`Delete “${m.name}” from this phone?`)) { deleteMy(m.id); renderList(view); }
  });
}

function renderForm(view, saved, prefillName) {
  // the item being edited (not stored until "Save")
  const it = saved ? { ...saved } : { name: prefillName, price: "", sizeVal: "", sizeUnit: "", link: "", note: "" };
  let id = saved ? saved.id : null;
  if (saved && saved.deal) { for (const k of DEAL_KEYS) if (k in saved.deal) deal[k] = saved.deal[k]; saveDeal(); }
  const bs0 = baseSize(it);
  if (bs0 && !(saved && saved.deal)) { deal.packSize = String(+bs0.size.toFixed(4)); saveDeal(); }

  view.innerHTML = `
    <div class="topbar"><a class="back" href="#/my">‹ My products</a></div>
    <h1 class="h">${saved ? "My product" : "Enter market price"}</h1>
    <p class="hint">For a product that is not on Dazoge: the shelf price you found in a shop or online.</p>
    <div class="calc myform">
      <div class="inputs">
        <label class="f wide"><span>Product name</span><input data-m="name" autocomplete="off" value="${esc(it.name)}"></label>
        <label class="f"><span>Market shelf price (GEL)</span><input data-m="price" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(it.price)}"></label>
        <div class="f"><span>Size <small>(optional, for price per unit)</small></span>
          <div class="pair"><input data-m="sizeVal" inputmode="decimal" autocomplete="off" placeholder="e.g. 500" value="${esc(it.sizeVal)}">
          <select data-m="sizeUnit"><option value="">unit</option>${SIZE_UNITS.map((u) => `<option ${u === it.sizeUnit ? "selected" : ""}>${u}</option>`).join("")}</select></div></div>
        <label class="f wide"><span>Source link <small>(optional, e.g. the shop page)</small></span><input data-m="link" type="url" inputmode="url" autocomplete="off" placeholder="https://…" value="${esc(it.link)}"></label>
        <label class="f wide"><span>Note <small>(optional)</small></span><input data-m="note" autocomplete="off" value="${esc(it.note)}"></label>
      </div>
      <div class="row2"><button type="button" class="btn" id="msave">${saved ? "Save changes" : "Save on this phone"}</button>
        ${saved ? `<button type="button" class="btn ghost danger" id="mdel">Delete</button>` : ""}
        <span id="mstat" class="muted">${saved ? "Saved " + esc(when(saved.date)) : "Not saved yet"}</span></div>
      <div class="mysrc" id="msrc"></div>
    </div>
    <h2>Calculator</h2>
    <div id="mcalc" class="calc"></div>`;

  const ref = () => asProduct(it);
  const stat = view.querySelector("#mstat"), srcEl = view.querySelector("#msrc"), calcEl = view.querySelector("#mcalc");
  let calc = null, unit = undefined;
  const drawSrc = () => {
    const p = ref();
    srcEl.innerHTML = `<span class="badge mine">My price (not Dazoge)</span> ${p.price_per_unit != null ? `<span class="muted">${perUnitText(p)}</span>` : ""} ${srcLink(p)}`;
  };
  const mount = () => {
    const p = ref();
    unit = p.unit;
    calc = mountCalc(calcEl, {
      getRef: ref,
      unit: p.unit || "pc",
      showPack: !!p.unit,
      packHint: p.size ? "Market product: " + sizeText(p) : "",
      header: (r) => `<div class="refcard"><span>Market reference:</span> <b>${esc(r.name)}</b> <span class="muted">${r.size ? esc(sizeText(r)) + " · " : ""}${gel(r.regular_price)}</span> <span class="badge mine">My price (not Dazoge)</span> ${srcLink(r)}</div>`,
      onClear: () => mount(),
    });
  };
  const keepDeal = () => { if (id) saveMyDeal(id, deal); };
  // the last supplier inputs are kept with the saved product
  calcEl.addEventListener("input", () => setTimeout(keepDeal, 0));
  calcEl.addEventListener("click", () => setTimeout(keepDeal, 0));

  view.querySelector(".myform").addEventListener("input", (e) => {
    const k = e.target.dataset.m;
    if (!k) return;
    it[k] = e.target.value;
    if (id) stat.textContent = "Changed, not saved";
    drawSrc();
    if (k === "sizeVal" || k === "sizeUnit") {
      const bs = baseSize(it);
      if (bs) { deal.packSize = String(+bs.size.toFixed(4)); saveDeal(); }
      if ((bs ? bs.unit : null) !== unit || bs) { mount(); return; }
    }
    calc.update();
  });
  view.querySelector("#msave").onclick = () => {
    if (!String(it.name || "").trim()) { stat.textContent = "Enter a product name."; return; }
    const out = saveMy({ ...it, id: id || undefined, deal: JSON.parse(JSON.stringify(deal)) });
    if (!out) { stat.textContent = "Could not save on this phone (storage full or blocked)."; return; }
    id = out.id; it.id = out.id;
    stat.textContent = "Saved " + when(out.date);
    view.querySelector("#msave").textContent = "Save changes";
    history.replaceState(null, "", "#/my/" + id);
  };
  const del = view.querySelector("#mdel");
  if (del) del.onclick = () => { if (confirm(`Delete “${it.name}” from this phone?`)) { deleteMy(id); location.hash = "#/my"; } };
  drawSrc();
  mount();
}
