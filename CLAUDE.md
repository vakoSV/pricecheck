# pricecheck

## Goal
A database of Georgian household-goods retail prices (source: dazoge.info), plus a calculator that
helps decide TAKE IT / NEGOTIATE / AVOID for any supplier price entered. The website is on GitHub
Pages: https://vakosv.github.io/pricecheck/ (public repo, free, no server).

## Decisions (final)
- **Scraping runs only on the owner's PC.** dazoge.info (Cloudflare) blocks GitHub's servers with
  a 403 challenge. Never try to get around a block: no proxies, no challenge solvers. If dazoge
  refuses the PC too, the run stops with an error and nothing is published.
- No self-hosted runner and no scheduled task: the owner starts updates by hand from two desktop
  shortcuts.
- GitHub Actions only deploys: `.github/workflows/pages.yml` publishes `/site` and `/data` on
  every push to main. There is no scraping on GitHub. The test-scrape workflow was removed.
- The **Alfa supplier list is out of scope**. Do not reference or import it anywhere.
- Images: hotlink the `cdn.dazoge.info/product-images/...` URLs (og:image). Never download or
  store them.

## Rules
- Scraping: respect robots.txt (read at the start of every run; never `/search` or `/api/`), at
  most 1 request per 1.1 s, strictly sequential, retries with backoff, resumable.
- Never guess data: a value the site does not show stays empty (`null`).
- A failed or partial run publishes nothing: `data/` is written only after the whole run passed
  its checks.
- Commit in small steps with clear messages. Raw scrape files and resume state stay in
  `work/` at the repo root (git-ignored). Earlier scrapes (the 1 Nov 2026 dazoge CSVs, the original
  scraper, the feasibility-test outputs) are copied to `work/archive/`.

