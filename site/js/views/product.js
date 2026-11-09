// Product page: image, facts, per-shop table, last change, calculator, similar products.
import { S, deal, saveDeal, ppuOf, shortLabel } from "../state.js";
import { esc, gel, img, badges, sizeText, perUnitText, day, when, changeText, unitName, row } from "../ui.js";
import { mountCalc } from "../calcui.js";

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
    view.innerHTML = `<div class="empty"><p>Product ${esc(barcode)} is not in the data.</p><a class="btn" href="#/">Back to search</a></div>`;
    return;
  }
  // Pack size: keep the supplier's size when coming from Compare by type, else this product's size.
  if (params.get("keep") !== "1") { deal.packSize = p.size ? String(+p.size.toFixed(4)) : ""; saveDeal(); }
  let ref = p;
  const chg = S.changeBy.get(p.barcode);
  const stores = (p.stores || []).slice().sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));

  view.innerHTML = `
    <div class="topbar"><button type="button" class="back" onclick="history.length > 1 ? history.back() : (location.hash = '#/')">‹ Back</button></div>
    <article class="product">
      <div class="phead">
        ${img(p, "pimg")}
        <div>
          <h1>${esc(p.name)}</h1>
          <div class="meta">${esc(sizeText(p) || "size unknown")} · ${esc(shortLabel(p.type_label || p.type))}</div>
          <div class="meta">Barcode ${esc(p.barcode)}</div>
          <div class="badges">${badges(p)}</div>
          ${p.link ? `<a class="ext" href="${esc(p.link)}" target="_blank" rel="noopener">Open on Dazoge ↗</a>` : ""}
        </div>
      </div>
      <div class="facts">
        <div><small>Regular price</small><b>${gel(p.regular_price)}</b><span>${esc(p.regular_price_store || "")}</span></div>
        <div><small>Cheapest now</small><b class="${p.promo_now ? "promo-t" : ""}">${gel(p.cheapest_now)}</b><span>${esc(p.cheapest_now_store || "")}</span></div>
        <div><small>Per unit</small><b>${perUnitText(p) || "–"}</b><span>${p.price_per_unit == null && p.price_per_unit_now != null ? "current price" : ""}</span></div>
        <div><small>30-day low</small><b>${gel(p.min_30d)}</b><span>${p.old_price ? "was " + gel(p.old_price) : ""}</span></div>
      </div>

      <h2>Shops</h2>
      ${stores.length ? `<div class="tbl"><table>
        <thead><tr><th>Shop</th><th class="n">Now</th><th class="n">Regular</th><th class="n">Promo days</th></tr></thead>
        <tbody>${stores.map((s) => `<tr>
          <td>${s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.store || "?")} ↗</a>` : esc(s.store || "?")}</td>
          <td class="n ${s.old_price != null || s.discount_pct != null ? "promo-t" : ""}">${gel(s.price)}</td>
          <td class="n">${gel(s.regular_30d)}</td>
          <td class="n">${s.promo_days != null ? s.promo_days + (s.history_days && s.history_days !== 30 ? "/" + s.history_days : "/30") : "–"}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted">Per-shop prices come with the next full update.${p.store_count ? " Sold in " + p.store_count + " shop" + (p.store_count === 1 ? "" : "s") + "." : ""}</p>`}

      <h2>Price change and status</h2>
      <ul class="plain">
        <li>${p.last_change ? `Regular price changed ${gel(p.last_change.old_regular_price)} → ${gel(p.last_change.new_regular_price)} on ${day(p.last_change.date)}` : "No regular price change recorded yet."}</li>
        ${chg ? `<li>Last update: ${chg.field === "regular_price" ? "regular" : "cheapest"} price ${gel(chg.old)} → ${gel(chg.new)} ${changeText(chg)}</li>` : ""}
        <li>Status: ${p.status === "active" ? "listed" : "<b>no longer listed</b> since " + esc(day(p.not_listed_since))} · first seen ${esc(day(p.first_seen))}</li>
        <li class="muted">Data: full ${when(p.last_full_update)} · quick ${when(p.last_quick_update)}</li>
      </ul>

      <h2 id="calc">Calculator</h2>
      <div id="calcbox" class="calc"></div>

      <h2>Similar products</h2>
      <p class="hint">Same type, size ${p.size ? "0.5×–2× of " + esc(sizeText(p)) : "unknown"}, cheapest per ${unitName(p.unit) || "unit"} first. Tap one to use it as the market reference.</p>
      <div class="list" id="similar"></div>
    </article>`;

  const calc = mountCalc(view.querySelector("#calcbox"), {
    getRef: () => ref,
    unit: p.unit,
    packHint: p.size ? "This product: " + sizeText(p) : "This product's size is unknown",
    header: (r) => r === p ? `<span class="muted">Market reference: this product</span>`
      : `<div class="refcard"><span>Market reference:</span> <b>${esc(r.name)}</b> <span class="muted">${esc(sizeText(r))} · ${gel(r.regular_price ?? r.cheapest_now)}</span>
         <button type="button" class="btn sm" data-reset>Use this product again</button></div>`,
  });
  view.querySelector("#calcbox").addEventListener("click", (e) => {
    if (e.target.closest("[data-reset]")) { ref = p; calc.update(); drawSimilar(); }
  });

  const simEl = view.querySelector("#similar");
  const drawSimilar = () => {
    const sim = similarTo(p, p.size);
    simEl.innerHTML = sim.length ? sim.map((x) => row(x, `<span class="use ${ref === x ? "on" : ""}">${ref === x ? "reference" : "use"}</span>`, `href="#" data-ref="${esc(x.barcode)}"`)).join("")
      : `<p class="muted">No similar products with a known size.</p>`;
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
