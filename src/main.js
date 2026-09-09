import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Actor, log } from 'apify';
import { Impit } from 'impit';

const OTTO_ORIGIN = 'https://www.otto.de';
const OFFSET_STEP = 24;
const PUSH_BATCH_SIZE = 25;
const CROCOTILE_BATCH_SIZE = 24;
const MAX_CROCOTILE_REQUESTS_PER_PAGE = 20;
const PROGRESS_LOG_STEP = 25;
const REQUEST_TIMEOUT_MS = 35000;
const MAX_HTTP_RETRIES = 3;
const MAX_ROUTE_REFRESHES = 2;
const RETRY_BASE_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5000;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const EVERGLADES_INTENTS = ['ranked', 'sponsored', 'similar', 'context', 'layout'];

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

const resolvePositiveIntInput = ({ runtimeValue, schemaValue, inputFileValue }) => {
    const runtimeParsed = parsePositiveInt(runtimeValue, null);
    if (runtimeParsed) return runtimeParsed;

    const inputFileParsed = parsePositiveInt(inputFileValue, null);
    if (inputFileParsed) return inputFileParsed;

    const schemaParsed = parsePositiveInt(schemaValue, null);
    if (schemaParsed) return schemaParsed;

    return null;
};

const resolveBooleanInput = ({ runtimeValue, schemaValue, inputFileValue, fallback = true }) => {
    if (typeof runtimeValue === 'boolean') return runtimeValue;
    if (typeof inputFileValue === 'boolean') return inputFileValue;
    if (typeof schemaValue === 'boolean') return schemaValue;
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

const hasVariationPayload = (tile) => Array.isArray(tile?.variations) && tile.variations.length > 0;

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

const getPayloadPageContainer = (payload) => {
    const payloadObject = asObject(payload);
    if (!payloadObject) return null;
    return asObject(payloadObject.page) || payloadObject;
};

const getPayloadPageParams = (payload) => {
    const pageContainer = getPayloadPageContainer(payload);
    if (!pageContainer) return null;
    return asObject(pageContainer.page) || pageContainer;
};

const getPayloadTileListItems = (payload) => {
    const payloadObject = asObject(payload);
    const pageContainer = getPayloadPageContainer(payload);

    const candidates = [
        pageContainer?.tileListItems,
        payloadObject?.tileListItems,
        pageContainer?.items,
        payloadObject?.items,
        pageContainer?.products,
        payloadObject?.products,
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
    }

    return [];
};

const getExpectedEvergladesPayload = (parsed) => {
    const parsedObject = asObject(parsed);
    if (!parsedObject) return null;

    const nestedPayload = asObject(parsedObject.data?.payload);
    if (nestedPayload) return nestedPayload;

    return Array.isArray(parsedObject.intents) ? parsedObject : null;
};

const getPayloadProducts = (payload) => {
    const intents = Array.isArray(payload?.intents) ? payload.intents : [];
    const products = [];

    for (const intentName of ['ranked', 'sponsored', 'similar']) {
        const intent = intents.find((candidate) => candidate?.intent === intentName);
        if (Array.isArray(intent?.products)) {
            products.push(...intent.products.filter((product) => asObject(product)));
        }
    }

    return products;
};

const getCrocotileVariations = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.variations)) return payload.variations;
    return null;
};

const buildTilesFromProducts = ({ products, variations, offset }) => {
    const variationById = new Map(
        variations
            .filter((variation) => variation?.variationId !== undefined && variation?.variationId !== null)
            .map((variation) => [String(variation.variationId), variation]),
    );

    return products.map((product, index) => {
        const variationId = product?.bestVariationId;
        const variation = variationById.get(String(variationId));

        return {
            product,
            variations: variation ? [variation] : [],
            currentVariationId: variation?.variationId || variationId,
            colors: variation?.colors,
            type: product?.productType === 'sponsored' ? 'AS' : undefined,
            localListPosition: index + 1,
            actualListPosition: offset + index + 1,
            originPosition: index,
        };
    });
};