## How updates run (PC)
- Desktop shortcuts (created by `scraper/install_shortcuts.ps1`) run `scraper/run_update.ps1`,
  which opens a progress window, keeps the PC awake and ends with a result box ("Done: N
  products, N changed, site updated" or the error).
  - **Update prices (full)**, about 90 min: listing pages, then every product page (per-store
    prices, 30-day history, og:image). If interrupted, running it again resumes (within 36 h).
  - **Update prices (quick)**, about 3-5 min: listing pages only. It updates cheapest_now,
    promo_now, old_price and discount_pct, and adds new products with basic fields. It does NOT
    change regular prices, per-store data or 30-day history (those keep the last full run's
    values). If the cheapest price changed, `cheapest_now_store` becomes null, because the
    listing does not say which store it is.
- `node scraper/update.js full|quick [--fresh] [--dry] [--limit N]` runs it without the window.
  The steps are robots.txt → listing → (full: product pages) → NBG rates → `scraper/build.js` →
  checks → write `data/` → git commit + pull --rebase + push → wait until the site serves the new
  `data/meta.json`.
- Logs: `work/update.log`. Last result: `work/last_result.txt`. Resume state while a full run
  is unfinished: `work/full_state.json` + `work/full_pages.jsonl`.

## Data format (`/data`, published at https://vakosv.github.io/pricecheck/data/)
- `products.json`: `{run_id, generated_at, count, products:[...]}`, one product per line, sorted
  by barcode. Each product has:
  - **Identity:** barcode, name, subcategory (+ subcategory_name, subcategories), type,
    type_label, detail (sub-detail, joined with "+"), size, unit (`l`/`kg`/`pc`), size_source
    (`volume` column or `name`), image_url, link.
  - **Prices:**
    - regular_price + regular_price_store: the lowest store 30-day regular price, meaning the
      most frequent non-promo price per store.
    - cheapest_now + cheapest_now_store.
    - promo_now: the listing card shows an old price or a discount.
    - old_price, discount_pct.
    - often_on_promo: any store was on promo on ≥ 33% of its history days.
    - min_30d: the site's 30-day minimum.
    - store_count.
    - price_per_unit = regular_price / size, and price_per_unit_now = cheapest_now / size, in GEL
      per l, kg or pc.
  - **stores:** a list of {store, price, old_price, discount_pct, regular_30d, min_30d,
    promo_days, history_days, link}.
  - **Tracking:**
    - last_change: {old_regular_price, new_regular_price, date}.
    - status: `active` or `not listed`, plus not_listed_since.
    - first_seen, last_full_update, last_quick_update.
- `changes_today.json`: changes since the previous published run (full or quick).
  - It holds: price_changes [{barcode, name, field (cheapest_now / regular_price), old, new, pct}],
    new, disappeared, returned, and counts.
  - On the first run `counts.baseline` is true and nothing is compared.
- `history/YYYY-MM.jsonl`: the change-only history, one event per line. Each line has
  `{t, m, b, e, ...}`, with these events:
  - `new`: with cheapest_now and regular_price.
  - `price`: with f, o, n.
  - `gone`.
  - `back`.
- `history30/NN.json`: dazoge's 30-day per-store series for product-page charts, sharded by the
  last 2 barcode digits (`xx` = other). Each entry is
  `{barcode: {from, days, s:[[store, [[dayIndex, price, oldPriceOr0], ...]]]}}`. It's replaced on
  every full run.
- `rates.json`: official National Bank of Georgia rates, as GEL per 1 USD, EUR and TRY, with
  `valid_from`.
- `meta.json`: run_id, last_full_update, last_quick_update, last_run (mode, minutes, requests,
  change counts), products_active, products_not_listed, type counts, other_pct, rates.

## Product types
- **Rules:** `scraper/types/product_types.js` is the editable rules file (first matching rule
  wins). The matching logic is in `classifier.js`.
- **Report:** `node scraper/types/classify_types.js <csv>` writes a report to
  `scraper/types/out/`.
- **General rule:** words that say what a product IS (powder, gel, liquid, shower gel, deodorant…)
  beat brand words. A brand word decides the type only when no other product word is in the name
  (e.g. Vernel/Lenor → softener only without a detergent word or detergent brand).
- **Manual corrections:** `scraper/types/overrides.csv` (barcode,type,note) always wins over the
  rules; applied in every build. Bad lines are skipped with a warning.
- **Re-type without scraping:** `node scraper/retype.js` previews which products change type
  (also saved to `work/retype_changes.csv`); `--write` rewrites `data/products.json` and the type
  counts in `data/meta.json` (sets `meta.retyped_at`, which the site uses to refresh its cache).
- **The types:**
  - The 46 requested types, plus laundry additives, cleaning brushes and hair care (unclear).
  - 10 extra types marked `extra: true`: hair dye, nail care, makeup, perfume, face care, hair
    styling, hosiery, hair accessories, insecticide, shoe care.
  - Reusable c/108 kitchenware stays "other". Target: other < 5%.

## Phase 2: the website (built 9 Nov 2026)
Static, no server, no login, no libraries. Hash routes: `#/` search, `#/p/<barcode>` product,
`#/compare` compare by type, `#/changes`, `#/settings`. Mobile-first, dark mode follows the phone.
- **Search** (`site/js/search.js`, `site/js/text.js`): names are folded to simple Latin (Georgian
  transliterated, f→p, c→k, y→i, w→v, double letters merged). A query word matches a product word
  when equal, a prefix, inside a long compound, or within 1 typo (2 for 8+ letters); every query
  word must match. Typo look-alikes are dropped when exact matches exist. 5+ digits = barcode.
- **Aliases** `site/config/aliases.txt` (editable): one group of equivalent spellings per line,
  Latin <-> Georgian; `@type_id` at the end marks a product-type word (pre-selects the type in
  Compare by type when a search finds nothing). Georgian spellings also match without the final -ი.
- **Big brands** `site/config/big_brands.txt` (editable): one brand per line; Georgian spellings
  come from the alias line containing the brand.
- **Calculator** (`site/js/calc.js` maths, `site/js/calcui.js` UI):
  - Price per piece = price / pieces per box or pallet, × paid/(paid+free) for bundles.
  - Landed cost per piece = price per piece × rate × (1 + VAT) × (1 + freight) for USD, EUR, TRY.
  - Supplier currency GEL (Georgian supplier, e.g. Batumi; rate 1): the price already includes
    18% VAT, so landed = price per piece × (1 + local delivery (fuel), default 5%). Labelled
    "Georgian supplier: VAT included, + 5% fuel"; good-deal / walk-away prices use the same formula.
    GEL works in the calculator, offer rows, bundles and Compare by type.
  - Sell price = market regular price (current cheapest if no regular yet) × (1 − below market),
    scaled per l/kg/pc to the supplier's pack size. Margin = (sell − landed) / sell.
  - **"YOUR SELLING PRICE"** field, big next to the margin, filled with market − X% (with the
    note "market 10.00 ₾ − 15%"). Typing my own price makes margin, profit, offer rows and the
    suggestion use it; "reset to market − X%" goes back. Under it: lowest selling price for the
    low / high margin levels = landed / (1 − level). A typed price is saved on the phone with its
    date: Dazoge products in `pc.sell.v1` (by the page's barcode, whichever product is the
    reference), My products in the item's `sell`; Compare by type keeps it only until reload.
  - **Shop chips** (product pages only): the shops selling the reference product. With shops
    selected, the market regular price, cheapest now, promo data (often on promo, lowest promo
    price) and so the default selling price come from those shops only (`shopView` in calc.js);
    a selected shop without a 30-day regular price counts with its current price, marked
    "(current price, no regular price)". Shown as "Market: 33.99 ₾ regular at … (your
    selection)". None selected = all shops; if no selected shop sells the product, all shops are
    used and the page says so. The selection is kept on the phone (`pc.shops.v1`) for the next
    product. Cards, Compare by type and the shops table always use all shops.
  - **ALWAYS show the margin % big and first** (red < low, yellow, green ≥ high). Then profit or
    loss per piece; if often on promo, the margin when selling at the lowest promo price (30-day min).
  - The verdict is only a hint: GOOD DEAL ≥ high, NEGOTIATE, AVOID < low, with the good-deal and
    walk-away prices in the supplier's currency. Never block or hide anything.
  - Offers / volume tiers: "N pcs for price" rows; per row price/pc, landed, margin, profit, cash
    needed (landed × pcs), saving vs row 1, months to sell from "my monthly sales".
