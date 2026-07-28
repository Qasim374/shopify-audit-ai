// report.js — turns the collected facts into a client-friendly Markdown report.
// The facts are gathered by collector.js; Claude only WRITES about evidence it is
// given, so the report stays grounded instead of guessing.

import Anthropic from "@anthropic-ai/sdk";

export const SYSTEM_PROMPT = `You are a senior Shopify e-commerce auditor writing a professional audit report for a store owner or client.

You will be given a JSON object of REAL, measured facts collected from the store's homepage PLUS a sample of its product and collection pages. The per-page breakdown is in \`scan.pages\`; the top-level \`images\` object is the AGGREGATE across all scanned pages. \`pagespeed\` holds Google PageSpeed (Lighthouse) scores when available. \`scoring\` holds a PRE-COMPUTED quality score: \`scoring.total\` (0-100), \`scoring.rating\`, and \`scoring.categories\` (each with \`label\`, \`weight\`, and \`subScore\`).

CRITICAL: The numbers in \`scoring\` and \`pagespeed\` were calculated by code. Report them EXACTLY as given — never recompute, round differently, or change them. You explain the numbers; you do not produce them. Base every finding strictly on the evidence; do not invent problems the data does not support.

Write the report in clean Markdown with this structure:

# Shopify Store Audit Report

**Store:** <url>
**Date:** <today>

## Overall Score
State the total as **{scoring.total} / 100 — {scoring.rating}**. Then list each category from \`scoring.categories\` as a bullet: "**{label}:** {subScore}/100 (weight {weight}%)". Report these numbers exactly as given.

## Executive Summary
A short paragraph: state how many pages were scanned (from \`scan.pagesScanned\`) and which types, the overall health (reference the score), the single most important thing to fix, and a rough count of issues by priority.

## Findings
Group findings under these categories (omit a category only if there is genuinely nothing to say):
- Performance
- SEO
- UX / UI
- Accessibility
- Conversion Optimization
- Shopify Best Practices
- Bugs & Broken Elements

For EACH finding use exactly this block format:

### <Short issue title>
- **Issue:** what is wrong (reference the concrete number/evidence)
- **Impact:** why it matters for sales or user experience
- **Recommendation:** the specific, actionable fix
- **Priority:** Critical | High | Medium | Low
- **Expected Impact:** the likely effect on sales/UX if fixed
- **Examples:** If the data provides URLs for this issue (e.g. \`missingAltSamples\`, \`legacyFormatSamples\`, or broken link URLs), show up to 3 of them as clickable Markdown links. A complete list of every affected URL is appended automatically after your report, so do NOT try to list them all here. Omit this line when the data has no URLs for the finding.

## Prioritized Action Plan
A numbered list of the top 5–8 fixes in priority order, each one line.

Rules:
- Be specific and quantitative — cite the actual numbers from the data (e.g. "37 of 52 images are missing alt text").
- Priority must reflect real business impact, not just technical severity.
- Keep the tone professional, confident, and jargon-light so a non-technical store owner understands it.
- Do not include raw JSON or code fences in the report body.`;

/** Trim the big example-URL arrays before sending to the AI, so the prompt
 * stays well under free-tier token limits. The full lists are re-attached to
 * the finished report by buildAffectedUrlsAppendix(). */
function trimFactsForPrompt(facts, perList = 6) {
  const clone = JSON.parse(JSON.stringify(facts));
  if (clone.images) {
    clone.images.missingAltSamples = (clone.images.missingAltSamples || []).slice(0, perList);
    clone.images.legacyFormatSamples = (clone.images.legacyFormatSamples || []).slice(0, perList);
  }
  return clone;
}

export function buildUserContent(facts, today) {
  return [
    `Today's date: ${today}`,
    `Store URL: ${facts.scannedUrl}`,
    "",
    "Collected facts (JSON):",
    "```json",
    JSON.stringify(trimFactsForPrompt(facts), null, 2),
    "```",
    "",
    "Write the full audit report now, following the required structure exactly.",
  ].join("\n");
}

/** Build a code-generated appendix listing EVERY affected URL (no AI tokens). */
export function buildAffectedUrlsAppendix(facts) {
  const sections = [];
  const alt = facts.images?.missingAltSamples || [];
  const legacy = facts.images?.legacyFormatSamples || [];
  const broken = (facts.links?.broken || []).map((b) => b.url);

  if (alt.length) {
    sections.push(
      `### Images missing alt text (${facts.images.missingAlt} total)\n` +
        alt.map((u) => `- ${u}`).join("\n")
    );
  }
  if (legacy.length) {
    sections.push(
      `### Legacy-format images (${facts.images.legacyFormatCount} total)\n` +
        legacy.map((u) => `- ${u}`).join("\n")
    );
  }
  if (broken.length) {
    sections.push(`### Broken links\n` + broken.map((u) => `- ${u}`).join("\n"));
  }
  if (!sections.length) return "";
  return `\n\n---\n\n## Appendix — Affected URLs\n\n${sections.join("\n\n")}\n`;
}

/** Append the full affected-URL appendix to a generated report. */
export function finalizeReport(markdown, facts) {
  return markdown.trimEnd() + buildAffectedUrlsAppendix(facts);
}

/**
 * FREE mode: build a single paste-ready prompt (instructions + facts) that the
 * user can drop into claude.ai / ChatGPT / Gemini web to get the report — no API
 * key or billing required.
 */
export function buildPastePrompt(facts, { today }) {
  return `${SYSTEM_PROMPT}\n\n---\n\n${buildUserContent(facts, today)}`;
}

export async function generateReport(facts, { today }) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY (or an `ant auth login` profile)

  const userContent = buildUserContent(facts, today);

  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const message = await stream.finalMessage();
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return text;
}
