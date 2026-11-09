// Product search. Every product name is folded (Georgian/Latin → simple Latin, see text.js) and
// split into words; alias spellings from aliases.txt are added as extra words. A query word
// matches a product word when it is equal, a prefix, contained in a long compound, or within
// 1 typo (2 for long words). Every query word must match. No library needed.
import { fold, hasWord } from "./text.js";

const ALIAS_PENALTY = 0.15; // a match through an alias ranks a little below a direct match

/** Build the search index. aliasGroups from parseAliases(). */
export function buildIndex(products, aliasGroups) {
  const vocab = new Map(); // word -> Map(docIndex -> penalty)
  const add = (w, i, pen) => {
    let m = vocab.get(w);
    if (!m) vocab.set(w, (m = new Map()));
    if (!m.has(i) || m.get(i) > pen) m.set(i, pen);
  };
  products.forEach((p, i) => {
    const name = fold(p.name);
    for (const w of name.split(" ")) if (w) add(w, i, 0);
    for (const w of fold((p.type_label || "").replace(/\(.*\)/, "")).split(" ")) if (w) add(w, i, ALIAS_PENALTY);
    for (const g of aliasGroups) {
      if (!g.match.some((m) => hasWord(name, m))) continue;
      for (const f of g.folded) for (const w of f.split(" ")) if (w) add(w, i, ALIAS_PENALTY);
    }
  });
  return { products, vocab, words: [...vocab.keys()] };
}

/** Optimal-string-alignment distance with an early exit above max. */
function dist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  let prev2 = null, prev = Array.from({ length: n + 1 }, (_, j) => j), cur;
  for (let i = 1; i <= a.length; i++) {
    cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[n];
}

/** Cost of matching query word t to product word w (lower is better), or -1 for no match. */
function wordCost(t, w) {
  if (w === t) return 0;
  if (/^\d/.test(t)) return w.startsWith(t) && !/\d/.test(w[t.length] || "") ? 0.05 : -1; // "500" ~ "500ml"
  if (w.startsWith(t)) return t.length >= 2 ? 0.1 + 0.01 * (w.length - t.length) : -1;
  if (t.length < 4) return -1;
  if (t.length >= 5 && w.length > t.length + 2 && w.includes(t)) return 0.3; // compound words
  const max = t.length >= 8 ? 2 : 1;
  const d = dist(t, w, max);
  if (d <= max) return 0.5 * d;
  if (w.length > t.length) { // typo while still typing: compare with the word's start
    const dp = dist(t, w.slice(0, t.length), max);
    if (dp <= max) return 0.55 * dp + 0.1;
  }
  return -1;
}

/**
 * Search. Returns products, best first.
 *   q: free text (Latin or Georgian, typos OK) or a barcode (5+ digits)
 *   type: optional type id filter
 */
export function search(idx, q, type) {
  const raw = String(q || "").trim();
  const byType = (p) => !type || p.type === type;
  if (!raw) return idx.products.filter(byType);
  if (/^\d{5,}$/.test(raw)) return idx.products.filter((p) => p.barcode.includes(raw) && byType(p));
  const tokens = [...new Set(fold(raw).split(" ").filter(Boolean))];
  if (!tokens.length) return idx.products.filter(byType);

  let scores = null; // docIndex -> total cost
  for (const t of tokens) {
    const best = new Map();
    for (const w of idx.words) {
      const c = wordCost(t, w);
      if (c < 0) continue;
      for (const [i, pen] of idx.vocab.get(w)) {
        const v = c + pen;
        if (!best.has(i) || best.get(i) > v) best.set(i, v);
      }
    }
    if (!scores) scores = best;
    else {
      const next = new Map();
      for (const [i, v] of scores) if (best.has(i)) next.set(i, v + best.get(i));
      scores = next;
    }
    if (!scores.size) break;
  }
  const out = [];
  for (const [i, s] of scores) {
    const p = idx.products[i];
    if (byType(p)) out.push([p, s + (p.status === "active" ? 0 : 5)]);
  }
  out.sort((a, b) => a[1] - b[1] || a[0].name.length - b[0].name.length);
  // When some products match without a typo, drop the typo look-alikes ("colgate" ≠ "kolgotebi").
  const cut = out.length ? Math.max(0.5, out[0][1] + 0.45) : 0;
  return out.filter((x) => x[1] < cut || x[1] >= 5 && x[1] - 5 < cut).map((x) => x[0]);
}

/** The product type a query names, via "@type" tags in aliases.txt (for "Compare by type"). */
export function guessType(q, aliasGroups) {
  const t = " " + fold(q) + " ";
  let best = null;
  for (const g of aliasGroups) {
    if (!g.type) continue;
    for (const f of g.folded) {
      if (f.length >= 3 && t.includes(" " + f + " ") && (!best || f.length > best.len)) best = { type: g.type, len: f.length };
    }
  }
  return best ? best.type : null;
}

/**
 * Product types for a free-text query (Compare by type search box). A type matches when every
 * query word matches a word of its label or of an alias spelling tagged "@type" in aliases.txt
 * (same word rules as the product search). Types of the products the query finds come after
 * ("Persil" → laundry types). Returns [{ id, via: "name" | "products", hits }] best first.
 */
export function findTypes(idx, q, types, aliasGroups) {
  const tokens = [...new Set(fold(q).split(" ").filter(Boolean))];
  if (!tokens.length) return [];
  const out = [];
  for (const t of types) {
    const words = new Set(fold(t.label).split(" ").filter(Boolean));
    for (const g of aliasGroups) if (g.type === t.id) for (const f of g.folded) for (const w of f.split(" ")) if (w) words.add(w);
    let total = 0;
    for (const tok of tokens) {
      let best = -1;
      for (const w of words) { const c = wordCost(tok, w); if (c >= 0 && (best < 0 || c < best)) best = c; }
      if (best < 0) { total = -1; break; }
      total += best;
    }
    if (total >= 0) out.push({ id: t.id, via: "name", score: total });
  }
  out.sort((a, b) => a.score - b.score);
  const seen = new Set(out.map((x) => x.id));
  const counts = new Map();
  for (const p of search(idx, q, "").slice(0, 300)) if (!seen.has(p.type)) counts.set(p.type, (counts.get(p.type) || 0) + 1);
  // only types with a fair share of the matching products (a stray product doesn't add a type)
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const min = ranked.length ? Math.max(2, 0.2 * ranked[0][1]) : 0;
  for (const [id, hits] of ranked) if (hits >= min && types.some((t) => t.id === id)) out.push({ id, via: "products", hits });
  return out;
}