- **Home list** (`site/js/views/home.js`): a Category dropdown (All, then sections Laundry, Dishes,
  Cleaning, Paper, Personal care, Baby, Other: each section, then its types, with counts; the
  section list is `SECTIONS` in `site/js/state.js`). With no search text it lists every product
  of the category, so the page is never empty. Grid of cards, 2 columns on a phone and 3 from
  768 px, 20 per page, page numbers like 1 … 4 5 6 … 239. Sort: relevance (default when
  searching), name (default otherwise, leading numbers/punctuation ignored), regular price,
  price per unit, biggest price change. Search combines with the category.
- **Compare by type**: same type and unit, size 0.5×–2× of the supplier pack; rows Cheapest
  (the product at the 10th percentile of price per unit, so one odd product can't distort it;
  tapping it lists the whole range, cheapest first), Typical (median), Big brands (median of
  big-brand products).
- **Similar products** (product page): same type and unit, size 0.5×–2×, cheapest per unit, top 5.
- **No match** (home): under every search result list, and big when nothing is found: three
  options. (1) Compare by type, opened with the search text in its type search box (types match
  by label and `@type` aliases, then by the types of matching products; `findTypes` in
  `site/js/search.js`). (2) Search online: a real link to Google with the search text + " ფასი".
  (3) Enter market price myself (`#/my/new?name=…`).
