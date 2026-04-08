# Otto.de Product Scraper

Extract product data from Otto.de quickly and reliably for research, monitoring, and market analysis. Collect structured product records including names, prices, ratings, availability, images, and URLs. Built for production-scale runs with stable pagination and clean output.

## Features

- **Fast Production Runs** — Optimized internal crawl settings for high-throughput data collection.
- **Reliable Product Coverage** — Automatically navigates Otto.de listing pages to gather broad result sets.
- **Rich Product Records** — Collects pricing, brand, rating, review count, availability, and product metadata.
- **Duplicate Protection** — Removes repeated products across paginated result sets.
- **Clean Data Quality** — Excludes null and empty values from output records.
- **Flexible Start Options** — Start from a specific Otto.de page or from a search query.
- **Clean Dataset Output** — Delivers normalized data ready for BI tools and automation workflows.

## Use Cases

### Price Monitoring
Track product prices and discount movement across categories. Use repeated runs to build price history for trend analysis and alerts.

### Competitor and Assortment Research
Measure brand presence, product mix, and offer distribution in relevant categories. Use the dataset to benchmark assortment strategy and market positioning.

### E-commerce Intelligence
Collect structured product data for dashboards and reporting. Combine outputs with your internal data for deeper commercial insights.

### Catalog Enrichment
Use Otto product attributes as reference data to enrich your own product database. Improve completeness for titles, brands, and pricing context.

### Workflow Automation
Feed data into no-code or API workflows for downstream processing. Automate reporting, syncing, and decision-support pipelines.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | `""` | Otto.de start page URL. If provided, this is used first. |
| `searchQuery` | String | No | `"shirt"` | Search term used when `startUrl` is empty. |
| `collectDetails` | Boolean | No | `true` | Prioritizes richer product records with complete fields when available. |
| `results_wanted` | Integer | No | `20` | Maximum number of products to collect. |
| `max_pages` | Integer | No | `20` | Maximum number of listing pages to process. |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": false, "apifyProxyGroups": ["RESIDENTIAL"]}` | Proxy settings for reliability and anti-blocking support. |

---

## Output Data

Each dataset item contains:

| Field | Type | Description |
|-------|------|-------------|
| `name` | String | Product title. |
| `brand` | String | Brand name. |
| `price` | String | Current price value. |
| `original_price` | String | Previous or comparison price when available. |
| `rating` | Number | Average customer rating. |
| `review_count` | Number | Number of customer reviews. |
| `availability` | String | Product availability text. |
| `image_url` | String | Product image URL. |
| `product_url` | String | Product detail page URL. |
| `url` | String | Canonical source URL for the record. |
| `product_id` | String | Internal product identifier. |
| `product_type` | String | Product classification (for example organic or sponsored). |
| `article_number` | String | Product/article identifier when available. |
| `variation_id` | String | Variation identifier when available. |
| `advertiser_legal_name` | String | Advertiser legal entity for promoted products when available. |
| `funder_legal_name` | String | Funder legal entity for promoted products when available. |
| `local_list_position` | Number | Product position inside the rendered product grid. |
| `actual_list_position` | Number | Absolute position of the item in the result stream. |
| `origin_position` | Number | Original ranking position before layout transforms. |
| `list_type` | String | Listing item type indicator from Otto results. |
| `page_no` | Number | Page index processed in the run loop. |
| `page_offset` | Number | Offset used when loading this record batch. |
| `data_quality` | String | Record completeness marker (`rich` or `basic`). |
| `source` | String | Origin marker for the extracted record. |
| `colors` | Array | Available color metadata for the item when available. |
| `pbk` | String | Product base class marker when available. |
| `sale_tags` | Array | Sales or campaign tags attached to the variation when available. |
| `social_proof` | Object | Social proof metadata when provided by source data. |
| `sustainability_badges` | Array | Sustainability labels for the variation when available. |
| `click_tracking` | Object | Tracking attributes tied to item click analytics. |
| `feature_tracking` | Object | Tracking attributes tied to ranking and feature analytics. |

