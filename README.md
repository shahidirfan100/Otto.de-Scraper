## What does Otto.de Product Scraper do?

Otto.de Product Scraper collects structured product listings from Otto.de search and category pages. Enter a search term such as `sneaker` or provide a public Otto.de listing URL, then receive product names, brands, prices, discounts, ratings, availability, images, product links, ranking positions, and catalog identifiers in an Apify dataset.

The dataset is useful for German e-commerce research, price monitoring, assortment analysis, catalog enrichment, competitor tracking, and recurring product reports. Results can be reviewed in Apify, downloaded in common formats, or connected to an automated workflow.

## Why use Otto.de Product Scraper?

- **Price monitoring** - Compare current and previous prices across repeated runs and identify discount movement.
- **Assortment research** - Study the products, brands, categories, and sponsored listings visible for an Otto.de search.
- **Catalog enrichment** - Add product names, brands, images, identifiers, availability, and source links to an existing catalog.
- **Ranking analysis** - Use listing positions, page numbers, and offsets to understand where products appear in search results.
- **Clean dataset output** - Duplicate products are removed during a run and empty values are omitted from saved records.
- **Repeatable workflows** - Run the Actor on demand or schedule it for daily, weekly, or other recurring monitoring.

## What data can you extract from Otto.de?

Each dataset item represents one unique product listing found on the supplied search or category page. Product attributes that Otto.de does not publish for a particular listing are omitted from that item.

| Field | Type | Description |
|-------|------|-------------|
| `name` | String | Product title. |
| `brand` | String | Brand name when available. |
| `price` | Number | Current product price. |
| `original_price` | Number | Previous, comparison, or suggested price when available. |
| `rating` | Number | Average customer rating. |
| `review_count` | Integer | Number of customer reviews. |
| `availability` | String | Availability or delivery message. |
| `image_url` | String | Main product image URL. |
| `product_url` | String | Direct Otto.de product page URL. |
| `url` | String | Canonical source URL for the product record. |
| `product_id` | String | Otto.de product identifier. |
| `product_type` | String | Listing classification, such as organic or sponsored. |
| `article_number` | String | Product or article number when available. |
| `variation_id` | String | Selected product variation identifier. |
| `advertiser_legal_name` | String | Advertiser legal entity for promoted listings when available. |
| `funder_legal_name` | String | Funder legal entity for promoted listings when available. |
| `local_list_position` | Integer | Position within the current product grid. |
| `actual_list_position` | Integer | Absolute position in the result stream. |
| `origin_position` | Integer | Original ranking position when provided. |
| `list_type` | String | Otto.de listing item type. |
| `page_no` | Integer | Listing page processed for the record. |
| `page_offset` | Integer | Result offset used for the record batch. |
| `data_quality` | String | Record completeness marker, such as `rich` or `basic`. |
| `colors` | Array | Available color names or color metadata when available. |
| `pbk` | String | Product classification value when supplied by Otto.de. |
| `sale_tags` | Array | Sale or campaign labels attached to the product. |
| `social_proof` | Object | Social-proof information when available. |
| `sustainability_badges` | Array | Sustainability labels shown for the product. |
| `click_tracking` | Object | Product click metadata when available. |
| `feature_tracking` | Object | Product feature and ranking metadata when available. |

## How to scrape Otto.de product data

1. Open Otto.de Product Scraper on Apify.
2. Enter a public Otto.de search or category URL in `startUrl`, or enter a product term in `searchQuery`.
3. Set `results_wanted` and `max_pages` for the size of the collection.
4. Enable `collectDetails` when you want to prefer richer records with variation, price, rating, and availability information.
5. Run the Actor and inspect the dataset preview.
6. Download the dataset or connect it to an API, webhook, spreadsheet, or automation workflow.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | `""` | Public Otto.de search or category URL. When provided, it is used as the starting page. |
| `searchQuery` | String | No | `""` | Search term used to build an Otto.de search URL when `startUrl` is empty. |
| `collectDetails` | Boolean | No | `true` | Prefer records with richer product variation, price, rating, availability, and catalog information. |
| `results_wanted` | Integer | No | `20` | Maximum number of unique products to save. Minimum value is `1`. |
| `max_pages` | Integer | No | `20` | Maximum number of paginated listing pages to process. Minimum value is `1`. |

