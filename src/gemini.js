// gemini.js — generates the audit report using Google's Gemini API (free tier).
// Uses the REST endpoint via fetch, so no extra npm dependency is needed.
// Get a free key at: https://aistudio.google.com/apikey

import { SYSTEM_PROMPT, buildUserContent } from "./report.js";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export async function generateReportGemini(facts, { today }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY environment variable.");

  const model = DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: buildUserContent(facts, today) }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || "";
    } catch {
      /* ignore */
    }
    if (res.status === 400 && /API key not valid/i.test(detail)) {
      throw new Error("Gemini rejected the API key. Check GEMINI_API_KEY is correct.");
    }
    if (res.status === 429) {
      throw new Error("Gemini free-tier rate limit hit. Wait a minute and try again.");
    }
    if (res.status === 404) {
      throw new Error(
        `Gemini model "${model}" not found. Set a valid model, e.g. GEMINI_MODEL=gemini-2.0-flash`
      );
    }
    throw new Error(`Gemini API error ${res.status}${detail ? ": " + detail : ""}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  if (!text.trim()) throw new Error("Gemini returned an empty response.");
  return text;
}
