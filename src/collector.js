// collector.js — gathers REAL, measurable facts about a store's public homepage.
// Nothing here guesses: every signal is derived from the fetched HTML/headers so
// the AI report is grounded in evidence rather than hallucinated findings.

import * as cheerio from "cheerio";
import { fetchPageSpeed } from "./pagespeed.js";
import { computeScore } from "./scoring.js";

const UA =
  "Mozilla/5.0 (compatible; ShopifyStoreAuditAI/0.1; +https://example.com/audit-bot)";

/** Fetch a URL with a timeout, returning { ok, status, headers, body, ms, error }. */
async function fetchWithTimeout(url, { method = "GET", timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    });
    const body = method === "HEAD" ? "" : await res.text();
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
      headers: Object.fromEntries(res.headers.entries()),
      body,
      ms: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.name === "AbortError" ? "timeout" : err.message, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUrl(input) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return new URL(url);
}

/** Detect whether the page is a Shopify store, and surface evidence. */
function detectShopify($, html, headers) {
  const evidence = [];
  if (/cdn\.shopify\.com/i.test(html)) evidence.push("cdn.shopify.com asset URLs");
  if (/Shopify\.shop|window\.Shopify/i.test(html)) evidence.push("Shopify JS global");
  if (/myshopify\.com/i.test(html)) evidence.push("myshopify.com reference");
  if (headers["x-shopify-stage"] || headers["x-shopid"] || /shopify/i.test(headers["powered-by"] || "")) {
    evidence.push("Shopify response header");
  }
  if (/"@type"\s*:\s*"(Product|Store|OnlineStore)"/i.test(html)) evidence.push("commerce structured data");
  return { isShopify: evidence.length > 0, evidence };
}

/** Identify third-party apps / trackers loaded via <script src>. */
function detectApps($) {
  const known = [
    { name: "Klaviyo", re: /klaviyo/i },
    { name: "Google Analytics / GA4", re: /google-analytics|gtag\/js|googletagmanager/i },
    { name: "Meta / Facebook Pixel", re: /connect\.facebook\.net|fbevents/i },
    { name: "Judge.me Reviews", re: /judge\.me/i },
    { name: "Yotpo", re: /yotpo/i },
    { name: "Loox", re: /loox/i },
    { name: "TikTok Pixel", re: /tiktok/i },
    { name: "Hotjar", re: /hotjar/i },
    { name: "Tidio / Chat", re: /tidio|crisp\.chat|tawk\.to|intercom/i },
    { name: "Recharge Subscriptions", re: /rechargeapps|rechargecdn/i },
    { name: "PageFly / Page Builder", re: /pagefly|gempages|shogun/i },
  ];
  const scripts = $("script[src]").map((_, el) => $(el).attr("src")).get();
  const found = new Set();
  for (const src of scripts) {
    for (const app of known) if (app.re.test(src)) found.add(app.name);
  }
  return { detected: [...found], totalExternalScripts: scripts.length };
}

/** Collect SEO signals from the <head> and body. */
function collectSeo($) {
  const title = $("head title").first().text().trim();
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() || "";
  const canonical = $('link[rel="canonical"]').attr("href") || "";
  const robotsMeta = $('meta[name="robots"]').attr("content") || "";
  const viewport = $('meta[name="viewport"]').attr("content") || "";
  const ogTags = $('meta[property^="og:"]').length;
  const twitterTags = $('meta[name^="twitter:"]').length;
  const h1 = $("h1");
  const jsonLd = $('script[type="application/ld+json"]');
  const jsonLdTypes = [];
  jsonLd.each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) if (d && d["@type"]) jsonLdTypes.push(d["@type"]);
    } catch {
      jsonLdTypes.push("(invalid JSON-LD)");
    }
  });
  return {
    title,
    titleLength: title.length,
    metaDescription: metaDesc,
    metaDescriptionLength: metaDesc.length,
    canonicalPresent: !!canonical,
    robotsMeta,
    viewportPresent: !!viewport,
    openGraphTagCount: ogTags,
    twitterCardTagCount: twitterTags,
    h1Count: h1.length,
    h1Text: h1.first().text().trim().slice(0, 120),
    structuredDataTypes: jsonLdTypes,
  };
}

/** Resolve a possibly-relative asset URL to an absolute one. */
function absUrl(src, base) {
  try {
    return new URL(src, base).toString();
  } catch {
    return src;
  }
}

/** Collect image signals (alt text, format, dimensions) + the URLs of every
 * affected image (capped high so normal stores list them all). */
