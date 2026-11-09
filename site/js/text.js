// Text folding for search: Georgian and Latin end up in the same simplified Latin form,
// so "პერსილი", "persili" and "persil" are close, and typos are handled by Fuse.js on top.

const KA = {
  "ა": "a", "ბ": "b", "გ": "g", "დ": "d", "ე": "e", "ვ": "v", "ზ": "z", "თ": "t", "ი": "i",
  "კ": "k", "ლ": "l", "მ": "m", "ნ": "n", "ო": "o", "პ": "p", "ჟ": "zh", "რ": "r", "ს": "s",
  "ტ": "t", "უ": "u", "ფ": "p", "ქ": "k", "ღ": "gh", "ყ": "k", "შ": "sh", "ჩ": "ch", "ც": "ts",
  "ძ": "dz", "წ": "ts", "ჭ": "ch", "ხ": "kh", "ჯ": "j", "ჰ": "h",
};
// Russian words appear now and then in names (порошок, шампунь).
const RU = {
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
  "й": "i", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
  "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "", "ы": "i", "ь": "",
  "э": "e", "ю": "iu", "я": "ia",
};

/** Lower-case, transliterate, simplify spelling (f→p, c→k, y→i, w→v…), drop punctuation. */
export function fold(s) {
  if (!s) return "";
  let t = "";
  for (const ch of String(s).toLowerCase()) t += KA[ch] ?? RU[ch] ?? ch;
  t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  t = t
    .replace(/&/g, " and ")
    .replace(/ph/g, "p").replace(/ck/g, "k").replace(/c(?!h)/g, "k")
    .replace(/f/g, "p").replace(/w/g, "v").replace(/y/g, "i").replace(/q/g, "k").replace(/x/g, "ks")
    .replace(/([a-z])\1+/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return t;
}

const isGeorgian = (s) => /[ა-ჿ]/.test(s);

/**
 * Parse aliases.txt: one group per line, comma-separated spellings, optional "@type_id".
 * Returns [{ words:[original], folded:[folded], match:[{f, stem}], type }].
 */
export function parseAliases(txt) {
  const groups = [];
  for (let line of String(txt || "").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    let type = null;
    const m = line.match(/@([a-z_]+)\s*$/);
    if (m) { type = m[1]; line = line.slice(0, m.index).trim(); }
    const words = line.split(",").map((w) => w.trim()).filter(Boolean);
    if (!words.length) continue;
    const folded = words.map(fold).filter(Boolean);
    // Georgian nouns change their ending (პერსილი / პერსილის): match the stem without final "i".
    const match = words.map((w) => {
      const f = fold(w);
      const stem = isGeorgian(w) && f.length > 4 && f.endsWith("i") ? f.slice(0, -1) : f;
      return { f, stem };
    }).filter((x) => x.f);
    groups.push({ words, folded, match, type });
  }
  return groups;
}

/** Does folded text contain this alias spelling? Short spellings must be whole words. */
export function hasWord(text, { f, stem }) {
  if (stem.length >= 5) {
    // must start at a word start
    let i = text.indexOf(stem);
    while (i >= 0) {
      if (i === 0 || text[i - 1] === " ") return true;
      i = text.indexOf(stem, i + 1);
    }
    return false;
  }
  return (" " + text + " ").includes(" " + f + " ");
}

/** Parse big_brands.txt: each line = one brand (+ optional extra spellings). */
export function parseBrands(txt, aliasGroups) {
  const brands = [];
  for (let line of String(txt || "").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const words = line.split(",").map((w) => w.trim()).filter(Boolean);
    const set = new Set(words.map(fold));
    // add every spelling from the alias group that contains one of these words
    for (const g of aliasGroups) if (g.folded.some((f) => set.has(f))) g.folded.forEach((f) => set.add(f));
    const match = [...set].filter(Boolean).map((f) => ({ f, stem: f }));
    // Georgian spellings: allow the stem without final "i" too
    for (const g of aliasGroups) if (g.folded.some((f) => set.has(f))) for (const m of g.match) match.push(m);
    brands.push({ name: words[0], match });
  }
  return brands;
}
