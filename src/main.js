import { Actor } from 'apify';
import log from '@apify/log';
import { gotScraping } from 'got-scraping';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const OTTO_ORIGIN = 'https://www.otto.de';
const OFFSET_STEP = 24;
const PUSH_BATCH_SIZE = 25;
const PROGRESS_LOG_STEP = 25;
const REQUEST_TIMEOUT_MS = 35000;

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

const readJsonFileSafe = async (filePath) => {
    try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const getSchemaDefault = (schema, key) => {
    const property = schema?.properties?.[key];
    if (!property || typeof property !== 'object') return undefined;
    if (property.default !== undefined) return property.default;
    if (property.prefill !== undefined) return property.prefill;
    return undefined;
};

const resolveStringInput = ({ runtimeValue, schemaValue, inputFileValue }) => {
    const runtimeClean = asCleanString(runtimeValue);
    if (runtimeClean) return runtimeClean;

    const schemaClean = asCleanString(schemaValue);
    if (schemaClean) return schemaClean;

    const inputFileClean = asCleanString(inputFileValue);
    if (inputFileClean) return inputFileClean;

    return null;
};

const resolvePositiveIntInput = ({ runtimeValue, schemaValue, inputFileValue }) => {
    const runtimeParsed = parsePositiveInt(runtimeValue, null);
    if (runtimeParsed) return runtimeParsed;

    const schemaParsed = parsePositiveInt(schemaValue, null);
    if (schemaParsed) return schemaParsed;

    const inputFileParsed = parsePositiveInt(inputFileValue, null);
    if (inputFileParsed) return inputFileParsed;

    return null;
};

const resolveBooleanInput = ({ runtimeValue, schemaValue, inputFileValue, fallback = true }) => {
    if (typeof runtimeValue === 'boolean') return runtimeValue;
    if (typeof schemaValue === 'boolean') return schemaValue;
    if (typeof inputFileValue === 'boolean') return inputFileValue;
    return fallback;
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

    const parsed = Number.parseFloat(sanitized);
    return Number.isFinite(parsed) ? parsed : null;
};

const buildSearchUrl = (query) => {
    const term = asCleanString(query);
    if (!term) return null;

    const searchUrl = new URL(`/suche/${encodeURIComponent(term)}/`, OTTO_ORIGIN);
    searchUrl.searchParams.set('o', '0');
    searchUrl.searchParams.set('l', 'gp');
    searchUrl.searchParams.set('c', '');
    return searchUrl.href;
};

const deepCleanValue = (value) => {
    if (value === null || value === undefined) return null;

    if (typeof value === 'string') {
        const cleaned = value.replace(/\s+/g, ' ').trim();
        return cleaned === '' ? null : cleaned;
    }

    if (Array.isArray(value)) {
        const cleanedArray = value
            .map((entry) => deepCleanValue(entry))
            .filter((entry) => entry !== null && entry !== undefined);
        return cleanedArray.length > 0 ? cleanedArray : null;
    }

    if (typeof value === 'object') {
        const cleanedObject = {};
        for (const [key, entry] of Object.entries(value)) {
            const cleanedEntry = deepCleanValue(entry);
            if (cleanedEntry !== null && cleanedEntry !== undefined) {
                cleanedObject[key] = cleanedEntry;
            }
        }
        return Object.keys(cleanedObject).length > 0 ? cleanedObject : null;
    }

    return value;
};

const extractDundeeData = (html) => {
    const marker = '<script type="application/encoded+json; encoding=url;" data-kestrel-app="reptile.dundee">';
    const start = html.indexOf(marker);
    if (start < 0) return null;

    const from = start + marker.length;
    const end = html.indexOf('</script>', from);
    if (end < 0) return null;

    try {
        const decoded = decodeURIComponent(html.slice(from, end));
        return JSON.parse(decoded);
    } catch {
        return null;
    }
};

const pickVariation = (tile) => {
    const variations = Array.isArray(tile?.variations) ? tile.variations : [];
    if (variations.length === 0) return null;

    const currentVariationId = String(tile?.currentVariationId || '');
    return variations.find((variation) => String(variation?.variationId || '') === currentVariationId) || variations[0] || null;
};

const buildTilelistApiUrl = ({ routePath, offset, layout }) => {
    const url = new URL(routePath, OTTO_ORIGIN);

    if (layout) {
        url.searchParams.set('l', layout);
    }

    if (offset > 0) {
        url.searchParams.set('o', String(offset));
    } else {
        url.searchParams.delete('o');
    }

    url.searchParams.delete('c');

    return url.href;
};

const makeDedupeKey = (record) => {
    const directUrl = asCleanString(record?.product_url || record?.url);
    if (directUrl) return directUrl.replace(/\?.*$/, '');

    const variation = asCleanString(record?.variation_id);
    if (variation) return `variation:${variation}`;

    const productId = asCleanString(record?.product_id);
    if (productId) return `product:${productId}`;

    return null;
};

const normalizeColors = (tile, variation) => {
    const rawColors = Array.isArray(tile?.colors)
        ? tile.colors
        : (Array.isArray(variation?.colors) ? variation.colors : []);

    if (rawColors.length === 0) return null;

    const cleaned = rawColors
        .map((entry) => {
            if (Array.isArray(entry)) {
                const [, details] = entry;
                if (details && typeof details === 'object') {
                    return asCleanString(details.name || details.baseColor || details.hexCode);
                }
                return asCleanString(entry[0]);
            }

            if (entry && typeof entry === 'object') {
                return asCleanString(entry.name || entry.baseColor || entry.hexCode);
            }

            return asCleanString(entry);
        })
        .filter(Boolean);

    return cleaned.length > 0 ? [...new Set(cleaned)] : null;
};

const pickTrackingValue = (tracking, keys) => {
    for (const key of keys) {
        const value = tracking?.[key];

        if (Array.isArray(value)) {
            const picked = asCleanString(value[0]);
            if (picked) return picked;
            continue;
        }

        const direct = asCleanString(value);
        if (direct) return direct;
    }

    return null;
};

const normalizeTracking = (tracking) => {
    if (!tracking || typeof tracking !== 'object') return null;

    const normalized = {
        impression_id: pickTrackingValue(tracking, ['spx_ImpressionIdClick', 'spx_ImpressionId']),
        product_id: pickTrackingValue(tracking, ['spx_ProductIdClick', 'spx_ProductId']),
        variation_id: pickTrackingValue(tracking, ['spx_VariationIdClick', 'spx_VariationId']),
        campaign_id: pickTrackingValue(tracking, ['spx_CampaignIdClick', 'spx_CampaignId']),
        campaign_type: pickTrackingValue(tracking, ['spx_CampaignTypeClick', 'spx_CampaignType']),
        page_type: pickTrackingValue(tracking, ['spx_PageTypeClick', 'spx_PageType']),
        device_type: pickTrackingValue(tracking, ['spx_DeviceTypeClick', 'spx_DeviceType']),
        position: asInteger(pickTrackingValue(tracking, ['spx_PositionClick', 'spx_Position'])),
        semantic_score: asNumber(pickTrackingValue(tracking, ['spx_SemanticScoreClick', 'spx_SemanticScore'])),
        personalization_score: asNumber(pickTrackingValue(tracking, ['spx_PersonalizationScoreClick', 'spx_PersonalizationScore'])),
    };

    return deepCleanValue(normalized);
};

const buildRecordFromTile = ({ tile, pageUrl, pageNo, currentOffset, collectDetails }) => {
    const product = tile?.product || {};
    const variation = pickVariation(tile);

    const detailPath = variation?.canonicalLink
        || variation?.detailPageLink
        || product?.variationPath
        || null;
    const productUrl = toAbsoluteUrl(detailPath, pageUrl);

    if (!productUrl) return null;

    const price = variation?.price || {};
    const reviews = variation?.customerReviews || {};
    const availability = variation?.availability || {};
    const image = variation?.image || {};

    const record = {
        name: asCleanString(variation?.title?.full || variation?.name || product?.name),
        brand: asCleanString(variation?.brand),
        price: normalizePrice(price?.retailPrice),
        original_price: normalizePrice(price?.comparativePrice || price?.suggestedRetailPrice),
        rating: asNumber(reviews?.averageRating),
        review_count: asInteger(reviews?.amount),
        availability: asCleanString(availability?.detail || availability?.state),
        image_url: toAbsoluteUrl(image?.jpeg || image?.webp, pageUrl),
        product_url: productUrl,
        url: productUrl,
        product_id: asCleanString(product?.id),
        product_type: asCleanString(product?.productType),
        article_number: asCleanString(product?.articleNumber),
        variation_id: asCleanString(variation?.variationId || product?.bestVariationId),
        advertiser_legal_name: asCleanString(product?.advertiserLegalName),
        funder_legal_name: asCleanString(product?.funderLegalName),
        local_list_position: asInteger(tile?.localListPosition),
        actual_list_position: asInteger(tile?.actualListPosition),
        origin_position: asInteger(tile?.originPosition),
        list_type: asCleanString(tile?.type),
        page_no: asInteger(pageNo),
        page_offset: asInteger(currentOffset),
        data_quality: variation ? 'rich' : 'basic',
        source: 'dundee_tilelist_api',
        colors: collectDetails ? normalizeColors(tile, variation) : null,
        pbk: collectDetails ? asCleanString(variation?.pbk) : null,
        sale_tags: collectDetails && Array.isArray(variation?.saleTags) ? variation.saleTags : null,
        social_proof: collectDetails ? variation?.socialProof : null,
        sustainability_badges: collectDetails && Array.isArray(variation?.sustainabilityBadges) ? variation.sustainabilityBadges : null,
        click_tracking: collectDetails ? normalizeTracking(product?.clickTracking) : null,
        feature_tracking: collectDetails ? normalizeTracking(product?.featureTracking) : null,
    };

    return deepCleanValue(record);
};

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};

    const inputFile = await readJsonFileSafe(path.resolve(process.cwd(), 'INPUT.json'));
    const schema = await readJsonFileSafe(path.resolve(process.cwd(), '.actor', 'input_schema.json'));

    const startUrl = resolveStringInput({
        runtimeValue: input.startUrl,
        schemaValue: getSchemaDefault(schema, 'startUrl'),
        inputFileValue: inputFile.startUrl,
    });

    const searchQuery = resolveStringInput({
        runtimeValue: input.searchQuery,
        schemaValue: getSchemaDefault(schema, 'searchQuery'),
        inputFileValue: inputFile.searchQuery,
    });

    const collectDetails = resolveBooleanInput({
        runtimeValue: input.collectDetails,
        schemaValue: getSchemaDefault(schema, 'collectDetails'),
        inputFileValue: inputFile.collectDetails,
        fallback: true,
    });

    const resultsWanted = resolvePositiveIntInput({
        runtimeValue: input.results_wanted,
        schemaValue: getSchemaDefault(schema, 'results_wanted'),
        inputFileValue: inputFile.results_wanted,
    });

    const maxPages = resolvePositiveIntInput({
        runtimeValue: input.max_pages,
        schemaValue: getSchemaDefault(schema, 'max_pages'),
        inputFileValue: inputFile.max_pages,
    });

    if (!startUrl && !searchQuery) {
        throw new Error('Missing search input. Provide startUrl or searchQuery via run input, input schema default/prefill, or INPUT.json.');
    }

    if (!resultsWanted || !maxPages) {
        throw new Error('Missing pagination input. Provide results_wanted and max_pages via run input, input schema default/prefill, or INPUT.json.');
    }

    const resolvedStartUrl = startUrl || buildSearchUrl(searchQuery);
    if (!resolvedStartUrl) {
        throw new Error('Could not resolve a valid start URL from provided inputs.');
    }

    const normalizedStartUrl = new URL(resolvedStartUrl, OTTO_ORIGIN).href;
    const startHost = new URL(normalizedStartUrl).hostname;

    if (!startHost.endsWith('otto.de')) {
        throw new Error(`Invalid startUrl host "${startHost}". Only otto.de URLs are supported.`);
    }

    const proxyConfiguration = input.proxyConfiguration
        ? await Actor.createProxyConfiguration({ ...input.proxyConfiguration })
        : undefined;

    const getRequestContext = async ({ refererUrl, isApiRequest }) => {
        const headers = {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
            accept: isApiRequest
                ? 'application/json,text/plain,*/*'
                : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
            'cache-control': 'no-cache',
            pragma: 'no-cache',
            referer: refererUrl,
        };

        if (!isApiRequest) {
            headers['upgrade-insecure-requests'] = '1';
        }

        return {
            headers,
            proxyUrl: proxyConfiguration ? await proxyConfiguration.newUrl() : undefined,
        };
    };

    const initialRequest = await getRequestContext({ refererUrl: normalizedStartUrl, isApiRequest: false });
    const initialResponse = await gotScraping.get(normalizedStartUrl, {
        headers: initialRequest.headers,
        proxyUrl: initialRequest.proxyUrl,
        timeout: { request: REQUEST_TIMEOUT_MS },
        throwHttpErrors: false,
    });

    if (initialResponse.statusCode >= 400) {
        throw new Error(`Failed loading start page (${initialResponse.statusCode}).`);
    }

    const dundeeData = extractDundeeData(initialResponse.body);
    const routePath = asCleanString(dundeeData?.routePath);
    const initialPayload = dundeeData?.data?.payload;

    if (!routePath || !initialPayload) {
        throw new Error('Could not locate Dundee tilelist payload on start page.');
    }

    const layout = asCleanString(initialPayload?.page?.l);
    let currentOffset = asInteger(initialPayload?.page?.o) ?? 0;
    let pageNo = 1;
    let saved = 0;
    let lastProgressLogged = 0;

    const seenKeys = new Set();

    log.info(`Starting API extraction: results_wanted=${resultsWanted}, max_pages=${maxPages}, collectDetails=${Boolean(collectDetails)}`);

    while (saved < resultsWanted && pageNo <= maxPages) {
        const apiUrl = buildTilelistApiUrl({ routePath, offset: currentOffset, layout });

        let payload = null;

        if (pageNo === 1 && currentOffset === (asInteger(initialPayload?.page?.o) ?? 0)) {
            payload = initialPayload;
        } else {
            const requestContext = await getRequestContext({ refererUrl: apiUrl, isApiRequest: true });
            const apiResponse = await gotScraping.get(apiUrl, {
                headers: requestContext.headers,
                proxyUrl: requestContext.proxyUrl,
                timeout: { request: REQUEST_TIMEOUT_MS },
                throwHttpErrors: false,
            });

            if (apiResponse.statusCode >= 400) {
                log.warning(`Stopping after API ${apiResponse.statusCode} on offset=${currentOffset}`);
                break;
            }

            let parsed = null;
            try {
                parsed = JSON.parse(apiResponse.body);
            } catch {
                log.warning(`Stopping due to invalid JSON on offset=${currentOffset}`);
                break;
            }

            payload = parsed?.data?.payload;
        }

        const tiles = Array.isArray(payload?.tileListItems) ? payload.tileListItems : [];
        if (tiles.length === 0) {
            log.info(`No more tilelist items at offset=${currentOffset}.`);
            break;
        }

        const records = [];

        for (const tile of tiles) {
            if (saved + records.length >= resultsWanted) break;

            const record = buildRecordFromTile({
                tile,
                pageUrl: normalizedStartUrl,
                pageNo,
                currentOffset,
                collectDetails: Boolean(collectDetails),
            });

            if (!record) continue;

            const dedupeKey = makeDedupeKey(record);
            if (!dedupeKey || seenKeys.has(dedupeKey)) continue;

            seenKeys.add(dedupeKey);
            records.push(record);
        }

        for (let i = 0; i < records.length; i += PUSH_BATCH_SIZE) {
            await Actor.pushData(records.slice(i, i + PUSH_BATCH_SIZE));
        }

        saved += records.length;

        if (saved - lastProgressLogged >= PROGRESS_LOG_STEP || saved >= resultsWanted) {
            log.info(`Pushed ${saved}/${resultsWanted} items (offset=${currentOffset}, page=${pageNo})`);
            lastProgressLogged = saved;
        }

        if (saved >= resultsWanted) break;

        const apiCurrentOffset = asInteger(payload?.pagination?.currentOffset);
        const nextOffset = (apiCurrentOffset ?? currentOffset) + OFFSET_STEP;

        if (nextOffset <= currentOffset) {
            log.info('Pagination offset did not advance. Stopping.');
            break;
        }

        currentOffset = nextOffset;
        pageNo += 1;
    }

    log.info(`Finished. Saved ${saved} deduplicated items.`);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Run failed: ${message}`);
    console.error(error);
    throw error;
} finally {
    await Actor.exit();
}
