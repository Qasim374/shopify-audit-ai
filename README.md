# Shopify Store Audit AI

Audit a Shopify store from its **public URL** and generate a client-friendly Markdown
report — website issues, UX/UI, SEO, performance, accessibility, conversion
opportunities, Shopify best-practice violations, and broken elements.

## How it works

The tool has two layers, so the report is grounded in **real evidence** instead of
AI guesses:

1. **Collector** (`src/collector.js`) — fetches the store's homepage and measures
   real signals: page size, load time, meta tags, structured data, image alt/format,
   accessibility, render-blocking scripts, installed apps, robots.txt/sitemap, and a
   sample of internal links checked for 404s.
2. **Report writer** (`src/report.js`) — sends those facts to Claude
   (`claude-opus-4-8`), which writes the report in the required format:
   **Issue → Impact → Recommendation → Priority → Expected Impact.**

## Setup

```bash
npm install
```

## Usage

### Free mode (no API key, no billing) — recommended to start

Scans the store and writes a **paste-ready prompt** you drop into free
[claude.ai](https://claude.ai), ChatGPT, or Gemini web to get the report:

```bash
node index.js https://your-store.myshopify.com --free
```

Then open the `.txt` file, copy everything, paste it into the chat, and send.

### Gemini mode (automatic + free) — recommended

Get a **free** API key at <https://aistudio.google.com/apikey>, then:

```powershell
$env:GEMINI_API_KEY = "your-gemini-key"
node index.js https://your-store.myshopify.com
```

The tool writes the finished report straight to `audit-<store>.md` — no pasting,
no cost (Gemini free tier). Force it explicitly with `--gemini`.

Optional: change the model with `$env:GEMINI_MODEL = "gemini-2.5-flash"`.

### Claude mode (automatic, paid per-use)

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
node index.js https://your-store.myshopify.com --claude
```

The report is written to `audit-<store>.md` (or the `--out` path). Each report
costs only a few cents.

### Provider selection

- If `GEMINI_API_KEY` is set → uses Gemini automatically.
- Else if `ANTHROPIC_API_KEY` is set → uses Claude.
- `--gemini` / `--claude` force a specific provider; `--free` skips the API entirely.

## Quality score (0–100)

Every audit produces an objective **0–100 quality score**, computed in code (never
by the AI) from five weighted categories:

| Category | Weight | Source |
|---|---|---|
| Performance | 30% | Google PageSpeed (mobile) or a markup heuristic |
| SEO Basics | 20% | title, meta, H1, alt-text %, sitemap, HTTPS, schema |
| Technical Health | 15% | broken links, HTTPS |
| Mobile / Accessibility | 15% | PageSpeed accessibility or a heuristic |
| Design / UX | 20% | structural heuristic (visual scoring planned) |

The AI only *explains* these numbers — it never invents them.

**Optional — real Google speed scores:** without a key the Performance and
Accessibility scores fall back to heuristics. For real Lighthouse numbers, get a
free [PageSpeed API key](https://developers.google.com/speed/docs/insights/v5/get-started)
and set `PAGESPEED_API_KEY` (in `.env` and in Vercel's env vars).

## Web app (Next.js) + Vercel deploy

There's also a browser UI: paste a URL, click **Generate Report**, view it, and
download **PDF** or **Markdown**.

### Run the web app locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. (Reads the AI key from `.env`, same as the CLI.)

### Deploy to Vercel

1. Push this folder to a GitHub repo.
2. On [vercel.com](https://vercel.com) → **New Project** → import the repo.
3. Framework preset: **Next.js** (auto-detected). No build changes needed.
4. **Environment Variables** → add `GROQ_API_KEY` = your Groq key.
   *(Do not commit `.env` — it's gitignored. Set the key in Vercel's dashboard.)*
5. **Deploy.** Your audit tool is live at `your-project.vercel.app`.

Notes:
- The audit runs as a serverless function (`maxDuration` 60s) — enough for the
  scan + AI report.
- PDF is generated with pdfkit (pure JS), so it works on Vercel — no Chromium.

## Limitations (MVP)

- **Public scan only** — analyzes the homepage as a visitor sees it; no theme code
  or Shopify Admin API access, so findings are limited to what's publicly observable.
- Performance signals are markup-derived heuristics, not a full Lighthouse run.
- Link checking samples up to ~12 internal links.

## Roadmap ideas

- Deeper crawl (product + collection pages)
- Real Lighthouse / PageSpeed Insights integration
- PDF export
- Shopify Admin API mode for authenticated, deeper audits
