// Calculator maths. Pure functions, no DOM. All GEL amounts are per piece unless named otherwise.
//
//   price per piece      = supplier price / pieces in the quoted unit (× paid/(paid+free) for bundles)
//   landed cost / piece  = price per piece × rate × (1 + VAT) × (1 + freight)            [GEL]
//                          GEL (Georgian) supplier: price per piece × (1 + local delivery)
//                          (VAT is already in a Georgian price; local delivery = fuel, default 5%)
//   sell price / piece   = market regular price × (1 − below market), scaled by pack size [GEL]
//   margin               = (sell − landed) / sell

export const DEFAULTS = { vat: 18, freight: 10, local: 5, below: 15, low: 25, high: 35, rates: { USD: null, EUR: null, TRY: null } };
export const CURRENCIES = ["USD", "EUR", "TRY"]; // currencies with an exchange rate (Settings)
export const SUPPLIER_CURRENCIES = [...CURRENCIES, "GEL"]; // what a supplier price can be in
export const SYMBOL = { USD: "$", EUR: "€", TRY: "₺", GEL: "₾" };

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", ".").trim());
  return isFinite(n) ? n : null;
};
export { num };

/** GEL per 1 unit of currency: the user's override, else the NBG rate. */
export function rateOf(cur, settings, nbgRates) {
  if (cur === "GEL") return 1;
  const o = num(settings.rates && settings.rates[cur]);
  if (o != null && o > 0) return o;
  const r = nbgRates && nbgRates[cur];
  return r > 0 ? r : null;
}

/** Pieces in the quoted unit (1 for "piece"). */
export function piecesPerUnit(deal) {
  if (deal.per === "piece") return 1;
  const n = num(deal.pcsPer);
  return n > 0 ? n : null;
}

/** Bundle factor paid/(paid+free); 1 if no bundle. */
export function bundleFactor(deal) {
  const paid = num(deal.paid), free = num(deal.free);
  if (!(paid > 0) || !(free > 0)) return 1;
  return paid / (paid + free);
}

/** Supplier price per piece in the supplier's currency (after bundle), or null. */
export function supplierPerPiece(deal) {
  const p = num(deal.price), n = piecesPerUnit(deal);
  if (p == null || !(p >= 0) || !n) return null;
  return (p / n) * bundleFactor(deal);
}

/** Multiplier from supplier currency to landed GEL. */
export function landedFactor(rate, s, cur) {
  if (cur === "GEL") return 1 + num(s.local) / 100; // VAT included, local delivery only
  return rate * (1 + num(s.vat) / 100) * (1 + num(s.freight) / 100);
}

/** One-line explanation of the landed-cost formula for the supplier currency. */
export function costNote(cur, s) {
  return cur === "GEL" ? `Georgian supplier: VAT included, + ${num(s.local)}% fuel` : "";
}

/** Market prices of a reference product. */
export function marketRegular(ref) {
  if (!ref) return null;
  if (ref.regular_price != null) return { price: ref.regular_price, store: ref.regular_price_store, kind: "regular" };
  if (ref.cheapest_now != null) return { price: ref.cheapest_now, store: ref.cheapest_now_store, kind: "now" };
  return null;
}

/** Lowest promo price we know: 30-day minimum, or the current price when on promo. */
export function marketPromo(ref) {
  if (!ref) return null;
  const c = [];
  if (ref.min_30d != null) c.push({ price: ref.min_30d, store: null });
  for (const s of ref.stores || []) if (s.min_30d != null) c.push({ price: s.min_30d, store: s.store });
  if (ref.promo_now && ref.cheapest_now != null) c.push({ price: ref.cheapest_now, store: ref.cheapest_now_store });
  if (!c.length) return null;
  c.sort((a, b) => a.price - b.price || (a.store ? -1 : 1));
  return c[0];
}

/**
 * Scale a market price (for the reference's pack) to the supplier's pack size.
 * Returns { price, scaled: bool }. No scaling when either size is unknown.
 */
