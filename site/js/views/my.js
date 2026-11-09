// My products: market prices entered by hand for products that are not on Dazoge.
//   #/my              list, newest first, with edit and delete
//   #/my/new?name=…   form + calculator (name pre-filled from the search)
//   #/my/<id>         the same form for a saved product (edit), + calculator
import { deal, saveDeal } from "../state.js";
import { esc, gel, when, sizeText, perUnitText, srcLink } from "../ui.js";
import { mountCalc } from "../calcui.js";
import { t } from "../i18n.js";
import { loadMy, getMy, saveMy, saveMyDeal, saveMySell, deleteMy, newestFirst, asProduct, baseSize, SIZE_UNITS } from "../my.js";

const DEAL_KEYS = ["price", "currency", "per", "pcsPer", "packSize", "paid", "free", "offers", "monthly"];

export function render(view, params, sub) {
  if (!sub) return renderList(view);
  if (sub === "new") return renderForm(view, null, params.get("name") || "");
  const m = getMy(sub);
  if (!m) {
    view.innerHTML = `<div class="empty"><p>${esc(t("my.gone"))}</p><a class="btn" href="#/my">${esc(t("my.title"))}</a></div>`;
    return;
  }
  renderForm(view, m, "");
}

function renderList(view) {
  const list = newestFirst(loadMy());
  view.innerHTML = `
    <h1 class="h">${esc(t("my.title"))}</h1>
    <p class="hint">${esc(t("my.hint"))}</p>
    <a class="btn" href="#/my/new">+ ${esc(t("my.add"))}</a>
    <div class="list mylist">${list.length ? list.map((m) => {
      const p = asProduct(m);
      return `<div class="row myrow">
        <a class="rb" href="#/my/${esc(m.id)}">
          <div class="nm1">${esc(p.name)}</div>
          <div class="meta">${gel(p.regular_price)}${p.size ? " · " + esc(sizeText(p)) + " · " + perUnitText(p) : ""} · ${esc(when(m.date))}</div>
          ${m.note ? `<div class="meta">${esc(m.note)}</div>` : ""}
        </a>
        <span class="acts"><a class="btn sm ghost" href="#/my/${esc(m.id)}">${esc(t("common.edit"))}</a><button type="button" class="btn sm ghost danger" data-del="${esc(m.id)}">${esc(t("common.delete"))}</button></span>
      </div>`;
    }).join("") : `<p class="muted">${esc(t("my.empty"))}</p>`}</div>`;
  view.querySelector(".mylist").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    const m = getMy(b.dataset.del);
    if (m && confirm(t("my.confirm_delete", { name: m.name }))) { deleteMy(m.id); renderList(view); }
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
    <div class="topbar"><a class="back" href="#/my">‹ ${esc(t("my.title"))}</a></div>
    <h1 class="h">${esc(t(saved ? "my.edit_title" : "my.new_title"))}</h1>
    <p class="hint">${esc(t("my.form_hint"))}</p>
    <div class="calc myform">
      <div class="inputs">
        <label class="f wide"><span>${esc(t("my.name"))}</span><input data-m="name" autocomplete="off" value="${esc(it.name)}"></label>
        <label class="f"><span>${esc(t("my.price"))}</span><input data-m="price" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(it.price)}"></label>
        <div class="f"><span>${esc(t("my.size"))} <small>${esc(t("my.size_hint"))}</small></span>
          <div class="pair"><input data-m="sizeVal" inputmode="decimal" autocomplete="off" placeholder="${esc(t("my.size_ph"))}" value="${esc(it.sizeVal)}">
          <select data-m="sizeUnit"><option value="">${esc(t("my.unit"))}</option>${SIZE_UNITS.map((u) => `<option value="${u}" ${u === it.sizeUnit ? "selected" : ""}>${esc(t("unit." + u))}</option>`).join("")}</select></div></div>
        <label class="f wide"><span>${esc(t("my.link"))} <small>${esc(t("my.link_hint"))}</small></span><input data-m="link" type="url" inputmode="url" autocomplete="off" placeholder="https://…" value="${esc(it.link)}"></label>
        <label class="f wide"><span>${esc(t("my.note"))} <small>${esc(t("common.optional"))}</small></span><input data-m="note" autocomplete="off" value="${esc(it.note)}"></label>
      </div>
      <div class="row2"><button type="button" class="btn" id="msave">${esc(t(saved ? "my.save_changes" : "my.save"))}</button>
        ${saved ? `<button type="button" class="btn ghost danger" id="mdel">${esc(t("common.delete"))}</button>` : ""}
        <span id="mstat" class="muted">${esc(saved ? t("my.saved_at", { date: when(saved.date) }) : t("my.not_saved"))}</span></div>
      <div class="mysrc" id="msrc"></div>
    </div>
    <h2>${esc(t("calc.title"))}</h2>
    <div id="mcalc" class="calc"></div>`;

  const ref = () => asProduct(it);
  const stat = view.querySelector("#mstat"), srcEl = view.querySelector("#msrc"), calcEl = view.querySelector("#mcalc");
  let calc = null, unit = undefined;
  const drawSrc = () => {
    const p = ref();
    srcEl.innerHTML = `<span class="badge mine">${esc(t("my.badge"))}</span> ${p.price_per_unit != null ? `<span class="muted">${perUnitText(p)}</span>` : ""} ${srcLink(p)}`;
  };
  const mount = () => {
    const p = ref();
    unit = p.unit;
    calc = mountCalc(calcEl, {
      getRef: ref,
      // my selling price is kept with the item (written now if it is saved, else with "Save")
      sellStore: {
        key: () => "my",
        get: () => (it.sell && it.sell.price > 0 ? { ...it.sell, pending: !id } : null),
        set: (_, price) => {
          it.sell = price > 0 ? { price, date: new Date().toISOString() } : null;
          if (id) saveMySell(id, it.sell);
          return it.sell ? { ...it.sell, pending: !id } : null;
        },
      },
      unit: p.unit || "pc",
      showPack: !!p.unit,
      packHint: p.size ? t("my.pack_hint", { size: sizeText(p) }) : "",
      header: (r) => `<div class="refcard"><span>${esc(t("calc.ref"))}</span> <b>${esc(r.name)}</b> <span class="muted">${r.size ? esc(sizeText(r)) + " · " : ""}${gel(r.regular_price)}</span> <span class="badge mine">${esc(t("my.badge"))}</span> ${srcLink(r)}</div>`,
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
    if (id) stat.textContent = t("my.changed");
    drawSrc();
    if (k === "sizeVal" || k === "sizeUnit") {
      const bs = baseSize(it);
      if (bs) { deal.packSize = String(+bs.size.toFixed(4)); saveDeal(); }
      if ((bs ? bs.unit : null) !== unit || bs) { mount(); return; }
    }
    calc.update();
  });
  view.querySelector("#msave").onclick = () => {
    if (!String(it.name || "").trim()) { stat.textContent = t("my.need_name"); return; }
    const out = saveMy({ ...it, id: id || undefined, deal: JSON.parse(JSON.stringify(deal)) });
    if (!out) { stat.textContent = t("my.save_failed"); return; }
    id = out.id; it.id = out.id;
    stat.textContent = t("my.saved_at", { date: when(out.date) });
    view.querySelector("#msave").textContent = t("my.save_changes");
    calc.update(); // the selling price note now says "saved"
    history.replaceState(null, "", "#/my/" + id);
  };
  const del = view.querySelector("#mdel");
  if (del) del.onclick = () => { if (confirm(t("my.confirm_delete", { name: it.name }))) { deleteMy(id); location.hash = "#/my"; } };
  drawSrc();
  mount();
}
