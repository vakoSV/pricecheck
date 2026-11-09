// Changes since the previous update (changes_today.json).
import { S } from "../state.js";
import { esc, gel, when, day, img } from "../ui.js";
import { t } from "../i18n.js";

function item(barcode, name, right) {
  const p = S.byBarcode.get(barcode) || { barcode, name };
  return `<a class="row" href="#/p/${encodeURIComponent(barcode)}">${img(p, "thumb sm")}<div class="rb"><div class="nm1">${esc(name || p.name)}</div>${right}</div></a>`;
}

export function render(view) {
  const c = S.changes;
  if (!c) { view.innerHTML = `<h1 class="h">${esc(t("changes.title"))}</h1><p class="muted">${esc(t("changes.none_file"))}</p>`; return; }
  const head = `<h1 class="h">${esc(t("changes.title"))}</h1><p class="hint">${esc(t(c.mode === "quick" ? "changes.since_quick" : c.mode === "full" ? "changes.since_full" : "changes.since", { mode: c.mode, date: when(c.generated_at) }))}</p>`;
  if (c.counts && c.counts.baseline) { view.innerHTML = head + `<p class="muted">${esc(t("changes.baseline"))}</p>`; return; }
  const fld = (f) => t(f === "regular_price" ? "changes.field_regular" : "changes.field_cheapest");
  const pc = c.price_changes || [];
  const up = pc.filter((x) => x.new > x.old).sort((a, b) => b.pct - a.pct);
  const down = pc.filter((x) => x.new < x.old).sort((a, b) => a.pct - b.pct);
  const priceRow = (x) => item(x.barcode, x.name, `<div class="meta">${esc(fld(x.field))}: ${gel(x.old)} → <b>${gel(x.new)}</b> <span class="chg ${x.new > x.old ? "up" : "down"}">${x.new > x.old ? "▲" : "▼"} ${Math.abs(x.new - x.old).toFixed(2)} ₾ (${x.pct > 0 ? "+" : ""}${x.pct}%)</span></div>`);
  const sections = [
    ["up", t("changes.up"), up, priceRow],
    ["down", t("changes.down"), down, priceRow],
    ["new", t("changes.new"), c.new || [], (x) => item(x.barcode, x.name, `<div class="meta">${gel(x.cheapest_now)}</div>`)],
    ["gone", t("changes.gone"), c.disappeared || [], (x) => item(x.barcode, x.name, `<div class="meta">${esc(t("changes.last_price", { price: gel(x.last_cheapest_now) }))}</div>`)],
    ["back", t("changes.back"), c.returned || [], (x) => item(x.barcode, x.name, `<div class="meta">${esc(t("changes.gone_since", { date: day(x.not_listed_since) }))}</div>`)],
  ].filter((s) => s[0] !== "back" || s[2].length);
  view.innerHTML = head + `<div class="tabs">${sections.map(([k, l, a]) => `<a href="#ch-${k}">${esc(l)} <b>${a.length}</b></a>`).join("")}</div>` +
    sections.map(([k, l, a, f]) => `<section id="ch-${k}"><h2>${esc(l)} <small class="muted">${a.length}</small></h2>
      ${a.length ? `<div class="list">${a.slice(0, 300).map(f).join("")}</div>${a.length > 300 ? `<p class="muted">${esc(t("changes.more", { n: a.length - 300 }))}</p>` : ""}` : `<p class="muted">${esc(t("changes.none"))}</p>`}</section>`).join("");
  view.querySelector(".tabs").addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    view.querySelector(a.getAttribute("href")).scrollIntoView({ behavior: "smooth" });
  });
}