- **My products** (`site/js/my.js` storage, `site/js/views/my.js` screens, `#/my`): a market price
  entered by hand for a product not on Dazoge: name, shelf price in GEL, optional size + unit
  (ml, l, g, kg, pc), source link, note. The full calculator works on it (its "check source"
  link is my link). Saved on the phone (`pc.my.v1`) with the date and the last supplier inputs;
  listed newest first with edit and delete; found by the normal search, marked
  "My price (not Dazoge)".
- **Settings** in localStorage (`pc.settings.v1`): rate overrides, VAT, freight, local delivery
  (fuel) % for GEL suppliers, below market,
  margin levels. The supplier inputs are kept in `pc.deal.v1`.
- **Offline** (`site/sw.js`): app files served from cache and refreshed in the background;
  `data/meta.json` network-first (4 s); other data files are loaded as `?v=<run_id>` and kept until
  the next run. Bump `VERSION` in sw.js when app files change. `?nosw` in the URL skips it.
- Images: image_url, then cdn `/product-images/<barcode>.jpg`, then `.webp`, then a placeholder.
- **Languages: English + Georgian** (`site/js/i18n.js`). An EN / ქა switch in the header; default
  English; the choice is kept on the phone (`pc.lang.v1`). **All interface wording lives in
  `site/i18n/en.json` and `site/i18n/ka.json`** — no interface text in the code. To change a
  wording, edit the value in the file (keep the key and the same keys in both files):
  - `{name}` placeholders are filled in by the code (keep them; the order may change).
  - Keys ending `_one` / `_other` are the singular / plural forms.
  - A few values may contain `<b>` tags (install steps, status lines); keep them balanced.
  - `type.<id>` = product type names, `section.<id>` / `section_all.<id>` = category groups,
    `date.months` = 12 short month names, comma-separated.
  - Units stay as written: ml, l, g, kg; "pc" is `unit.pc` (ც in Georgian).
  - After editing, bump `VERSION` in `site/sw.js` so phones pick up the new wording.
  Never translated: product names, shop names and anything else from Dazoge. Search, filters,
  sorting and the calculator do not depend on the language (search matches the English type
  labels from the data and aliases.txt in both alphabets). Georgian has no capital letters, so no
  CSS `text-transform: uppercase` for it (it would switch to Mtavruli).
- **Installable app "PriceCheck"** (PWA): `site/manifest.webmanifest` (id, start_url and scope
  `/pricecheck/`, standalone, theme #1f6f5c, background #f6f6f2). Icons in `site/icons/`: a green
  price tag; `icon.svg` (favicon), 192/512 PNGs, maskable 192/512 (tag inside the safe circle),
  `apple-touch-icon.png` (180). iPhone meta tags: full screen, black-translucent status bar over the
  green header (the header already pads for the safe area). Install help (`site/js/install.js`):
  an "Install app" button in the header when Chrome offers it (`beforeinstallprompt`, caught early
  by an inline script in index.html); on iPhone Safari only, a closable banner, hidden for 14 days
  after closing (`pc.iosbanner.closed`); on computers an "Open on phone" QR code in the footer,
  made in the page by `site/js/qr.js` (byte mode, level M). `#/install` = How to install, linked
  from the footer. On iPhone the installed app has its own storage, separate from Safari.

## Layout
- `scraper/update.js`, `scraper/build.js`, `scraper/lib/dazoge.js`: the pipeline.
- `scraper/run_update.ps1`, `scraper/install_shortcuts.ps1`: the PC launcher and shortcuts.
- `scraper/types/`: the product-type rules, classifier and report.
- `scraper/dazoge_scrape.js`, `scraper/test_scrape.js`: the original research scraper and the
  feasibility test (kept for reference, not used by the pipeline).
- `site/`: the Pages site (`index.html`, `css/`, `js/` + `js/views/`, `config/` alias and brand
  lists, `sw.js`).
- `data/`: published data, written only by `scraper/update.js`.
