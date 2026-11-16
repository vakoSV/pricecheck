// Buy list page (#/buy, #/buy?p=2): the products I saved with the heart, newest saved first,
// 50 per page. A tap on a card opens that product's page at its calculator (#/p/<barcode>?calc=1).
// Unsaving here removes the card at once, with "Undo" for 5 seconds (app.js).
import { S } from "../state.js";
import { esc, card, heart } from "../ui.js";
import { pager } from "./home.js";
import * as buy from "../buylist.js";
import { t, tn } from "../i18n.js";

export const PER_PAGE = 50;

/** A saved barcode that is not in the current price data (so it can still be unsaved). */
function missingCard(id) {
  return `<div class="hcard"><div class="card gonecard">
    <div class="cb"><div class="nm">${esc(t("buy.missing"))}</div><div class="meta">${esc(t("product.barcode"))} ${esc(id)}</div></div>
  </div>${heart(id)}</div>`;
}

export function render(view, params) {
  const all = buy.list();
  const st = buy.status();
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, parseInt(params.get("p"), 10) || 1));
  const from = (page - 1) * PER_PAGE;
  const notes = [
    st.offline ? `<div class="note warn">${esc(t("buy.offline"))}</div>` : "",
    !buy.hasToken() ? `<div class="note">${esc(t("buy.readonly"))} <a href="#/settings">${esc(t("buy.to_settings"))}</a></div>` : "",
    st.error ? `<div class="note warn">${esc(t("buy.err." + st.error))}</div>` : "",
  ].join("");
  view.innerHTML = `
    <h1 class="h">${esc(t("buy.title"))}</h1>
    <p class="hint">${esc(all.length ? tn("buy.count", all.length) : t("buy.hint"))}</p>
    ${notes}
    ${!st.loaded ? `<div class="loading"><div class="spin"></div></div>`
      : all.length ? `<div class="grid">${all.slice(from, from + PER_PAGE).map((x) => {
        const p = S.byBarcode.get(x.id);
        return p ? card(p, { href: "#/p/" + encodeURIComponent(x.id) + "?calc=1" }) : missingCard(x.id);
      }).join("")}</div>${pager(page, pages)}`
      : `<div class="empty"><p>${esc(t("buy.empty"))}</p></div>`}`;
  view.querySelectorAll(".pager [data-page]").forEach((b) => {
    b.onclick = () => {
      if (b.disabled) return;
      const n = +b.dataset.page;
      location.hash = "#/buy" + (n > 1 ? "?p=" + n : ""); // a new history entry: Back returns to the page before
      window.scrollTo({ top: 0 });
    };
  });
}
