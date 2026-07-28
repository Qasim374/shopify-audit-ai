#!/usr/bin/env node
// Shopify Store Audit AI — CLI entry point.
// Usage: node index.js <store-url> [--out report.md]

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { collectAudit } from "./src/collector.js";
import { generateReport, buildPastePrompt, finalizeReport } from "./src/report.js";
import { generateReportGemini } from "./src/gemini.js";
import { generateReportGroq } from "./src/groq.js";
import { generatePdf } from "./src/pdf.js";

/** Load KEY=value lines from a local .env file into process.env (if present). */
async function loadEnvFile() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = await readFile(join(here, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env file — that's fine, env vars can be set another way */
  }
}

function parseArgs(argv) {
  const args = { url: null, out: null, free: false, provider: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "-o") args.out = argv[++i];
    else if (a === "--free" || a === "--paste") args.free = true;
    else if (a === "--gemini") args.provider = "gemini";
    else if (a === "--groq") args.provider = "groq";
    else if (a === "--claude") args.provider = "claude";
    else if (!a.startsWith("-") && !args.url) args.url = a;
  }
  return args;
}

/** Decide which AI provider to use: explicit flag > whichever key is set. */
function pickProvider(explicit) {
  if (explicit) return explicit;
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

function slugify(url) {
  return url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60);
}

async function main() {
  await loadEnvFile();
  const { url, out, free, provider: forced } = parseArgs(process.argv);

  if (!url) {
    console.error("Usage: node index.js <store-url> [--out report.md] [--free] [--gemini|--claude]");
    console.error("Example: node index.js https://example.myshopify.com");
    console.error("  --free   : skip the API — write a paste-ready prompt for claude.ai/ChatGPT/Gemini");
    console.error("  --gemini : use Google Gemini (free tier) to write the report automatically");
    console.error("  --claude : use Anthropic Claude to write the report");
    process.exit(1);
  }

  const provider = free ? null : pickProvider(forced);

  if (!free && !provider) {
    console.error("No AI provider key found.");
    console.error("Run one of these:");
    console.error("  Groq (free):      set GROQ_API_KEY, then run normally  (get a key: https://console.groq.com/keys)");
    console.error("  FREE (no key):    node index.js " + url + " --free");
    console.error("  Gemini (free*):   set GEMINI_API_KEY  (*free tier not available in all regions)");
    console.error("  Claude (paid):    set ANTHROPIC_API_KEY, then run normally");
    console.error("PowerShell example:  $env:GROQ_API_KEY=\"...\"; node index.js " + url);
    process.exit(1);
  }

  console.error(`\n🔍  Scanning ${url} ...`);
  const facts = await collectAudit(url);

  if (!facts.shopify.isShopify) {
    console.error(
      "⚠️  This does not look like a Shopify store (no Shopify markers found). Continuing with a general audit anyway."
    );
  } else {
    console.error(`✓  Shopify detected (${facts.shopify.evidence.join(", ")})`);
  }
  console.error(
    `✓  Collected facts: ${facts.images.total} images, ${facts.apps.detected.length} apps, ` +
      `${facts.links.checked} links checked (${facts.links.broken.length} broken)`
  );

  const today = new Date().toISOString().slice(0, 10);

  if (free) {
    const prompt = buildPastePrompt(facts, { today });
    const outPath = out || `audit-prompt-${slugify(url)}.txt`;
    await writeFile(outPath, prompt, "utf8");
    console.error(`\n✅  Paste-ready prompt saved to ${outPath}`);
    console.error("   Next: open claude.ai (or ChatGPT / Gemini), paste the whole file, send.");
    console.error("   The model will write the full audit report for free.\n");
    return;
  }

  const providerLabel = { groq: "Groq (free)", gemini: "Gemini", claude: "Claude" }[provider];
  console.error(`🧠  Writing report with ${providerLabel} ...`);
  const rawReport =
    provider === "groq"
      ? await generateReportGroq(facts, { today })
      : provider === "gemini"
      ? await generateReportGemini(facts, { today })
      : await generateReport(facts, { today });
  const report = finalizeReport(rawReport, facts);

  const mdPath = out || `audit-${slugify(url)}.md`;
  await writeFile(mdPath, report, "utf8");
  console.error(`\n✅  Markdown report saved to ${mdPath}`);

  const pdfPath = mdPath.replace(/\.md$/i, "") + ".pdf";
  try {
    await generatePdf(report, pdfPath, { title: `Audit — ${url}` });
    console.error(`✅  PDF report saved to     ${pdfPath}\n`);
  } catch (err) {
    console.error(`⚠️  Could not build PDF (${err.message}). Markdown is still saved.\n`);
  }
}

main().catch((err) => {
  console.error(`\n❌  ${err.message}\n`);
  process.exit(1);
});
