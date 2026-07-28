// POST /api/pdf  { markdown, filename }  ->  application/pdf download
import { generatePdfBuffer } from "../../../src/pdf.js";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  const markdown = body?.markdown;
  if (!markdown) return new Response("Missing markdown.", { status: 400 });

  const filename = (body?.filename || "audit-report").replace(/[^a-z0-9._-]/gi, "-");

  try {
    const pdf = await generatePdfBuffer(markdown);
    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}.pdf"`,
      },
    });
  } catch (err) {
    return new Response("PDF generation failed: " + (err.message || "unknown"), { status: 500 });
  }
}
