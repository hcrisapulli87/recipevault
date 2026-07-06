# Food Search — Australian Relevance, Brands, Barcode-Miss Flow — Design

**Date:** 2026-07-06
**Status:** Approved (Harrison: "design this and go ahead with the implementation").

## Problems (Harrison's report)

1. Manual food search returns obscure foreign-language results ("tuna in oil" →
   "Thon a lhuile", "Thunfisch Filets in Sonnenblumenöl").
2. No Australian relevance — he shops Australian supermarkets.
3. Wants brand search ("sliced bread — Tip Top").
4. Wants the barcode scanner to cover more products.

## Spike findings (live OFF queries, 2026-07-06)

- Root cause of 1–2: the app queries `world.openfoodfacts.org/cgi/search.pl`
  unranked and unfiltered. OFF is French-dominated; unranked global text search
  surfaces French/German entries first. Reproduced Harrison's exact complaint.
- Australia-filtered + popularity-sorted search returns John West / Sirena /
  Greenseas / Woolworths for "tuna in oil" — shelf-accurate.
- OFF's newer **Search-a-licious** API (`search.openfoodfacts.org/search`) has
  the best ranking and indexes brands in plain free text: "tip top bread" →
  Tip Top white bread / 9 Grain / damper rolls. The legacy cgi endpoint
  rate-limits aggressively (repeated 503s at ~10 req/min, sticky) — it 503'd
  three times during the spike; SaL never did.
- **SaL sends no `Access-Control-Allow-Origin`** → browsers can't call it
  directly. The legacy endpoint does (`*`). So the better API needs a proxy.
- SaL result shape differs from legacy: `hits` not `products`, `brands` is an
  ARRAY. Nutriments are per-100g keys (`energy-kcal_100g` etc.) — the existing
  `mapOffProduct` already handles those and derives per-serving values.
- Barcode formats: the scanner already reads EAN-13/EAN-8/UPC-A/UPC-E — the
  complete retail food family. "Scan doesn't work" = the product is missing
  from OFF's AU coverage, not a scanner limitation.

## Design

### 1. `api/food-search.ts` (new Vercel function)

`GET /api/food-search?q=…` → `{ ok: true, products: OffProduct[] } | { ok:false, message }`.
Mirrors `api/scrape.ts` conventions: same structural req/res types, same CORS
allowlist (`SCRAPE_ALLOWED_ORIGINS` env var + `'null'` for Electron — one
allowlist for all our functions), OPTIONS preflight, 10s timeout, errors
collapse to a generic message.

Query strategy (server-side):
1. SaL with `q=<terms> countries_tags:"en:australia"`, `langs=en`,
   `page_size=20`, fields = the app's existing OFF field list.
2. If AU hits < 8, also query without the country filter and append
   (AU coverage is ~15× thinner than global; imports stay findable).
3. Merge + dedupe by `code`, AU hits first; normalise each SaL hit to the
   legacy `OffProduct` shape (join the `brands` array to a comma string) so
   the client's tested `mapOffProduct` is unchanged.

The merge/normalise logic lives in a pure shared module
(`src/shared/food-search.ts`) so it's unit-testable; the Vercel handler stays
a thin fetch wrapper. Country is a hardcoded const (`en:australia`) — no
settings toggle (YAGNI; Harrison lives in one country).

### 2. Client (`data/foods.ts`)

`searchFoods` calls the proxy instead of OFF directly. Endpoint resolution
follows the scrape.ts pattern: DEV → same-origin `/api/food-search` (the vite
dev proxy already forwards all of `/api` to the deployed origin); production →
derived from `VITE_SCRAPE_URL` by swapping the trailing `scrape` for
`food-search` (no new env var for the desktop build). Staples-first merge and
offline degradation are unchanged. Barcode lookup keeps calling OFF's v2
product endpoint directly (it has `ACAO: *` and isn't the rate-limited one).

The `food_cache` upsert inside `lookupBarcode` is extracted to an exported
`cacheFood(item)` so the modal (below) can reuse it.

### 3. Barcode-miss → add-it-once flow (AddFoodModal)

On "No product found for barcode X": keep the message, add a button
"Add it manually — saves for next scan". It remembers the scanned barcode,
switches to the Manual tab, and on save attaches the barcode to the entry AND
upserts it into the per-user `food_cache`. Next scan of that product resolves
instantly from the cache. The household builds its own AU barcode coverage as
a side effect of normal logging — automatic capture, no new optional fields.

### 4. Explicitly not doing

- No scanner format changes (already complete for retail food).
- No schema changes (`food_cache` already keys `owner_id,barcode`).
- No brand field in the UI — brand terms are typed in the one search box
  (proven to work in SaL free text); results already show a brand chip.
- No second nutrition database (USDA etc.) — OFF + own-cache first; revisit
  only if coverage still hurts.

## Deploy order

No schema step. Merge → plain push → Vercel deploys the new function. The
dev proxy and the production desktop build both point at the deployed
function, so live verification happens post-deploy (search "tuna in oil",
expect Sirena/John West; search "tip top bread", expect Tip Top).

## Testing

- Unit: `src/shared/food-search.ts` — SaL hit normalisation (brands array →
  string), AU-first merge, dedupe by code, thin-AU fallback trigger.
- Unit: `searchFoods` with a stubbed `fetch` — staples-first merge, dedupe by
  name, offline degrade to staples; `cacheFood` upsert payload (supabase mock).
- Post-deploy: the two live searches above + a barcode-miss manual add.
