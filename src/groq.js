// groq.js — generates the audit report using Groq (free, fast, no card needed).
// Groq exposes an OpenAI-compatible endpoint, so we just POST with fetch.
// Get a free key at: https://console.groq.com/keys

import { SYSTEM_PROMPT, buildUserContent } from "./report.js";

// Groq rotates its model catalogue often, so we try a list in order and fall
// through to the next one if a model has been removed (404 / model_not_found).
// Order = best quality first; the last entry is the most reliably-available.
const CANDIDATE_MODELS = process.env.GROQ_MODEL
  ? [process.env.GROQ_MODEL]
  : [
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "llama-3.1-8b-instant",
    ];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function errorDetail(res) {
  try {
    const err = await res.json();
    return err?.error?.message || "";
  } catch {
    return "";
  }
}

export async function generateReportGroq(facts, { today }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Missing GROQ_API_KEY environment variable.");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserContent(facts, today) },
  ];

  const callModel = (model) =>
    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.4, max_tokens: 3000, messages }),
    });

  let lastError = null;

  for (const model of CANDIDATE_MODELS) {
    // Free tier is a rolling per-minute token window; on 429 wait briefly (capped
    // to stay within the serverless timeout) and retry this model once.
    let res = await callModel(model);
    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get("retry-after") || "0");
      await sleep(Math.min(Math.max(retryAfter || 8, 3), 20) * 1000);
      res = await callModel(model);
    }

    if (res.ok) {
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      if (text.trim()) return text;
      lastError = new Error("Groq returned an empty response.");
      continue; // try the next model
    }

    const detail = await errorDetail(res);

    if (res.status === 401) throw new Error("Groq rejected the API key. Check GROQ_API_KEY is correct.");
    if (res.status === 413) {
      throw new Error(
        "This store is too large for Groq's free-tier per-minute token limit. " +
          "Try a smaller store, wait a minute, or upgrade the Groq tier."
      );
    }
    if (res.status === 429) {
      throw new Error(
        "Hit Groq's free-tier per-minute token limit. Please wait about a minute and generate one report (avoid rapid repeat clicks)."
      );
    }
    // Model removed/unavailable, or a transient server error → try the next model.
    if (res.status === 404 || res.status >= 500 || /decommission|does not exist|not found|model_not_found/i.test(detail)) {
      lastError = new Error(`Model "${model}" unavailable${detail ? ": " + detail : ""}`);
      continue;
    }
    throw new Error(`Groq API error ${res.status}${detail ? ": " + detail : ""}`);
  }

  throw new Error(
    "All Groq models are currently unavailable. " + (lastError ? lastError.message : "Try again shortly.")
  );
}
