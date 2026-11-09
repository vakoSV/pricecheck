// Product page: image, facts, per-shop table, last change, calculator, similar products.
import { S, deal, saveDeal, ppuOf, shortLabel, sellPrices } from "../state.js";
import { esc, gel, img, badges, sizeText, perUnitText, day, when, changeText, unitName, row, srcLink } from "../ui.js";
import { mountCalc } from "../calcui.js";
import { t, tn, typeName } from "../i18n.js";

/** Same type and unit, size within 0.5×–2×, sorted by price per unit. */
export function similarTo(p, size, limit = 5) {
  if (!size || !p.unit) return [];
  return S.products
    .filter((x) => x.barcode !== p.barcode && x.status === "active" && x.type === p.type && x.unit === p.unit &&
      x.size && x.size >= 0.5 * size && x.size <= 2 * size && ppuOf(x) != null)
    .sort((a, b) => ppuOf(a) - ppuOf(b))
    .slice(0, limit);
}

export function render(view, params, barcode) {
  const p = S.byBarcode.get(barcode);
  if (!p) {
    view.innerHTML = `<div class="empty"><p>${esc(t("product.missing", { barcode }))}</p><a class="btn" href="#/">${esc(t("product.back_search"))}</a></div>`;
    return;
  }
  // Pack size: keep the supplier's size when coming from Compare by type, else this product's size.
  if (params.get("keep") !== "1") { deal.packSize = p.size ? String(+p.size.toFixed(4)) : ""; saveDeal(); }
  let ref = p;
  const chg = S.changeBy.get(p.barcode);
  const stores = (p.stores || []).slice().sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));

  view.innerHTML = `
    <div class="topbar"><button type="button" class="back" onclick="history.length > 1 ? history.back() : (location.hash = '#/')">‹ ${esc(t("common.back"))}</button></div>
    <article class="product">
      <div class="phead">
        ${img(p, "pimg")}
        <div>
          <h1>${esc(p.name)}</h1>
          <div class="meta">${esc(sizeText(p) || t("product.size_unknown"))} · ${esc(typeName(p.type, shortLabel(p.type_label || p.type)))}</div>
          <div class="meta">${esc(t("product.barcode"))} ${esc(p.barcode)}</div>
          <div class="badges">${badges(p)}</div>
          ${p.link ? `<a class="ext" href="${esc(p.link)}" target="_blank" rel="noopener">${esc(t("product.open_dazoge"))} ↗</a>` : ""}
        </div>
      </div>
      <div class="facts">
        <div><small>${esc(t("product.regular_price"))}</small><b>${gel(p.regular_price)}</b><span>${esc(p.regular_price_store || "")}</span>${srcLink(p)}</div>
        <div><small>${esc(t("product.cheapest_now"))}</small><b class="${p.promo_now ? "promo-t" : ""}">${gel(p.cheapest_now)}</b><span>${esc(p.cheapest_now_store || "")}</span>${srcLink(p)}</div>
        <div><small>${esc(t("product.per_unit"))}</small><b>${perUnitText(p) || "–"}</b><span>${p.price_per_unit == null && p.price_per_unit_now != null ? esc(t("product.current_price")) : ""}</span></div>
        <div><small>${esc(t("product.low_30d"))}</small><b>${gel(p.min_30d)}</b><span>${p.old_price ? esc(t("product.was", { price: gel(p.old_price) })) : ""}</span></div>
      </div>

      <h2>${esc(t("product.shops"))}</h2>
      ${stores.length ? `<div class="tbl"><table>
        <thead><tr><th>${esc(t("product.th_shop"))}</th><th class="n">${esc(t("product.th_now"))}</th><th class="n">${esc(t("product.th_regular"))}</th><th class="n">${esc(t("product.th_promo_days"))}</th></tr></thead>
        <tbody>${stores.map((s) => `<tr>
          <td>${s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.store || "?")} ↗</a>` : esc(s.store || "?")}</td>
          <td class="n ${s.old_price != null || s.discount_pct != null ? "promo-t" : ""}">${gel(s.price)}</td>
          <td class="n">${gel(s.regular_30d)}</td>
          <td class="n">${s.promo_days != null ? s.promo_days + (s.history_days && s.history_days !== 30 ? "/" + s.history_days : "/30") : "–"}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted">${esc(t("product.no_shops"))}${p.store_count ? " " + esc(tn("product.sold_in", p.store_count)) : ""}</p>`}

      <h2>${esc(t("product.change_status"))}</h2>
      <ul class="plain">
        <li>${p.last_change ? esc(t("product.reg_changed", { old: gel(p.last_change.old_regular_price), new: gel(p.last_change.new_regular_price), date: day(p.last_change.date) })) : esc(t("product.no_change"))}</li>
        ${chg ? `<li>${esc(t(chg.field === "regular_price" ? "product.last_update_regular" : "product.last_update_cheapest", { old: gel(chg.old), new: gel(chg.new) }))} ${changeText(chg)}</li>` : ""}
        <li>${p.status === "active" ? esc(t("product.status_listed", { date: day(p.first_seen) })) : t("product.status_gone", { since: esc(day(p.not_listed_since)), date: esc(day(p.first_seen)) })}</li>
        <li class="muted">${esc(t("product.data_dates", { full: when(p.last_full_update), quick: when(p.last_quick_update) }))}</li>
      </ul>

      <h2 id="calc">${esc(t("calc.title"))}</h2>
      <div id="calcbox" class="calc"></div>

      <h2>${esc(t("product.similar"))}</h2>
      <p class="hint">${esc(t(p.size ? "product.similar_hint" : "product.similar_hint_nosize", { size: sizeText(p), unit: unitName(p.unit) || t("product.unit_generic") }))}</p>
      <div class="list" id="similar"></div>
    </article>`;

  const calc = mountCalc(view.querySelector("#calcbox"), {
    getRef: () => ref,
    // my selling price belongs to this product, whichever product is the market reference
    sellStore: { key: () => p.barcode, get: (k) => sellPrices.get(k), set: (k, v) => sellPrices.set(k, v) },
    shops: true, // shop chips: the market price from my selected shops only

    unit: p.unit,
    packHint: p.size ? t("product.pack_hint", { size: sizeText(p) }) : t("product.pack_hint_unknown"),
    header: (r) => r === p ? `<span class="muted">${esc(t("calc.ref_this"))}</span> ${srcLink(p)}`
      : `<div class="refcard"><span>${esc(t("calc.ref"))}</span> <b>${esc(r.name)}</b> <span class="muted">${esc(sizeText(r))} · ${gel(r.regular_price ?? r.cheapest_now)}</span>
         ${srcLink(r)} <button type="button" class="btn sm" data-reset>${esc(t("calc.ref_back"))}</button></div>`,
  });
  view.querySelector("#calcbox").addEventListener("click", (e) => {
    if (e.target.closest("[data-reset]")) { ref = p; calc.update(); drawSimilar(); }
  });

  const simEl = view.querySelector("#similar");
  const drawSimilar = () => {
    const sim = similarTo(p, p.size);
    simEl.innerHTML = sim.length ? sim.map((x) => row(x, `<span class="use ${ref === x ? "on" : ""}">${esc(t(ref === x ? "common.reference" : "common.use"))}</span>`, `href="#" data-ref="${esc(x.barcode)}"`)).join("")
      : `<p class="muted">${esc(t("product.no_similar"))}</p>`;
  };
  simEl.addEventListener("click", (e) => {
    const a = e.target.closest("[data-ref]");
    if (!a) return;
    e.preventDefault();
    const x = S.byBarcode.get(a.dataset.ref);
    ref = ref === x ? p : x;
    calc.update();
    drawSimilar();
    view.querySelector("#calc").scrollIntoView({ behavior: "smooth" });
  });
  drawSimilar();
}
