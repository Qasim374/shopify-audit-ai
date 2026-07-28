// pdf.js — render the Markdown report to a clean, styled PDF using pdfkit.
// Pure JavaScript, no headless browser / Chromium download required.

import { createWriteStream } from "node:fs";
import PDFDocument from "pdfkit";
import { marked } from "marked";

const COLORS = {
  heading: "#1a1a2e",
  accent: "#16213e",
  body: "#222222",
  muted: "#555555",
  link: "#1a5cff",
  rule: "#dddddd",
};

const PRIORITY_COLORS = {
  critical: "#c0392b",
  high: "#e67e22",
  medium: "#2e86de",
  low: "#27ae60",
};

/** Render an array of marked inline tokens onto the current text line. */
function renderInline(doc, tokens, baseFont, size) {
  const parts = tokens || [];
  parts.forEach((t, i) => {
    const isLast = i === parts.length - 1;
    const opts = { continued: !isLast };
    switch (t.type) {
      case "strong":
        doc.font("Helvetica-Bold").fillColor(COLORS.body);
        doc.text(t.text, opts);
        doc.font(baseFont).fillColor(COLORS.body);
        break;
      case "em":
        doc.font("Helvetica-Oblique");
        doc.text(t.text, opts);
        doc.font(baseFont);
        break;
      case "codespan":
        doc.font("Courier").fillColor(COLORS.accent);
        doc.text(t.text, opts);
        doc.font(baseFont).fillColor(COLORS.body);
        break;
      case "link":
        doc.fillColor(COLORS.link);
        doc.text(t.text || t.href, { ...opts, link: t.href, underline: true });
        doc.fillColor(COLORS.body);
        break;
      default:
        doc.font(baseFont).fillColor(COLORS.body);
        doc.text(t.text ?? t.raw ?? "", opts);
    }
  });
}

/** Colour the "Priority: High" style line for quick scanning. */
function renderPriorityAware(doc, tokens) {
  const raw = (tokens || []).map((t) => t.text ?? t.raw ?? "").join("");
  const m = raw.match(/priority:\s*(critical|high|medium|low)/i);
  if (m) {
    const level = m[1].toLowerCase();
    doc.font("Helvetica-Bold").fillColor(COLORS.body).text("Priority: ", { continued: true });
    doc.fillColor(PRIORITY_COLORS[level]).text(m[1].toUpperCase());
    doc.fillColor(COLORS.body);
    return true;
  }
  return false;
}

function renderList(doc, listToken, depth = 0) {
  const indent = 18 + depth * 16;
  for (const item of listToken.items) {
    const bullet = listToken.ordered ? "•" : depth > 0 ? "◦" : "•";
    const startY = doc.y;
    doc.font("Helvetica").fillColor(COLORS.accent).text(bullet, indent - 12, startY, {
      continued: false,
      width: 10,
    });
    doc.y = startY;
    doc.x = indent;
    // Each item may contain text tokens and nested lists.
    for (const child of item.tokens) {
      if (child.type === "list") {
        renderList(doc, child, depth + 1);
      } else {
        const inline = child.tokens || [{ type: "text", text: child.text }];
        if (!renderPriorityAware(doc, inline)) {
          doc.font("Helvetica").fillColor(COLORS.body);
          renderInline(doc, inline, "Helvetica", 10.5);
        }
      }
    }
    doc.x = doc.page.margins.left;
    doc.moveDown(0.25);
  }
}

/** Render the parsed report into an existing pdfkit document. */
function renderReport(doc, markdown) {
  {
    doc.fontSize(10.5).fillColor(COLORS.body).font("Helvetica");
    const tokens = marked.lexer(markdown);

    for (const tok of tokens) {
      switch (tok.type) {
        case "heading": {
          const sizes = { 1: 22, 2: 15, 3: 12.5 };
          const size = sizes[tok.depth] || 11;
          doc.moveDown(tok.depth === 1 ? 0.2 : 0.6);
          doc
            .font("Helvetica-Bold")
            .fontSize(size)
            .fillColor(tok.depth <= 2 ? COLORS.heading : COLORS.accent)
            .text(tok.text);
          if (tok.depth === 1) {
            doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
              .strokeColor(COLORS.rule).stroke();
          }
          doc.moveDown(0.3).fontSize(10.5).fillColor(COLORS.body).font("Helvetica");
          break;
        }
        case "paragraph":
          doc.font("Helvetica").fontSize(10.5).fillColor(COLORS.body);
          renderInline(doc, tok.tokens, "Helvetica", 10.5);
          doc.moveDown(0.5);
          break;
        case "list":
          renderList(doc, tok);
          doc.moveDown(0.3);
          break;
        case "hr":
          doc.moveDown(0.3).moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .strokeColor(COLORS.rule).stroke();
          doc.moveDown(0.5);
          break;
        case "space":
          doc.moveDown(0.3);
          break;
        default:
          if (tok.text) {
            doc.font("Helvetica").fontSize(10.5).fillColor(COLORS.body).text(tok.text);
            doc.moveDown(0.3);
          }
      }
    }

  }
}

function newDoc() {
  return new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } });
}

/** CLI: render the report to a PDF file on disk. */
export function generatePdf(markdown, outPath) {
  return new Promise((resolve, reject) => {
    const doc = newDoc();
    const stream = createWriteStream(outPath);
    doc.pipe(stream);
    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);
    renderReport(doc, markdown);
    doc.end();
  });
}

/** Web/serverless: render the report to an in-memory PDF Buffer. */
export function generatePdfBuffer(markdown) {
  return new Promise((resolve, reject) => {
    const doc = newDoc();
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    renderReport(doc, markdown);
    doc.end();
  });
}