Provide either `startUrl` or `searchQuery`, not both. If neither is supplied, the Actor uses the configured start URL fallback from the input schema or `INPUT.json`. The Actor accepts only Otto.de URLs in `startUrl`.

## Usage Examples

### Basic Search Collection

Collect up to 50 products for a German-language search term:

```json
{
  "searchQuery": "sneaker",
  "results_wanted": 50,
  "max_pages": 5
}
```

### Start From a Category or Filtered URL

Reuse an Otto.de search or category URL when you need the website's existing filters:

```json
{
  "startUrl": "https://www.otto.de/suche/sneaker/?o=0&l=gp&c=",
  "results_wanted": 200,
  "max_pages": 10
}
```

### Larger Collection With Rich Records

Collect a broader product dataset:

```json
{
  "searchQuery": "herren t-shirt",
  "collectDetails": true,
  "results_wanted": 500,
  "max_pages": 25
}
```

## Sample Output

This example shows one representative dataset item. Optional product, campaign, and tracking fields may be absent when Otto.de does not provide them.

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
  "data_quality": "rich"
}
```

## Tips for Best Results

- Use focused German search terms, such as `kaffeemaschine`, `running schuhe`, or `herren jacke`.
- Start with `results_wanted` between 20 and 50 to confirm the page and review the dataset before scaling up.
- Use a category or filtered listing URL when you need a narrower assortment than a broad keyword provides.
- Increase `max_pages` for larger collections, but keep it aligned with the number of products you actually need.
- Compare `price`, `original_price`, `availability`, and `product_url` across scheduled datasets for price and catalog monitoring.
- Check several records before assuming a field is unavailable. Otto.de does not publish every attribute for every listing.

- Report persistent field or availability issues through the Actor's Issues tab because public pages can change.

## Integrations and Export Formats

- **Apify API** - Read dataset items programmatically after a run.
- **Google Sheets** - Export product records for sorting, filtering, and price comparisons.
- **Airtable** - Build a searchable product catalog or snapshot database.
- **Webhooks** - Trigger downstream processing or notifications after a run finishes.
- **Make and Zapier** - Connect Otto.de data to no-code workflows.
- **JSON, CSV, Excel, and XML** - Download records for applications, spreadsheets, reporting, and system imports.

## Frequently Asked Questions

### Can I scrape Otto.de category pages?

Yes. Provide a public category or filtered listing URL in `startUrl` and the Actor collects products from that page and its subsequent result pages.

### Can I use a search term instead of a URL?

Yes. Enter a term in `searchQuery`, such as `laptop`, `sofa`, or `damen kleid`. The Actor builds the corresponding Otto.de search URL when `startUrl` is empty.

### How many products can I collect per run?

You can collect up to the number allowed by `results_wanted` and `max_pages`. The final count may be lower when Otto.de provides fewer unique listings or when a page has no new products.

### Why are some product fields missing?

Some listings do not publish every attribute. The Actor saves the fields available for each product and omits empty values from the dataset item.

### Does the Actor remove duplicate products?

Yes. Products are deduplicated across the pages processed in the same run, using the product URL or available product identifiers.

### Can I run Otto.de monitoring on a schedule?

Yes. Create an Apify schedule to refresh the same search or category dataset hourly, daily, weekly, or at another interval that fits your workflow.

### Is it legal to collect Otto.de product data?

Collecting public product information can be lawful, but you are responsible for complying with Otto.de terms, applicable laws, privacy requirements, and any limits that apply to your use case.

## Related Actors

- [ASOS Product Scraper](https://apify.com/shahidirfan/asos-product-scraper) - Collect fashion product, price, discount, and catalog data from ASOS.
- [Namshi Product Scraper](https://apify.com/shahidirfan/namshi-product-scraper) - Extract fashion and beauty product data from Namshi search and collection pages.
- [Shein Product Scraper](https://apify.com/shahidirfan/shein-product-scraper) - Gather product identifiers, prices, discounts, images, and listing metadata from Shein.
- [Tokopedia Search Scraper](https://apify.com/shahidirfan/tokopedia-search-scraper) - Collect marketplace search results with product prices, ratings, seller data, and category information.

## Support

For issues, feature requests, or custom Actor work, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is designed for legitimate data collection from publicly available Otto.de product listings. Users are responsible for using the data responsibly and complying with Otto.de terms of service, applicable laws, privacy rules, and other relevant requirements.
