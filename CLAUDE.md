# pricecheck

## Goal
A database of Georgian household-goods retail prices (source: dazoge.info), plus a calculator that
answers TAKE IT / NEGOTIATE / AVOID for any supplier price entered. The website is on GitHub Pages:
https://vakosv.github.io/pricecheck/ (public repo, free, no server).

## Scope
- Source: dazoge.info only, subcategories c/100, c/101, c/102, c/104, c/105, c/106, c/108.
- The Alfa supplier list is **out of scope**. Do not reference or import it anywhere.

## Rules
- Scraping: respect robots.txt (never request `/search` or `/api/`), at most 1 request per 1.1 s,
  retries with backoff, resumable.
- Never guess data: a missing field stays empty.
- Images: hotlink the `cdn.dazoge.info/product-images/...` URLs (from `og:image`). Do not download
  or store them.
- Commit in small steps with clear messages. Never commit scraped CSVs or resume state (see
  `.gitignore`). Only the compact history goes in `/data`.
- gh is not installed on the dev PC. Start workflows by pushing a change to a `.trigger/*` file.

## Status (2026-11-09)
- dazoge.info is behind Cloudflare, which blocks GitHub-hosted runners: every request gets HTTP 403
  with `cf-mitigated: challenge` ("Just a moment..."). The same requests from the dev PC get 200.
  So scraping cannot run on GitHub Actions. The planned fallback is to run the scraper on the PC
  and push the data. Phase 1 (daily pipeline) is on hold until that decision is made.
- GitHub Pages deploys from Actions and works (placeholder page in `/site`).

## Layout
- `scraper/dazoge_scrape.js`: full scraper (copied from the research folder; writes CSVs to the cwd).
- `scraper/test_scrape.js` + `.github/workflows/test-scrape.yml`: ~200-product feasibility test.
  It also deploys `/site` to Pages. Trigger it by pushing a change to `.trigger/test-run`.
- `scraper/types/product_types.js`: **the editable product-type rules** (first matching rule wins).
  `scraper/types/classify_types.js <market_prices.csv>` writes `scraper/types/out/` (git-ignored):
  `product_types.csv` and `report.md` (count per type, % other, 10 examples per type).
- `site/`: the Pages site.

## Product types
46 requested types, plus laundry additives, cleaning brushes and hair care (unclear), plus 10 extra
types marked `extra: true` (hair dye, nail care, makeup, perfume, face care, hair styling,
hosiery, hair accessories, insecticide, shoe care). Reusable c/108 kitchenware stays "other".
Sub-details: laundry colour/white/black/delicate…, wipes baby/surface/intimate…, paper ply + count,
laundry additive kind.

## Planned data format (Phase 1, not built yet)
`products.json`, one record per barcode: barcode, name, subcategory, type + sub-detail, size, unit
(l/kg/pc), image_url, link, regular_price + store (lowest store 30-day regular price),
cheapest_now + store, promo_now, often_on_promo (any store on promo on ≥ 33% of its history days),
min_30d, store count, price_per_unit, a per-store list (store, price, regular_30d, promo days,
link), the price change vs the previous run, and status (active / not listed since date).
Plus `/data/history` (changes only), `changes_today.json`, and `rates.json` (National Bank of
Georgia USD/EUR/TRY to GEL, with date).