const getPayloadPagination = (payload) => {
    const payloadObject = asObject(payload);
    const pageContainer = getPayloadPageContainer(payload);
    const pagination = asObject(pageContainer?.pagination) || asObject(payloadObject?.pagination);
    if (pagination) return pagination;

    const rankedIntent = Array.isArray(payloadObject?.intents)
        ? payloadObject.intents.find((intent) => intent?.intent === 'ranked')
        : null;
    const currentOffset = asInteger(rankedIntent?.meta?.offset);
    return currentOffset === null ? null : { currentOffset };
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

const wait = async (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const getErrorMessage = (error) => (error instanceof Error ? error.message : String(error));

const getRetryAfterDelayMs = (headers) => {
    if (!headers || typeof headers.get !== 'function') return null;

    const retryAfter = asCleanString(headers.get('retry-after'));
    if (!retryAfter) return null;

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(Math.ceil(seconds * 1000), MAX_RETRY_DELAY_MS);
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isNaN(retryAt)) return null;

    return Math.min(Math.max(0, retryAt - Date.now()), MAX_RETRY_DELAY_MS);
};

const getRetryDelayMs = (attempt, headers) => {
    const retryAfterDelayMs = getRetryAfterDelayMs(headers);
    if (retryAfterDelayMs !== null) return retryAfterDelayMs;

    const base = RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1));
    const jitter = Math.floor(Math.random() * 200);
    return Math.min(base + jitter, MAX_RETRY_DELAY_MS);
};

const isRetryableStatusCode = (statusCode) => RETRYABLE_STATUS_CODES.has(statusCode);