---

## Usage Examples

### Basic Search Run

Collect products from a standard search query:

```json
{
    "searchQuery": "shirt",
    "results_wanted": 100
}
```

### Start From Specific URL

Use a known Otto search or category URL:

```json
{
    "startUrl": "https://www.otto.de/suche/sneaker/?o=0&l=gp&c=",
    "results_wanted": 200,
    "max_pages": 15
}
```

### High-Volume Collection

Collect a larger dataset for analysis:

```json
{
    "searchQuery": "herren t-shirt",
    "results_wanted": 1000,
    "max_pages": 50,
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}
```

---

## Sample Output

```json
{
    "name": "Tommy Hilfiger Big & Tall T-Shirt BT-BRAND LOVE BIG HILFIGER Rundhals, normale Passform, Große Größen",
    "brand": "Tommy Hilfiger Big & Tall",
    "price": 28.99,
    "original_price": 39.9,
    "rating": 5,
    "review_count": 4,
    "availability": "lieferbar - in 1-2 Werktagen bei dir",
    "image_url": "https://i.otto.de/i/otto/470ac366-4969-5bae-9ee4-0a7124ccd145?$responsive_ft2$",
    "product_url": "https://www.otto.de/p/tommy-hilfiger-big-tall-t-shirt-bt-brand-love-big-hilfiger-rundhals-normale-passform-grosse-groessen-1975656957/",
    "url": "https://www.otto.de/p/tommy-hilfiger-big-tall-t-shirt-bt-brand-love-big-hilfiger-rundhals-normale-passform-grosse-groessen-1975656957/",
    "product_id": "1975656957",
    "product_type": "organic",
    "article_number": "59868001",
    "variation_id": "1975656958",
    "local_list_position": 14,
    "actual_list_position": 14,
    "origin_position": 14,
    "list_type": "AS",
    "page_no": 1,
    "page_offset": 0,
    "data_quality": "rich",
    "source": "dundee_tilelist_api"
}
```

---

## Tips for Best Results

### Start With Focused Queries

- Use specific keywords to improve relevance.
- Begin with one category or intent per run.
- Expand query variants after validating output quality.

### Balance Scale and Precision

- Use smaller `results_wanted` during testing.
- Increase `max_pages` for larger production runs.
- Schedule repeated runs for continuous monitoring.

### Use Proxies for Reliability

- Enable residential proxy groups for larger collections.
- Keep proxy settings consistent across scheduled runs.
- Monitor failed requests and adjust run size if needed.

### Validate Sample Records Early

- Check first items for field completeness.
- Confirm `price`, `brand`, and `product_url` are populated.
- Tune input scope before high-volume execution.

---

## Integrations

Connect your output with:

- **Google Sheets** — Build live price and catalog trackers.
- **Airtable** — Create searchable product intelligence bases.
- **Slack** — Send run summaries and alerts.
- **Webhooks** — Push records into custom endpoints.
- **Make** — Automate post-processing pipelines.
- **Zapier** — Trigger downstream business workflows.

### Export Formats

- **JSON** — For APIs and backend systems.
- **CSV** — For spreadsheet analysis.
- **Excel** — For business reporting.
- **XML** — For system-to-system integrations.

---

## Frequently Asked Questions

### How many products can I collect per run?
You can scale from small tests to large production runs. Practical volume depends on query scope, page limits, and reliability settings.

### Can I scrape categories instead of search terms?
Yes. Provide a category or filtered listing URL in `startUrl`.

### Why are some fields occasionally empty?
Some products may not expose every attribute at runtime. The actor still returns available fields in a consistent structure.

### Is duplicate data prevented?
Yes. The actor deduplicates products across pages and emits only unique records in a run.

### Should I use proxies?
For small tests, direct requests may work. For large or scheduled runs, proxies are recommended for higher stability.

### Can I automate this daily?
Yes. Use Apify schedules to run hourly, daily, or weekly based on your monitoring requirements.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with Otto.de terms of service and applicable laws. Use collected data responsibly and respect rate limits.
