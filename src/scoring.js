// scoring.js — compute an objective 0-100 quality score from collected facts +
// PageSpeed data. Every number here is rule-based and deterministic; the LLM
// only explains these numbers, it never produces them.

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function performanceScore(facts, ps) {
  if (ps?.available && typeof ps.performance === "number") {
    return { subScore: ps.performance, source: "Google PageSpeed (mobile)" };
  }
  // Fallback heuristic from markup signals.
  const p = facts.performance || {};
  let s = 100;
  if (p.htmlSizeKB > 1000) s -= 40;
  else if (p.htmlSizeKB > 500) s -= 20;
  s -= Math.min((p.renderBlockingHeadScripts || 0) * 5, 20);
  if ((p.externalScriptCount || 0) > 20) s -= 15;
  return { subScore: clamp(s), source: "heuristic (PageSpeed unavailable)" };
}

function seoScore(facts) {
  const seo = facts.seo || {};
  const img = facts.images || {};
  let s = 0;
  if (seo.title && seo.titleLength >= 10 && seo.titleLength <= 70) s += 15;
  else if (seo.title) s += 8;
  if (seo.metaDescription && seo.metaDescriptionLength >= 50 && seo.metaDescriptionLength <= 160) s += 15;
  else if (seo.metaDescription) s += 8;
  if (seo.h1Count === 1) s += 10;
  else if (seo.h1Count > 1) s += 5;
  const altCoverage = img.total ? 1 - img.missingAlt / img.total : 1;
  s += Math.round(altCoverage * 25);
  if (facts.infra?.sitemapXmlPresent) s += 10;
  if (facts.https) s += 10;
  if ((seo.structuredDataTypes || []).length > 0) s += 15;
  return { subScore: clamp(s), source: "rule-based" };
}

function technicalScore(facts) {
  let s = 100;
  const broken = facts.links?.broken?.length || 0;
  s -= Math.min(broken * 25, 75);
  if (!facts.https) s -= 30;
  return { subScore: clamp(s), source: "rule-based" };
}

function accessibilityScore(facts, ps) {
  if (ps?.available && typeof ps.accessibility === "number") {
    return { subScore: ps.accessibility, source: "Google PageSpeed (mobile)" };
  }
  const a = facts.accessibility || {};
  const seo = facts.seo || {};
  let s = 100;
  if (!seo.viewportPresent) s -= 30;
  if (!a.htmlLangPresent) s -= 15;
  s -= Math.min((a.buttonsWithoutAccessibleText || 0) * 3, 30);
  s -= Math.min((a.formInputsWithoutLabel || 0) * 3, 15);
  return { subScore: clamp(s), source: "heuristic (PageSpeed unavailable)" };
}

function designScore(facts) {
  // Phase 1: no screenshot yet, so this is a structural heuristic (not a visual
  // judgement). Phase 2 will replace it with vision-based scoring.
  const img = facts.images || {};
  const perf = facts.performance || {};
  const apps = facts.apps?.detected || [];
  let s = 80; // neutral baseline — we can't see the design yet
  const legacyRatio = img.total ? img.legacyFormatCount / img.total : 0;
  if (legacyRatio > 0.5) s -= 15;
  else if (legacyRatio > 0.25) s -= 8;
  if (perf.htmlSizeKB > 1000) s -= 10;
  if ((perf.externalScriptCount || 0) > 25) s -= 5;
  if (apps.some((a) => /Reviews|Yotpo|Loox|Judge/i.test(a))) s += 8; // social proof
  return { subScore: clamp(s), source: "structural heuristic (no visual yet)" };
}

function ratingLabel(total) {
  if (total >= 85) return "Excellent";
  if (total >= 70) return "Good";
  if (total >= 55) return "Fair";
  if (total >= 40) return "Needs work";
  return "Poor";
}

export function computeScore(facts, pagespeed) {
  const defs = [
    { key: "performance", label: "Performance", weight: 30, ...performanceScore(facts, pagespeed) },
    { key: "seo", label: "SEO Basics", weight: 20, ...seoScore(facts) },
    { key: "technical", label: "Technical Health", weight: 15, ...technicalScore(facts) },
    { key: "accessibility", label: "Mobile / Accessibility", weight: 15, ...accessibilityScore(facts, pagespeed) },
    { key: "design", label: "Design / UX", weight: 20, ...designScore(facts) },
  ];
  const categories = defs.map((c) => ({
    ...c,
    weighted: Math.round((c.subScore * c.weight) / 100),
  }));
  const total = clamp(Math.round(categories.reduce((sum, c) => sum + (c.subScore * c.weight) / 100, 0)));
  return { total, rating: ratingLabel(total), categories };
}
