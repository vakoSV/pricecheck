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
- **The types:**
  - The 46 requested types, plus laundry additives, cleaning brushes and hair care (unclear).
  - 10 extra types marked `extra: true`: hair dye, nail care, makeup, perfume, face care, hair
    styling, hosiery, hair accessories, insecticide, shoe care.
  - Reusable c/108 kitchenware stays "other". Target: other < 5%.

## Phase 2: the real website (not built yet)
- **Search:** Latin and Georgian, typo tolerant.
- **Product page:** per-store prices and history (`history30` plus our change history), images,
  and similar products by type and price per unit.
- **Other pages and settings:** a changes-today list. Settings are saved on the phone
  (localStorage).
- **Calculator (in the browser):**
  - Inputs: supplier price, currency (USD/EUR/TRY), per piece / box / pallet, pack size.
  - Landed cost per piece = supplier price per piece × NBG rate × 1.18 (VAT) × 1.10 (freight).
  - Sell price = market regular price × 0.85, scaled per unit (price per l/kg/pc) when the
    supplier's size differs from the market product's size.
  - **ALWAYS show the margin % big and first.** Then the profit or loss per piece in GEL, and also
    the margin at the promo price if the product is often on promo.
  - The verdict is only a suggestion shown under that: GOOD DEAL ≥ 35%, NEGOTIATE 25–35%,
    AVOID < 25%, with the good-deal price and the walk-away price. Never block or hide
    anything: the owner may take low-margin products on purpose.
  - All settings are editable: rate override, VAT, freight %, discount vs market, margin levels.

## Layout
- `scraper/update.js`, `scraper/build.js`, `scraper/lib/dazoge.js`: the pipeline.
- `scraper/run_update.ps1`, `scraper/install_shortcuts.ps1`: the PC launcher and shortcuts.
- `scraper/types/`: the product-type rules, classifier and report.
- `scraper/dazoge_scrape.js`, `scraper/test_scrape.js`: the original research scraper and the
  feasibility test (kept for reference, not used by the pipeline).
- `site/`: the Pages site (currently a placeholder that reads `data/meta.json`).
- `data/`: published data, written only by `scraper/update.js`.