function collectImages($, base, sampleMax = 100) {
  const imgs = $("img");
  let missingAlt = 0;
  let missingDimensions = 0;
  let nonNextGen = 0;
  const total = imgs.length;
  const missingAltSamples = [];
  const legacyFormatSamples = [];
  imgs.each((_, el) => {
    const $el = $(el);
    const rawSrc = $el.attr("src") || $el.attr("data-src") || "";
    const src = rawSrc.toLowerCase();
    const alt = $el.attr("alt");
    if (alt === undefined || alt.trim() === "") {
      missingAlt++;
      if (rawSrc && missingAltSamples.length < sampleMax) missingAltSamples.push(absUrl(rawSrc, base));
    }
    if (!$el.attr("width") || !$el.attr("height")) missingDimensions++;
    if (/\.(jpe?g|png)(\?|$)/.test(src)) {
      nonNextGen++;
      if (rawSrc && legacyFormatSamples.length < sampleMax) legacyFormatSamples.push(absUrl(rawSrc, base));
    }
  });
  return {
    total,
    missingAlt,
    missingDimensions,
    legacyFormatCount: nonNextGen,
    missingAltSamples,
    legacyFormatSamples,
  };
}

/** Collect accessibility signals. */
function collectAccessibility($, html) {
  const htmlLang = $("html").attr("lang") || "";
  const buttonsNoText = $("button")
    .filter((_, el) => !$(el).text().trim() && !$(el).attr("aria-label") && !$(el).attr("title"))
    .length;
  const inputs = $('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
  let inputsNoLabel = 0;
  inputs.each((_, el) => {
    const $el = $(el);
    const id = $el.attr("id");
    const hasLabel = id && $(`label[for="${id}"]`).length > 0;
    const hasAria = $el.attr("aria-label") || $el.attr("aria-labelledby") || $el.attr("placeholder");
    if (!hasLabel && !hasAria) inputsNoLabel++;
  });
  const hasSkipLink = /skip.{0,10}(to )?(main|content)/i.test(html);
  return {
    htmlLangPresent: !!htmlLang,
    htmlLang,
    buttonsWithoutAccessibleText: buttonsNoText,
    formInputsWithoutLabel: inputsNoLabel,
    skipToContentLink: hasSkipLink,
  };
}

/** Collect render-blocking / performance-adjacent signals from the markup. */
function collectPerformance($, html, homepage) {
  const headScripts = $("head script[src]");
  let renderBlocking = 0;
  headScripts.each((_, el) => {
    const $el = $(el);
    if (!$el.attr("async") && !$el.attr("defer")) renderBlocking++;
  });
  const stylesheets = $('link[rel="stylesheet"]').length;
  const totalScripts = $("script[src]").length;
  const inlineScripts = $("script:not([src])").length;
  const iframes = $("iframe").length;
  return {
    htmlSizeKB: Math.round(Buffer.byteLength(html, "utf8") / 1024),
    fetchTimeMs: homepage.ms,
    renderBlockingHeadScripts: renderBlocking,
    stylesheetCount: stylesheets,
    externalScriptCount: totalScripts,
    inlineScriptCount: inlineScripts,
    iframeCount: iframes,
  };
}

/** Check a small sample of internal links for broken (4xx/5xx) responses. */
async function sampleLinkHealth($, base, max = 12) {
  const seen = new Set();
  const links = [];
  $("a[href]").each((_, el) => {
    let href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    try {
      const u = new URL(href, base);
      if (u.hostname !== new URL(base).hostname) return; // internal only
      const key = u.pathname;
      if (seen.has(key)) return;
      seen.add(key);
      links.push(u.toString());
    } catch {
      /* ignore malformed */
    }
  });
  const sample = links.slice(0, max);
  const results = await Promise.all(
    sample.map(async (url) => {
      const r = await fetchWithTimeout(url, { method: "HEAD", timeoutMs: 10000 });
      return { url, status: r.status || 0, ok: r.ok };
    })
  );
  const broken = results.filter((r) => !r.ok);
  return { checked: results.length, totalInternalLinks: links.length, broken };
}

/** Find internal product & collection page URLs linked from the homepage. */
function discoverInnerLinks($, base) {
  const host = new URL(base).hostname;
  const products = new Set();
  const collections = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let u;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (u.hostname !== host) return;
    const p = u.pathname;
    const clean = u.origin + p; // drop query/hash for de-duping
    if (/\/products\/[^/]+/.test(p)) products.add(clean);
    else if (/\/collections\/[^/]+/.test(p)) collections.add(clean);
  });
  return { products: [...products], collections: [...collections] };
}

/** Scan a single page and return its per-page signals (no network beyond the GET). */
async function scanPage(rawUrl, type) {
  const res = await fetchWithTimeout(rawUrl, { timeoutMs: 15000 });
  if (!res.ok || !res.body) {
    return { ok: false, url: rawUrl, type, error: res.error || `status ${res.status}` };
  }
  const $ = cheerio.load(res.body);
  const finalUrl = res.finalUrl || rawUrl;
  return {
    ok: true,
    url: finalUrl,
    type,
    seo: collectSeo($),
    images: collectImages($, finalUrl),
    accessibility: collectAccessibility($, res.body),
    performance: collectPerformance($, res.body, res),
  };
}