const decodeEscapedRoutePath = (value) => {
    const raw = asCleanString(value);
    if (!raw) return null;

    return raw
        .replace(/\\u0026/g, '&')
        .replace(/\\u003d/g, '=')
        .replace(/\\\//g, '/');
};

const extractRoutePathFromText = (text) => {
    if (!text) return null;

    const patterns = [
        /["']((?:\\\/|\/)dundee(?:\\\/|\/)tilelist[^"']*)["']/i,
        /((?:\\\/|\/)dundee(?:\\\/|\/)tilelist\?[^\s<>"']+)/i,
        /((?:\\\/|\/)dundee(?:\\\/|\/)tilelist(?:[^\s<>"']*))/i,
    ];

    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (!match?.[1]) continue;

        const decoded = decodeEscapedRoutePath(match[1]);
        if (decoded && decoded.includes('/dundee/tilelist')) return decoded;
    }

    return null;
};

const extractDundeeBootstrap = (html) => {
    const scriptPattern = /<script[^>]*data-kestrel-app=["']reptile\.dundee["'][^>]*>([\s\S]*?)<\/script>/gi;
    let routePath = null;
    let initialPayload = null;
    let source = null;

    let match = null;
    while ((match = scriptPattern.exec(html)) !== null) {
        const content = typeof match[1] === 'string' ? match[1].trim() : null;
        if (!content) continue;

        if (!routePath) {
            routePath = extractRoutePathFromText(content);
            if (routePath) source = 'script_regex';
        }

        let parsed = null;
        try {
            parsed = JSON.parse(content);
        } catch {
            try {
                parsed = JSON.parse(decodeURIComponent(content));
            } catch {
                parsed = null;
            }
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

        if (!routePath) {
            const parsedRoutePath = decodeEscapedRoutePath(parsed.routePath);
            if (parsedRoutePath && parsedRoutePath.includes('/dundee/tilelist')) {
                routePath = parsedRoutePath;
                source = source || 'script_json';
            }
        }

        if (!initialPayload && parsed?.data?.payload && typeof parsed.data.payload === 'object') {
            initialPayload = parsed.data.payload;
            source = source || 'script_json';
        }
    }

    if (!routePath) {
        routePath = extractRoutePathFromText(html);
        if (routePath) source = source || 'page_regex';
    }

    return {
        routePath: decodeEscapedRoutePath(routePath),
        initialPayload,
        source,
    };
};

const pickVariation = (tile) => {
    const variations = Array.isArray(tile?.variations) ? tile.variations : [];
    if (variations.length === 0) return null;

    const currentVariationId = String(tile?.currentVariationId || '');
    return variations.find((variation) => String(variation?.variationId || '') === currentVariationId) || variations[0] || null;
};

const buildProductsApiUrl = ({ routePath, offset }) => {
    const routeUrl = new URL(routePath, OTTO_ORIGIN);
    const rule = asCleanString(routeUrl.searchParams.get('rule'));
    if (!rule) return null;

    const apiUrl = new URL('/everglades/products', OTTO_ORIGIN);
    apiUrl.searchParams.set('rule', rule);

    const intents = [...EVERGLADES_INTENTS];
    if (routeUrl.searchParams.get('l')) {
        intents.splice(intents.indexOf('layout'), 1);
    }
    if (offset > 0) {
        intents.splice(intents.indexOf('similar'), 1);
        apiUrl.searchParams.set('ranked.offset', String(offset));
    }

    for (const intent of intents) {
        apiUrl.searchParams.append('intents', intent);
    }

    const sortOrder = asCleanString(routeUrl.searchParams.get('sortiertnach'));
    if (sortOrder) apiUrl.searchParams.set('ranked.sortOrder', sortOrder);

    return apiUrl.href;
};

const buildCrocotileApiUrl = (variationIds) => {
    const apiUrl = new URL('/crocotile/tile/data', OTTO_ORIGIN);
    apiUrl.searchParams.set('variationIds', variationIds.join(','));
    return apiUrl.href;
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
    let rawColors = [];
    if (Array.isArray(tile?.colors)) {
        rawColors = tile.colors;
    } else if (Array.isArray(variation?.colors)) {
        rawColors = variation.colors;
    }

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

    const inputFile = Actor.isAtHome()
        ? {}
        : await readJsonFileSafe(path.resolve(process.cwd(), 'INPUT.json'));
    const schema = await readJsonFileSafe(path.resolve(process.cwd(), '.actor', 'input_schema.json'));

    const runtimeStartUrl = asCleanString(input.startUrl);
    const runtimeSearchQuery = asCleanString(input.searchQuery);
    const inputFileStartUrl = asCleanString(inputFile.startUrl);
    const inputFileSearchQuery = asCleanString(inputFile.searchQuery);
    let startUrl;
    let searchQuery;

    if (runtimeStartUrl && runtimeSearchQuery) {
        throw new Error('Provide either startUrl or searchQuery, not both.');
    }

    if (runtimeStartUrl) {
        startUrl = runtimeStartUrl;
        searchQuery = null;
    } else if (runtimeSearchQuery) {
        startUrl = null;
        searchQuery = runtimeSearchQuery;
    } else if (inputFileStartUrl && inputFileSearchQuery) {
        throw new Error('Provide either startUrl or searchQuery in INPUT.json, not both.');
    } else if (inputFileStartUrl) {
        startUrl = inputFileStartUrl;
        searchQuery = null;
    } else if (inputFileSearchQuery) {
        startUrl = null;
        searchQuery = inputFileSearchQuery;
    } else {
        const fallbackStartUrl = asCleanString(getSchemaDefault(schema, 'startUrl'));
        const fallbackSearchQuery = asCleanString(getSchemaDefault(schema, 'searchQuery'));

        if (fallbackStartUrl && fallbackSearchQuery) {
            throw new Error('Configure only one search mode in the input schema: startUrl or searchQuery.');
        }

        startUrl = fallbackStartUrl;
        searchQuery = fallbackSearchQuery;
    }

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

    const client = new Impit({
        browser: 'chrome',
        ignoreTlsErrors: true,
    });

    const getRequestContext = ({ refererUrl, requestHeaders = {} }) => ({
        headers: {
            ...(refererUrl && { referer: refererUrl }),
            ...requestHeaders,
        },
    });

    const fetchWithRetries = async ({ url, refererUrl, requestHeaders, expectJson, label }) => {
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_HTTP_RETRIES; attempt++) {
            const requestContext = getRequestContext({ refererUrl, requestHeaders });
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

            try {
                const response = await client.fetch(url, {
                    ...requestContext,
                    signal: abortController.signal,
                });

                if (!response || typeof response.status !== 'number') {
                    throw new Error(`${label} returned an invalid response.`);
                }

                if (!response.ok) {
                    const message = `${label} returned HTTP ${response.status}`;
                    if (attempt < MAX_HTTP_RETRIES && isRetryableStatusCode(response.status)) {
                        const delayMs = getRetryDelayMs(attempt, response.headers);
                        log.warning(`${message}. Retrying in ${delayMs}ms (${attempt}/${MAX_HTTP_RETRIES}).`);
                        await wait(delayMs);
                        continue;
                    }

                    const statusError = new Error(message);
                    statusError.statusCode = response.status;
                    throw statusError;
                }

                const body = await response.text();
                if (!expectJson) return { response, body };

                const contentType = response.headers?.get?.('content-type');
                if (contentType && !contentType.toLowerCase().includes('json')) {
                    log.warning(`${label} returned content-type ${contentType}; expected JSON.`);
                }

                try {
                    return { response, body, parsed: JSON.parse(body) };
                } catch {
                    const parseError = new Error(`${label} returned invalid JSON.`);
                    parseError.retryable = false;
                    throw parseError;
                }
            } catch (error) {
                lastError = error;
                const statusCode = asInteger(error?.statusCode);
                const shouldRetry = error?.retryable !== false && (!statusCode || isRetryableStatusCode(statusCode));

                if (attempt < MAX_HTTP_RETRIES && shouldRetry) {
                    const delayMs = getRetryDelayMs(attempt);
                    log.warning(`${label} request failed (${getErrorMessage(error)}). Retrying in ${delayMs}ms (${attempt}/${MAX_HTTP_RETRIES}).`);
                    await wait(delayMs);
                    continue;
                }

                throw error;
            } finally {
                clearTimeout(timeoutId);
            }
        }

        throw lastError || new Error(`${label} failed after ${MAX_HTTP_RETRIES} attempts.`);
    };

    const startPageResult = await fetchWithRetries({
        url: normalizedStartUrl,
        refererUrl: normalizedStartUrl,
        expectJson: false,
        label: 'Start page',
    });

    const startPageUrl = new URL(normalizedStartUrl);
    const bootstrap = extractDundeeBootstrap(startPageResult.body);
    let routePath = asCleanString(bootstrap.routePath);
    let initialPayload = bootstrap.initialPayload && typeof bootstrap.initialPayload === 'object'
        ? bootstrap.initialPayload
        : null;

    if (!routePath) {
        throw new Error('Could not locate Dundee tilelist route on start page.');
    }

    log.info(`Resolved Dundee tilelist route via ${bootstrap.source || 'unknown'} bootstrap strategy.`);

    let currentOffset = asInteger(getPayloadPageParams(initialPayload)?.o) ?? asInteger(startPageUrl.searchParams.get('o')) ?? 0;
    let initialPayloadOffset = asInteger(getPayloadPageParams(initialPayload)?.o);
    let routeRefreshCount = 0;

    const refreshRouteFromStartPage = async (reason) => {
        if (routeRefreshCount >= MAX_ROUTE_REFRESHES) return false;
        routeRefreshCount += 1;

        log.warning(`Refreshing Dundee route after ${reason} (attempt ${routeRefreshCount}/${MAX_ROUTE_REFRESHES}).`);

        try {
            const refreshedStart = await fetchWithRetries({
                url: normalizedStartUrl,
                refererUrl: normalizedStartUrl,
                expectJson: false,
                label: 'Start page refresh',
            });

            const refreshedBootstrap = extractDundeeBootstrap(refreshedStart.body);
            const refreshedRoutePath = asCleanString(refreshedBootstrap.routePath);

            if (!refreshedRoutePath) {
                log.warning('Route refresh did not find a Dundee route path.');
                return false;
            }

            routePath = refreshedRoutePath;
            if (!initialPayload && refreshedBootstrap.initialPayload && typeof refreshedBootstrap.initialPayload === 'object') {
                initialPayload = refreshedBootstrap.initialPayload;
                initialPayloadOffset = asInteger(getPayloadPageParams(initialPayload)?.o);
            }

            log.info(`Recovered Dundee route via ${refreshedBootstrap.source || 'unknown'} strategy.`);
            return true;
        } catch (refreshError) {
            log.warning(`Route refresh failed: ${getErrorMessage(refreshError)}`);
            return false;
        }
    };

    const loadPayloadForOffset = async ({ offset, page }) => {
        if (page === 1 && initialPayload && (initialPayloadOffset === null || offset === initialPayloadOffset)) {
            const bootstrapItems = getPayloadTileListItems(initialPayload);
            if (bootstrapItems.length > 0) {
                return { payload: initialPayload, apiUrl: buildProductsApiUrl({ routePath, offset }) };
            }

            log.warning('Bootstrap payload had no tile list items. Falling back to live Everglades API request.');
        }

        for (let attempt = 1; attempt <= 2; attempt++) {
            const apiUrl = buildProductsApiUrl({ routePath, offset });
            if (!apiUrl) {
                log.warning(`Could not build Everglades API URL for offset=${offset}: route has no rule.`);
                return { payload: null, apiUrl: null };
            }

            try {
                const { parsed } = await fetchWithRetries({
                    url: apiUrl,
                    refererUrl: normalizedStartUrl,
                    expectJson: true,
                    label: `Everglades offset=${offset}`,
                });

                const payload = getExpectedEvergladesPayload(parsed);
                if (payload) {
                    if (!Array.isArray(payload.intents)) {
                        const payloadKeys = Object.keys(payload);
                        log.warning(
                            `Everglades payload is missing an intents array. Keys: ${payloadKeys.join(', ') || '(none)'}.`,
                        );
                    }
                    let tileListItems = getPayloadTileListItems(payload);

                    if (Array.isArray(payload.intents)) {
                        const products = getPayloadProducts(payload);
                        const variations = [];

                        if (collectDetails) {
                            const variationIds = [...new Set(
                                products
                                    .map((product) => asCleanString(product?.bestVariationId))
                                    .filter(Boolean),
                            )];

                            if (variationIds.length > 0) {
                                const variationBatches = [];
                                for (let batchStart = 0; batchStart < variationIds.length; batchStart += CROCOTILE_BATCH_SIZE) {
                                    variationBatches.push(variationIds.slice(batchStart, batchStart + CROCOTILE_BATCH_SIZE));
                                }

                                let variationRequestCount = 0;
                                const loadVariationBatch = async (batch, batchLabel) => {
                                    if (batch.length === 0 || variationRequestCount >= MAX_CROCOTILE_REQUESTS_PER_PAGE) return;
                                    variationRequestCount += 1;

                                    try {
                                        const variationUrl = buildCrocotileApiUrl(batch);
                                        const variationResult = await fetchWithRetries({
                                            url: variationUrl,
                                            refererUrl: normalizedStartUrl,
                                            requestHeaders: {
                                                'crocotile-version': '2',
                                                'otto-feature': 'tilelist@RepTile-Dundee',
                                            },
                                            expectJson: true,
                                            label: `Crocotile variations offset=${offset} batch=${batchLabel}`,
                                        });
                                        const batchVariations = getCrocotileVariations(variationResult.parsed);
                                        if (batchVariations) {
                                            variations.push(...batchVariations);
                                            return;
                                        }

                                        const variationKeys = Object.keys(asObject(variationResult.parsed) || {});
                                        log.warning(
                                            `Crocotile response is missing a variations array for offset=${offset} batch=${batchLabel}. Keys: ${variationKeys.join(', ') || '(none)'}. Using basic records for that batch.`,
                                        );
                                    } catch (error) {
                                        const statusCode = asInteger(error?.statusCode);
                                        if (statusCode === 400 && batch.length > 1 && variationRequestCount < MAX_CROCOTILE_REQUESTS_PER_PAGE) {
                                            const midpoint = Math.ceil(batch.length / 2);
                                            log.warning(
                                                `Crocotile rejected offset=${offset} batch=${batchLabel} with HTTP 400. Retrying in smaller batches.`,
                                            );
                                            await loadVariationBatch(batch.slice(0, midpoint), `${batchLabel}.1`);
                                            await loadVariationBatch(batch.slice(midpoint), `${batchLabel}.2`);
                                            return;
                                        }

                                        log.warning(
                                            `Crocotile enrichment failed at offset=${offset} batch=${batchLabel}: ${getErrorMessage(error)} Using basic records for that batch.`,
                                        );
                                    }
                                };

                                for (let batchIndex = 0; batchIndex < variationBatches.length; batchIndex += 1) {
                                    await loadVariationBatch(variationBatches[batchIndex], `${batchIndex + 1}/${variationBatches.length}`);
                                }
                            }
                        }

                        tileListItems = buildTilesFromProducts({ products, variations, offset });
                    }

                    if (tileListItems.length === 0 && offset === 0 && attempt === 1) {
                        const payloadKeys = Object.keys(payload);
                        log.warning(
                            `Everglades payload at offset=0 returned no products. Keys: ${payloadKeys.join(', ') || '(none)'}. Refreshing route and retrying.`,
                        );

                        const recovered = await refreshRouteFromStartPage('empty product list on first page');
                        if (recovered) continue;
                    }

                    return { payload: { ...payload, tileListItems }, apiUrl };
                }

                const responseKeys = Object.keys(asObject(parsed) || {});
                const responseType = Array.isArray(parsed) ? 'array' : typeof parsed;
                log.warning(
                    `Everglades response missing expected data.payload/intents at offset=${offset}. Type=${responseType}; keys=${responseKeys.join(', ') || '(none)'}.`,
                );

                if (attempt === 1) {
                    const recovered = await refreshRouteFromStartPage(`missing payload at offset=${offset}`);
                    if (recovered) continue;
                }

                log.warning(`Everglades payload missing at offset=${offset}.`);
                return { payload: null, apiUrl };
            } catch (error) {
                if (attempt === 1) {
                    const recovered = await refreshRouteFromStartPage(`request failure at offset=${offset}: ${getErrorMessage(error)}`);
                    if (recovered) continue;
                }

                log.warning(`Stopping after Everglades request failure on offset=${offset}: ${getErrorMessage(error)}`);
                return { payload: null, apiUrl };
            }
        }

        return { payload: null, apiUrl: null };
    };

    let pageNo = 1;
    let saved = 0;
    let lastProgressLogged = 0;
    let pagesWithoutNewRecords = 0;

    const seenKeys = new Set();

    log.info(`Starting API extraction: results_wanted=${resultsWanted}, max_pages=${maxPages}, collectDetails=${Boolean(collectDetails)}`);

    while (saved < resultsWanted && pageNo <= maxPages) {
        const { payload } = await loadPayloadForOffset({ offset: currentOffset, page: pageNo });
        if (!payload) break;

        const tiles = getPayloadTileListItems(payload);
        if (tiles.length === 0) {
            const payloadKeys = Object.keys(asObject(payload) || {});
            const pageContainerKeys = Object.keys(getPayloadPageContainer(payload) || {});
            log.warning(
                `No tilelist items at offset=${currentOffset}. payload keys=${payloadKeys.join(', ') || '(none)'}; page keys=${pageContainerKeys.join(', ') || '(none)'}.`,
            );
            break;
        }

        const richTiles = tiles.filter(hasVariationPayload);
        const candidateTiles = collectDetails && richTiles.length > 0 ? richTiles : tiles;
        if (collectDetails) {
            if (richTiles.length === 0) {
                log.warning(`No variation payloads at offset=${currentOffset}; using basic product records.`);
            } else {
                log.debug(`Offset ${currentOffset}: ${richTiles.length}/${tiles.length} tiles include variation payload.`);
            }
        }

        const records = [];

        for (const tile of candidateTiles) {
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

        if (records.length === 0) {
            pagesWithoutNewRecords += 1;
            log.info(`No new deduplicated records at offset=${currentOffset} (streak ${pagesWithoutNewRecords}).`);
            if (pagesWithoutNewRecords >= 2) {
                log.info('Stopping after repeated pages without new records.');
                break;
            }
        } else {
            pagesWithoutNewRecords = 0;
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

        const apiCurrentOffset = asInteger(getPayloadPagination(payload)?.currentOffset);
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
    const message = getErrorMessage(error);
    log.error(`Run failed: ${message}`);
    throw error;
} finally {
    await Actor.exit();
}