export function scaleToPack(price, ref, packSize) {
  const ps = num(packSize);
  if (price == null) return null;
  if (!ref || !ref.size || !(ps > 0) || Math.abs(ps - ref.size) < 1e-9) return { price, scaled: false };
  return { price: (price / ref.size) * ps, scaled: true };
}

export const marginOf = (sell, landed) => (sell > 0 && landed != null ? (sell - landed) / sell : null);

export function verdictOf(margin, s) {
  if (margin == null) return null;
  const m = margin * 100;
  if (m >= num(s.high)) return "GOOD DEAL";
  if (m >= num(s.low)) return "NEGOTIATE";
  return "AVOID";
}

/** Supplier price per piece (supplier currency) that gives a target margin at a sell price. */
export function priceForMargin(sell, marginPct, rate, s, cur) {
  if (!(sell > 0) || !(rate > 0)) return null;
  return (sell * (1 - marginPct / 100)) / landedFactor(rate, s, cur);
}

/**
 * Full evaluation of a deal against a reference product.
 * deal: { price, currency, per, pcsPer, packSize, paid, free }
 * Returns everything the UI shows; fields are null when not computable.
 */
export function evaluate(deal, ref, settings, nbgRates) {
  const rate = rateOf(deal.currency, settings, nbgRates);
  const ppp = supplierPerPiece(deal);
  const landed = ppp != null && rate ? ppp * landedFactor(rate, settings, deal.currency) : null;
  const mk = marketRegular(ref);
  const scaled = mk ? scaleToPack(mk.price, ref, deal.packSize) : null;
  const sell = scaled ? scaled.price * (1 - num(settings.below) / 100) : null;
  const margin = marginOf(sell, landed);
  const out = {
    rate, ppp, landed, market: mk, marketScaled: scaled, sell, margin,
    profit: sell != null && landed != null ? sell - landed : null,
    verdict: verdictOf(margin, settings),
    goodPrice: priceForMargin(sell, num(settings.high), rate, settings, deal.currency),
    walkPrice: priceForMargin(sell, num(settings.low), rate, settings, deal.currency),
    promo: null,
  };
  if (ref && ref.often_on_promo) {
    const pr = marketPromo(ref);
    const ps = pr ? scaleToPack(pr.price, ref, deal.packSize) : null;
    if (ps) out.promo = { ...pr, sell: ps.price, margin: marginOf(ps.price, landed), profit: landed != null ? ps.price - landed : null };
  }
  return out;
}

/**
 * Offer rows (volume tiers). rows: [{ pcs, price }] in the deal's currency; row 0 is the main price.
 * Returns per row: ppp, landed, margin, profit, cash (GEL for the whole row), saving vs row 0,
 * months to sell; plus the index of the best (lowest) price per piece.
 */
export function evaluateOffers(rows, sell, rate, settings, monthly, cur) {
  const f = rate ? landedFactor(rate, settings, cur) : null;
  const m = num(monthly);
  const out = rows.map((r) => {
    const pcs = num(r.pcs), price = num(r.price);
    const ppp = r.ppp != null ? r.ppp : pcs > 0 && price != null ? price / pcs : null;
    const landed = ppp != null && f ? ppp * f : null;
    return {
      pcs, ppp, landed,
      margin: marginOf(sell, landed),
      profit: sell != null && landed != null ? sell - landed : null,
      cash: landed != null && pcs > 0 ? landed * pcs : null,
      months: m > 0 && pcs > 0 ? pcs / m : null,
    };
  });
  let best = -1;
  out.forEach((o, i) => { if (o.ppp != null && (best < 0 || o.ppp < out[best].ppp - 1e-12)) best = i; });
  const first = out[0];
  for (const o of out) {
    o.savePerPiece = first && first.landed != null && o.landed != null ? first.landed - o.landed : null;
    o.saveTotal = o.savePerPiece != null && o.pcs > 0 ? o.savePerPiece * o.pcs : null;
  }
  return { rows: out, best };
}

/** Median of numbers. */
export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
