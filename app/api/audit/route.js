// POST /api/audit  { url }  ->  { facts, markdown }
// Runs the collector + AI report writer on the server (serverless on Vercel).

import { NextResponse } from "next/server";
import { collectAudit } from "../../../src/collector.js";
import { generateReportGroq } from "../../../src/groq.js";
import { generateReportGemini } from "../../../src/gemini.js";
import { generateReport as generateReportClaude, finalizeReport } from "../../../src/report.js";

export const runtime = "nodejs"; // needs Node APIs (cheerio, fetch, streams)
export const maxDuration = 60; // allow up to 60s for scan + AI

function pickProvider() {
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const url = (body?.url || "").trim();
  if (!url) return NextResponse.json({ error: "Please provide a store URL." }, { status: 400 });

  const provider = pickProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "No AI key configured on the server. Set GROQ_API_KEY in your environment variables." },
      { status: 500 }
    );
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const facts = await collectAudit(url);
    const raw =
      provider === "groq"
        ? await generateReportGroq(facts, { today })
        : provider === "gemini"
        ? await generateReportGemini(facts, { today })
        : await generateReportClaude(facts, { today });
    const markdown = finalizeReport(raw, facts);

    return NextResponse.json({ facts, markdown });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Audit failed." }, { status: 502 });
  }
}