/** Sum image issues across every scanned page; dedupe example URLs. */
function aggregateImages(pages, sampleMax = 100) {
  const agg = { total: 0, missingAlt: 0, missingDimensions: 0, legacyFormatCount: 0, missingAltSamples: [], legacyFormatSamples: [] };
  for (const pg of pages) {
    if (!pg.ok || !pg.images) continue;
    agg.total += pg.images.total;
    agg.missingAlt += pg.images.missingAlt;
    agg.missingDimensions += pg.images.missingDimensions;
    agg.legacyFormatCount += pg.images.legacyFormatCount;
    for (const u of pg.images.missingAltSamples || []) {
      if (agg.missingAltSamples.length < sampleMax && !agg.missingAltSamples.includes(u)) agg.missingAltSamples.push(u);
    }
    for (const u of pg.images.legacyFormatSamples || []) {
      if (agg.legacyFormatSamples.length < sampleMax && !agg.legacyFormatSamples.includes(u)) agg.legacyFormatSamples.push(u);
    }
  }
  return agg;
}

/** Compact per-page summary for the report (small — safe for the AI prompt). */
function pageSummary(pg) {
  if (!pg.ok) return { url: pg.url, type: pg.type, error: pg.error };
  return {
    url: pg.url,
    type: pg.type,
    title: pg.seo.title,
    titleLength: pg.seo.titleLength,
    metaDescriptionLength: pg.seo.metaDescriptionLength,
    h1Count: pg.seo.h1Count,
    structuredDataTypes: pg.seo.structuredDataTypes,
    htmlSizeKB: pg.performance.htmlSizeKB,
    images: { total: pg.images.total, missingAlt: pg.images.missingAlt, legacyFormatCount: pg.images.legacyFormatCount },
  };
}

// How many inner pages to scan (kept small for the serverless 60s timeout).
const MAX_PRODUCTS = 3;
const MAX_COLLECTIONS = 1;

/** Main entry: scan the homepage + a few inner pages and collect all facts. */
export async function collectAudit(inputUrl) {
  const url = normalizeUrl(inputUrl);
  const homepage = await fetchWithTimeout(url.toString());

  if (!homepage.ok || !homepage.body) {
    throw new Error(
      `Could not fetch ${url.toString()} (status ${homepage.status}${
        homepage.error ? ", " + homepage.error : ""
      }). Check the URL is public and reachable.`
    );
  }

  const $ = cheerio.load(homepage.body);
  const html = homepage.body;
  const base = homepage.finalUrl || url.toString();
  const origin = new URL(base).origin;

  // Homepage as the first "page" (sync parsing).
  const homePage = {
    ok: true,
    url: base,
    type: "homepage",
    seo: collectSeo($),
    images: collectImages($, base),
    accessibility: collectAccessibility($, html),
    performance: collectPerformance($, html, homepage),
  };

  const { products, collections } = discoverInnerLinks($, base);
  const targets = [
    ...products.slice(0, MAX_PRODUCTS).map((u) => [u, "product"]),
    ...collections.slice(0, MAX_COLLECTIONS).map((u) => [u, "collection"]),
  ];

  // Everything network-bound runs concurrently, so total wall-clock is roughly
  // the slowest single task (PageSpeed) — not the sum. Keeps us under the
  // serverless 60s limit even though PageSpeed alone can take ~40s.
  const [robots, sitemap, linkHealth, innerPages, pagespeed] = await Promise.all([
    fetchWithTimeout(origin + "/robots.txt", { timeoutMs: 8000 }),
    fetchWithTimeout(origin + "/sitemap.xml", { method: "HEAD", timeoutMs: 8000 }),
    sampleLinkHealth($, base),
    Promise.all(targets.map(([u, t]) => scanPage(u, t))),
    fetchPageSpeed(base, { timeoutMs: 45000 }),
  ]);

  const allPages = [homePage, ...innerPages];
  const okPages = allPages.filter((p) => p.ok);

  const facts = {
    scannedUrl: url.toString(),
    finalUrl: base,
    scanTimeMs: homepage.ms,
    https: base.startsWith("https://"),
    server: homepage.headers["server"] || "",
    shopify: detectShopify($, html, homepage.headers),
    apps: detectApps($),
    seo: homePage.seo,
    images: aggregateImages(allPages),
    accessibility: homePage.accessibility,
    performance: homePage.performance,
    links: linkHealth,
    pagespeed: pagespeed || { available: false },
    scan: {
      pagesScanned: okPages.length,
      pagesRequested: allPages.length,
      pages: allPages.map(pageSummary),
    },
    infra: {
      robotsTxtPresent: robots.ok,
      robotsTxtSnippet: robots.ok ? robots.body.slice(0, 300) : "",
      sitemapXmlPresent: sitemap.ok,
    },
  };

  facts.scoring = computeScore(facts, pagespeed);
  return facts;
}
