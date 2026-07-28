"use client";

import { useState } from "react";
import { marked } from "marked";

function scoreColor(n) {
  if (n >= 85) return "#51cf66";
  if (n >= 70) return "#94d82d";
  if (n >= 55) return "#ffd43b";
  if (n >= 40) return "#ffa94d";
  return "#ff6b6b";
}

function ScoreCard({ scoring }) {
  const c = scoreColor(scoring.total);
  return (
    <div className="scorecard">
      <div className="score-ring" style={{ "--c": c, "--pct": scoring.total }}>
        <div className="score-num" style={{ color: c }}>
          {scoring.total}
          <small>/100</small>
        </div>
        <div className="score-rating">{scoring.rating}</div>
      </div>
      <div className="score-cats">
        {scoring.categories.map((cat) => (
          <div className="score-cat" key={cat.key}>
            <div className="score-cat-top">
              <span>{cat.label}</span>
              <b>{cat.subScore}/100</b>
            </div>
            <div className="score-bar">
              <div
                className="score-bar-fill"
                style={{ width: `${cat.subScore}%`, background: scoreColor(cat.subScore) }}
              />
            </div>
            <div className="score-cat-meta">
              weight {cat.weight}% · {cat.source}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function slugify(url) {
  return (url || "report")
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [facts, setFacts] = useState(null);

  async function runAudit(e) {
    e.preventDefault();
    setError("");
    setMarkdown("");
    setFacts(null);
    setLoading(true);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Audit failed.");
      setMarkdown(data.markdown);
      setFacts(data.facts);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function downloadMd() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `audit-${slugify(url)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function downloadPdf() {
    const res = await fetch("/api/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown, filename: `audit-${slugify(url)}` }),
    });
    if (!res.ok) {
      setError("Could not generate PDF.");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `audit-${slugify(url)}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const reportHtml = markdown ? marked.parse(markdown) : "";

  return (
    <div className="wrap">
      <div className="hero">
        <h1>
          Shopify Store <span>Audit AI</span>
        </h1>
        <p>Paste a store URL — get a client-ready audit report in seconds.</p>
      </div>

      <div className="panel">
        <form className="form" onSubmit={runAudit}>
          <input
            type="text"
            placeholder="https://your-store.myshopify.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
          />
          <button type="submit" disabled={loading || !url.trim()}>
            {loading ? "Auditing…" : "Generate Report"}
          </button>
        </form>
        <div className="hint">
          Works on any public Shopify store (or any website). Homepage scan.
        </div>

        {loading && (
          <div className="status">
            <span className="spinner" />
            Scanning the store and writing the report… this can take up to a minute.
          </div>
        )}
        {error && <div className="error">⚠️ {error}</div>}
      </div>

      {facts && facts.scoring && (
        <ScoreCard scoring={facts.scoring} />
      )}

      {facts && (
        <>
          <div className="stats">
            <div className="stat">
              <b>{facts.shopify?.isShopify ? "Yes" : "No"}</b>
              <span>Shopify</span>
            </div>
            <div className="stat">
              <b>{facts.scan?.pagesScanned ?? 1}</b>
              <span>Pages scanned</span>
            </div>
            <div className="stat">
              <b>{facts.images?.total ?? 0}</b>
              <span>Images</span>
            </div>
            <div className="stat">
              <b>{facts.images?.missingAlt ?? 0}</b>
              <span>Missing alt</span>
            </div>
            <div className="stat">
              <b>{facts.performance?.htmlSizeKB ?? 0} KB</b>
              <span>Page size</span>
            </div>
            <div className="stat">
              <b>{facts.links?.broken?.length ?? 0}</b>
              <span>Broken links</span>
            </div>
          </div>

          <div className="actions">
            <button onClick={downloadPdf}>⬇ Download PDF</button>
            <button onClick={downloadMd}>⬇ Download Markdown</button>
          </div>

          <div className="report" dangerouslySetInnerHTML={{ __html: reportHtml }} />
        </>
      )}

      <div className="footer">Shopify Store Audit AI · homepage scan · report by AI</div>
    </div>
  );
}
