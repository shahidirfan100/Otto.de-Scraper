## Selected API

- Endpoint: `https://www.otto.de/dundee/tilelist`
- Method: GET
- Auth: None (works with standard browser headers)
- Pagination: query param `o` (offset, usually steps of 24) with optional `l=gp`; first page works without `o`
- Fields available: `product.id`, `product.productType`, `product.bestVariationId`, `product.articleNumber`, `product.name`, `product.variationPath`, `product.advertiserLegalName`, `product.funderLegalName`, `product.clickTracking`, `product.featureTracking`, `currentVariationId`, `colors`, `variations[].variationId`, `variations[].brand`, `variations[].name`, `variations[].title.full`, `variations[].canonicalLink`, `variations[].detailPageLink`, `variations[].price.retailPrice`, `variations[].price.comparativePrice`, `variations[].price.suggestedRetailPrice`, `variations[].availability.detail`, `variations[].availability.state`, `variations[].customerReviews.averageRating`, `variations[].customerReviews.amount`, `variations[].image.jpeg`, `variations[].image.webp`, `variations[].pbk`, `variations[].socialProof`, `variations[].saleTags`, `variations[].sustainabilityBadges`, `localListPosition`, `actualListPosition`, `originPosition`, `type`, `payload.pagination.currentOffset`, `payload.pagination.lastPage`, `payload.rankedCount`, `payload.sponsoredCount`, `payload.displayCount`
- Fields currently missing in actor: `productType`, `advertiserLegalName`, `funderLegalName`, `clickTracking`, `featureTracking`, `colors`, `localListPosition`, `actualListPosition`, `originPosition`, `pbk`, `socialProof`, `saleTags`, `sustainabilityBadges`, pagination totals (`rankedCount`, `sponsoredCount`, `displayCount`, `lastPage`, `currentOffset`)
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
- Fallback discovery used live page payload inspection and confirmed the same endpoint and route metadata in embedded encoded JSON.
