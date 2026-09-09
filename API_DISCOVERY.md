## Selected API

- Bootstrap route: `https://www.otto.de/dundee/tilelist` (used only to discover the current search `rule` and sort order)
- Product endpoint: `https://www.otto.de/everglades/products`
- Enrichment endpoint: `https://www.otto.de/crocotile/tile/data?variationIds=...`
- Method: GET for both endpoints
- Auth: None (works with Impit Chrome and Firefox profiles using the page referer)
- Product request query: repeated `intents` values plus `rule`, optional `ranked.offset`, and optional `ranked.sortOrder`
- Pagination: `ranked.offset` (actor advances in steps of 24); the first request omits the offset
- Enrichment headers: `crocotile-version: 2` and `otto-feature: tilelist@RepTile-Dundee`
- Enrichment recovery: variation IDs are requested in batches of 24. If Crocotile rejects a batch with HTTP 400, the actor bisects that batch to isolate unsupported IDs while preserving rich records for valid IDs; only unrecoverable IDs use the existing basic-record fallback.
- Fields available: `product.id`, `product.productType`, `product.bestVariationId`, `product.articleNumber`, `product.name`, `product.variationPath`, `product.advertiserLegalName`, `product.funderLegalName`, `product.clickTracking`, `product.featureTracking`, `currentVariationId`, `colors`, `variations[].variationId`, `variations[].brand`, `variations[].name`, `variations[].title.full`, `variations[].canonicalLink`, `variations[].detailPageLink`, `variations[].price.retailPrice`, `variations[].price.comparativePrice`, `variations[].price.suggestedRetailPrice`, `variations[].availability.detail`, `variations[].availability.state`, `variations[].customerReviews.averageRating`, `variations[].customerReviews.amount`, `variations[].image.jpeg`, `variations[].image.webp`, `variations[].pbk`, `variations[].socialProof`, `variations[].saleTags`, `variations[].sustainabilityBadges`, `localListPosition`, `actualListPosition`, `originPosition`, `type`, `intents[].meta.offset`, `intents[].meta.limit`, `intents[].meta.sortOrder`, `intents[].count`
- The current actor maps the product, variation, tracking, position, and enrichment fields listed above. The API also exposes ranking counts and offsets in each intent's metadata; the actor uses the offset for pagination.
- Field count: 40+ unique fields (vs existing ~14 fields)

## API Scoring

- Returns JSON directly: +30
- Has >15 unique fields: +25
- No auth required: +20
- Has pagination support: +15
- Matches or extends current fields: +10
- Total score: 100

## Notes

- URLScan search for Otto search pages returned no usable scan entries for `/suche/...`; direct scan submission required API key in this environment.
- Fallback discovery used live page payload inspection and the current Dundee frontend bundle. The bundle confirms that the old tilelist route is a bootstrap/session wrapper, while product data comes from Everglades and variation data from Crocotile.
