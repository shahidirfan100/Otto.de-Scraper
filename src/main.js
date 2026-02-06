import { Actor } from 'apify';
import log from '@apify/log';
import { CheerioCrawler } from 'crawlee';
import { HeaderGenerator } from 'header-generator';

const OTTO_ORIGIN = 'https://www.otto.de';
const DEFAULT_SEARCH_QUERY = 'shirt';
const DEFAULT_RESULTS_WANTED = 100;
const DEFAULT_MAX_PAGES = 20;
const INTERNAL_OFFSET_STEP = 24;
const INTERNAL_MAX_CONCURRENCY = 16;
const INTERNAL_MIN_DELAY_MS = 140;
const INTERNAL_MAX_DELAY_MS = 420;
const PREFETCH_WINDOW_PAGES = 8;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const asCleanString = (value) => {
    if (value === null || value === undefined) return null;
    const cleaned = String(value).replace(/\s+/g, ' ').trim();
    return cleaned || null;
};

const asNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
};

const asInteger = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const parsePositiveInt = (value, fallback) => {
    const parsed = asInteger(value);
    if (!parsed || parsed < 1) return fallback;
    return parsed;
};

const toAbsoluteUrl = (href, base = OTTO_ORIGIN) => {
    if (!href) return null;
    try {
        return new URL(href, base).href;
    } catch {
        return null;
    }
};

const normalizePrice = (value) => {
    const raw = asCleanString(value);
    if (!raw) return null;

    let sanitized = raw.replace(/[^\d,.-]/g, '');
    if (!sanitized) return null;

    if (sanitized.includes(',') && sanitized.includes('.')) {
        sanitized = sanitized.replace(/\./g, '').replace(',', '.');
    } else if (sanitized.includes(',')) {
        sanitized = sanitized.replace(',', '.');
    }

    return Number.isFinite(Number.parseFloat(sanitized)) ? sanitized : null;
};

const buildSearchUrl = (query) => {
    const term = asCleanString(query) || DEFAULT_SEARCH_QUERY;
    const searchUrl = new URL(`/suche/${encodeURIComponent(term)}/`, OTTO_ORIGIN);
    searchUrl.searchParams.set('o', '0');
    searchUrl.searchParams.set('l', 'gp');
    searchUrl.searchParams.set('c', '');
    return searchUrl.href;
};

const decodeMaybeUriComponent = (text, maxDepth = 4) => {
    let decoded = text;
    for (let i = 0; i < maxDepth; i += 1) {
        try {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        } catch {
            break;
        }
    }
    return decoded;
};

