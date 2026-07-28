// pagespeed.js — fetch Google PageSpeed Insights (Lighthouse) scores for a URL.
// Free, no key required (an optional PAGESPEED_API_KEY raises the quota).
// Returns null on failure/timeout so the audit still works without it.

export async function fetchPageSpeed(url, { timeoutMs = 25000 } = {}) {
  const key = process.env.PAGESPEED_API_KEY;
  const params = new URLSearchParams({ url, strategy: "mobile" });
  params.append("category", "performance");
  params.append("category", "accessibility");
  params.append("category", "best-practices");
  params.append("category", "seo");
  if (key) params.append("key", key);

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const cats = data?.lighthouseResult?.categories;
    if (!cats) return null;
    const pct = (c) => (c && typeof c.score === "number" ? Math.round(c.score * 100) : null);
    const audits = data?.lighthouseResult?.audits || {};
    return {
      available: true,
      performance: pct(cats.performance),
      accessibility: pct(cats.accessibility),
      bestPractices: pct(cats["best-practices"]),
      seo: pct(cats.seo),
      metrics: {
        lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
        cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
        tbtMs: audits["total-blocking-time"]?.numericValue ?? null,
        speedIndexMs: audits["speed-index"]?.numericValue ?? null,
      },
    };
  } catch {
    return null; // timeout or network error — scoring will fall back to heuristics
  } finally {
    clearTimeout(timer);
  }
}