const safeJsonParse = (text) => {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

const looksBlocked = ({ statusCode, title, body }) => {
    if ([202, 403, 429, 503].includes(statusCode)) return true;
    const titleText = (title || '').toLowerCase();
    if (/(access denied|captcha|robot check|forbidden)/i.test(titleText)) return true;
    const html = (body || '').toLowerCase();
    return html.includes('awswafcookiedomainlist') || html.includes('challenge.js');
};

const extractTilelistPayload = ($) => {
    let payload = null;

    $('script').each((_, el) => {
        if (payload) return;
        const rawScript = ($(el).html() || '').trim();
        if (!rawScript) return;
        if (!rawScript.includes('/tilelist') && !rawScript.includes('%2Ftilelist')) return;

        const decoded = decodeMaybeUriComponent(rawScript, 4);
        const parsed = safeJsonParse(decoded) || safeJsonParse(rawScript);
        const candidate = parsed?.data?.result?.payload;

        if (parsed?.routeId === '/tilelist' && candidate && Array.isArray(candidate.tileListItems)) {
            payload = candidate;
        }
    });

    return payload;
};

const buildItemFromTile = (tile, pageUrl) => {
    const product = tile?.product || {};
    const variations = Array.isArray(tile?.variations) ? tile.variations : [];
    const currentVariation = variations.find((v) => String(v?.variationId || '') === String(tile?.currentVariationId || ''))
        || variations[0]
        || null;

    const detailPath = currentVariation?.canonicalLink
        || currentVariation?.detailPageLink
        || product?.variationPath
        || null;
    const productUrl = toAbsoluteUrl(detailPath, pageUrl);

    if (!productUrl) return null;

    const priceObject = currentVariation?.price || {};
    const ratingObject = currentVariation?.customerReviews || {};
    const availabilityObject = currentVariation?.availability || {};
    const imageObject = currentVariation?.image || {};

    return {
        name: asCleanString(currentVariation?.title?.full || currentVariation?.name || product?.name),
        brand: asCleanString(currentVariation?.brand),
        price: normalizePrice(priceObject?.retailPrice),
        original_price: normalizePrice(priceObject?.comparativePrice || priceObject?.suggestedRetailPrice),
        rating: asNumber(ratingObject?.averageRating),
        review_count: asInteger(ratingObject?.amount),
        availability: asCleanString(availabilityObject?.detail || availabilityObject?.state),
        image_url: toAbsoluteUrl(imageObject?.jpeg || imageObject?.webp, pageUrl),
        product_url: productUrl,
        url: productUrl,
        article_number: asCleanString(product?.articleNumber),
        variation_id: asCleanString(currentVariation?.variationId || product?.bestVariationId),
        data_quality: currentVariation ? 'rich' : 'basic',
        source: 'tilelist',
    };
};

const extractItemsFromTilelist = (payload, pageUrl) => {
    const tileListItems = Array.isArray(payload?.tileListItems) ? payload.tileListItems : [];
    return tileListItems
        .map((tile) => buildItemFromTile(tile, pageUrl))
        .filter(Boolean);
};

const extractItemsFromJsonLd = ($, pageUrl) => {
    const items = [];

    $('script[type="application/ld+json"]').each((_, el) => {
        const parsed = safeJsonParse(($(el).text() || '').trim());
        const entries = Array.isArray(parsed) ? parsed : [parsed];

        for (const entry of entries) {
            if (!entry || entry['@type'] !== 'Product') continue;

            const offers = Array.isArray(entry.offers) ? entry.offers[0] : entry.offers;
            const brand = typeof entry.brand === 'string' ? entry.brand : entry.brand?.name;
            const image = Array.isArray(entry.image) ? entry.image[0] : entry.image;
            const productUrl = toAbsoluteUrl(entry.url, pageUrl);

            if (!productUrl) continue;

            items.push({
                name: asCleanString(entry.name),
                brand: asCleanString(brand),
                price: normalizePrice(offers?.price),
                original_price: null,
                rating: asNumber(entry.aggregateRating?.ratingValue),
                review_count: asInteger(entry.aggregateRating?.reviewCount),
                availability: asCleanString(offers?.availability),
                image_url: toAbsoluteUrl(image, pageUrl),
                product_url: productUrl,
                url: productUrl,
                article_number: null,
                variation_id: null,
                data_quality: 'rich',
                source: 'jsonld',
            });
        }
    });

    return items;
};

const extractItemsFromAnchors = ($, pageUrl) => {
    const items = [];
    const seen = new Set();

    $('a[href*="/p/"]').each((_, el) => {
        const href = $(el).attr('href');
        const productUrl = toAbsoluteUrl(href, pageUrl);
        if (!productUrl) return;

        const key = productUrl.replace(/\?.*$/, '');
        if (seen.has(key)) return;
        seen.add(key);

        items.push({
            name: asCleanString($(el).attr('title') || $(el).text()),
            brand: null,
            price: null,
            original_price: null,
            rating: null,
            review_count: null,
            availability: null,
            image_url: null,
            product_url: productUrl,
            url: productUrl,
            article_number: null,
            variation_id: null,
            data_quality: 'basic',
            source: 'anchor',
        });
    });

    return items;
};

const getOffsetFromUrl = (url, fallback = 0) => {
    try {
        const parsedUrl = new URL(url);
        return asInteger(parsedUrl.searchParams.get('o')) ?? fallback;
    } catch {
        return fallback;
    }
};

const buildNextOffsetUrl = ({ currentUrl, pageData, currentPageNo, offsetStep }) => {
    const parsedUrl = new URL(currentUrl);
    const currentOffset = asInteger(pageData?.o) ?? getOffsetFromUrl(currentUrl, (currentPageNo - 1) * offsetStep);
    const nextOffset = currentOffset + offsetStep;

    parsedUrl.searchParams.set('o', String(nextOffset));

    if (asCleanString(pageData?.l)) parsedUrl.searchParams.set('l', String(pageData.l));
    if (pageData?.c !== undefined) parsedUrl.searchParams.set('c', String(pageData.c));
    if (asCleanString(pageData?.sortiertnach)) parsedUrl.searchParams.set('sortiertnach', String(pageData.sortiertnach));

    return {
        nextUrl: parsedUrl.href,
        nextOffset,
    };
};

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};

    const startUrl = asCleanString(input.startUrl);
    const searchQuery = asCleanString(input.searchQuery) || DEFAULT_SEARCH_QUERY;
    const collectDetails = input.collectDetails ?? true;
    const resultsWanted = parsePositiveInt(input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = parsePositiveInt(input.max_pages, DEFAULT_MAX_PAGES);
    const offsetStep = INTERNAL_OFFSET_STEP;
    const maxConcurrency = INTERNAL_MAX_CONCURRENCY;
    const minDelayMs = INTERNAL_MIN_DELAY_MS;
    const maxDelayMs = INTERNAL_MAX_DELAY_MS;

    const resolvedStartUrl = startUrl || buildSearchUrl(searchQuery);
    const normalizedStartUrl = new URL(resolvedStartUrl, OTTO_ORIGIN).href;
    const startHost = new URL(normalizedStartUrl).hostname;

    if (!startHost.endsWith('otto.de')) {
        throw new Error(`Invalid startUrl host "${startHost}". Only otto.de URLs are supported.`);
    }

    const proxyConfiguration = input.proxyConfiguration
        ? await Actor.createProxyConfiguration({ ...input.proxyConfiguration })
        : undefined;

    const headerGenerator = new HeaderGenerator({
        browsers: [
            { name: 'chrome', minVersion: 120, maxVersion: 131 },
            { name: 'firefox', minVersion: 115, maxVersion: 128 },
        ],
        devices: ['desktop'],
        operatingSystems: ['windows', 'macos'],
        locales: ['de-DE', 'de', 'en-US'],
    });

    const seenProducts = new Set();
    const seenOffsets = new Set();
    let saved = 0;
    let pushQueue = Promise.resolve();

    const pushItemIfNeeded = async (item) => {
        let pushed = false;
        pushQueue = pushQueue.then(async () => {
            if (saved >= resultsWanted) return;
            await Actor.pushData(item);
            saved += 1;
            pushed = true;
        });
        await pushQueue;
        return pushed;
    };

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxRequestRetries: 5,
        requestHandlerTimeoutSecs: 90,
        maxConcurrency,
        useSessionPool: true,
        sessionPoolOptions: {
            maxPoolSize: 80,
            sessionOptions: {
                maxUsageCount: 25,
                maxErrorScore: 3,
            },
        },
        preNavigationHooks: [
            async ({ request }, gotOptions) => {
                const generatedHeaders = headerGenerator.getHeaders();
                gotOptions.headers = {
                    ...generatedHeaders,
                    ...gotOptions.headers,
                    'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
                    referer: request.url,
                };
                gotOptions.timeout = { request: 45000 };
                gotOptions.retry = { limit: 0 };

                const jitter = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1));
                await sleep(minDelayMs + jitter);
            },
        ],
        errorHandler: async ({ request }, error) => {
            const retryCount = request.retryCount ?? 0;
            const backoffMs = Math.min(15000, 600 * (2 ** retryCount)) + Math.floor(Math.random() * 400);
            log.warning(`Retrying ${request.url} after error: ${error.message}. Waiting ${backoffMs} ms.`);
            await sleep(backoffMs);
        },
        failedRequestHandler: async ({ request, error }) => {
            log.softFail(`Request failed after retries: ${request.url} (${error.message})`);
        },
        async requestHandler({ request, response, body, $, addRequests }) {
            if (saved >= resultsWanted) return;

            const pageNo = request.userData?.pageNo || 1;
            const pageTitle = $('title').text().trim();
            const statusCode = response?.statusCode || 0;

            if (looksBlocked({ statusCode, title: pageTitle, body })) {
                throw new Error(`Blocked response detected (status ${statusCode})`);
            }

            const tilelistPayload = extractTilelistPayload($);
            let extracted = [];

            if (tilelistPayload) {
                extracted = extractItemsFromTilelist(tilelistPayload, request.url);
            }

            if (extracted.length === 0) {
                extracted = extractItemsFromJsonLd($, request.url);
            }

            if (extracted.length === 0) {
                extracted = extractItemsFromAnchors($, request.url);
            }

            let pushedRich = 0;
            let pushedBasic = 0;
            const richItems = extracted.filter((item) => item.data_quality === 'rich');
            const basicItems = extracted.filter((item) => item.data_quality !== 'rich');
            const orderedItems = collectDetails ? richItems : extracted;

            for (const item of orderedItems) {
                if (saved >= resultsWanted) break;
                if (!item.product_url) continue;

                const dedupeKey = item.product_url.replace(/\?.*$/, '');
                if (seenProducts.has(dedupeKey)) continue;

                seenProducts.add(dedupeKey);
                const pushed = await pushItemIfNeeded(item);
                if (!pushed) break;

                if (item.data_quality === 'rich') pushedRich += 1;
                else pushedBasic += 1;
            }

            if (collectDetails && pageNo >= maxPages && saved < resultsWanted) {
                for (const item of basicItems) {
                    if (saved >= resultsWanted) break;
                    if (!item.product_url) continue;

                    const dedupeKey = item.product_url.replace(/\?.*$/, '');
                    if (seenProducts.has(dedupeKey)) continue;

                    seenProducts.add(dedupeKey);
                    const pushed = await pushItemIfNeeded(item);
                    if (!pushed) break;
                    pushedBasic += 1;
                }
            }

            log.info(
                `LIST page ${pageNo} ${request.url} -> extracted ${extracted.length}, pushed rich ${pushedRich}, basic ${pushedBasic}, total ${saved}/${resultsWanted}`,
            );

            if (saved >= resultsWanted || pageNo >= maxPages) return;

            const requestsToAdd = [];
            let seedUrl = request.url;
            let seedPage = pageNo;
            let seedPageData = tilelistPayload?.page;

            for (let i = 0; i < PREFETCH_WINDOW_PAGES; i += 1) {
                const next = buildNextOffsetUrl({
                    currentUrl: seedUrl,
                    pageData: seedPageData,
                    currentPageNo: seedPage,
                    offsetStep,
                });

                const nextPageNo = seedPage + 1;
                if (nextPageNo > maxPages) break;

                const offsetKey = `${new URL(next.nextUrl).pathname}|${next.nextOffset}`;
                if (!seenOffsets.has(offsetKey)) {
                    seenOffsets.add(offsetKey);
                    requestsToAdd.push({
                        url: next.nextUrl,
                        uniqueKey: `LIST:${next.nextUrl}`,
                        userData: {
                            label: 'LIST',
                            pageNo: nextPageNo,
                        },
                    });
                }

                seedUrl = next.nextUrl;
                seedPage = nextPageNo;
                seedPageData = {
                    ...(seedPageData || {}),
                    o: String(next.nextOffset),
                };
            }

            if (requestsToAdd.length > 0) {
                await addRequests(requestsToAdd);
            }
        },
    });

    const initialOffsetKey = `${new URL(normalizedStartUrl).pathname}|${getOffsetFromUrl(normalizedStartUrl, 0)}`;
    seenOffsets.add(initialOffsetKey);

    log.info(
        `Starting crawl: startUrl=${normalizedStartUrl}, results_wanted=${resultsWanted}, max_pages=${maxPages}, collectDetails=${Boolean(collectDetails)}, internalConcurrency=${maxConcurrency}`,
    );

    await crawler.run([{
        url: normalizedStartUrl,
        userData: { label: 'LIST', pageNo: 1 },
        uniqueKey: `LIST:${normalizedStartUrl}`,
    }]);

    log.info(`Finished. Saved ${saved} items.`);
} finally {
    await Actor.exit();
}
