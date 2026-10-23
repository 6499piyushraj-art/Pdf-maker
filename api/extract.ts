import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ThinkingLevel } from "@google/genai";
import { protectedApiError } from "../src/server/auth";
import { hasGeminiApiKey, withGeminiApiKeyFailover } from "../src/server/gemini";
import { shouldFlagForReview } from "../src/lib/question-quality";

type Input = { fileName?: unknown; pageNumber?: unknown; pageCount?: unknown; pageText?: unknown; imageData?: unknown; imageDataSegments?: unknown; focusedOnly?: unknown };
type RawQuestion = { questionText?: unknown; options?: unknown; diagramDescription?: unknown; confidence?: unknown; reviewRequired?: unknown; reviewNotes?: unknown };

function json(res: VercelResponse, status: number, body: unknown) {
  return res.status(status).setHeader("Cache-Control", "no-store").setHeader("X-Content-Type-Options", "nosniff").setHeader("Content-Type", "application/json; charset=utf-8").json(body);
}
function parseBody(body: unknown): Input | null {
  if (typeof body === "string") { try { return JSON.parse(body) as Input; } catch { return null; } }
  return body && typeof body === "object" ? body as Input : null;
}
function parseModelJson(text: string): any {
  const clean = text.trim().replace(/^\uFEFF/, "").replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
  try { return JSON.parse(clean); } catch {
    const first = clean.indexOf("{"); const last = clean.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(clean.slice(first, last + 1));
    throw new Error("Gemini returned invalid JSON.");
  }
}
function cleanString(value: unknown, max = 12000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Use POST." }); }
  if (protectedApiError(req, res)) return;
  const body = parseBody(req.body);
  if (!body) return json(res, 400, { error: "Invalid JSON request." });
  const fileName = cleanString(body.fileName, 240) || "uploaded.pdf";
  const pageNumber = Number(body.pageNumber);
  const pageCount = Number(body.pageCount);
  const pageText = cleanString(body.pageText, 30000);
  const imageData = typeof body.imageData === "string" ? body.imageData : "";
  const imageDataSegments = Array.isArray(body.imageDataSegments) ? body.imageDataSegments.filter((v): v is string => typeof v === "string") : [];
  const focusedOnly = body.focusedOnly === true;
  const imageBytesTotal = imageData.length + imageDataSegments.reduce((sum, value) => sum + value.length, 0);
  if (imageDataSegments.length > 2 || imageData.length > 1750000 || imageDataSegments.some(value => value.length > 1250000) || imageBytesTotal > 3650000) return json(res, 413, { error: "Focused page images are too large. Try a lower-resolution PDF." });
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isInteger(pageCount) || pageCount < pageNumber) return json(res, 400, { error: "Invalid PDF page metadata." });
  if (!pageText && !imageData && imageDataSegments.length === 0) return json(res, 422, { error: "This page has no readable text or rendered image." });
  if ([imageData, ...imageDataSegments].some(value => value && !/^[A-Za-z0-9+/=]+$/.test(value))) return json(res, 400, { error: "Rendered page image data is invalid." });
  if (!hasGeminiApiKey()) return json(res, 503, { error: "Configure GEMINI_API_KEY_1 through GEMINI_API_KEY_7 (or legacy GEMINI_API_KEY) on the server." });

  const prompt = [
    focusedOnly
      ? "You are a meticulous, high-recall exam-question extraction engine. This is a focused-only fallback: each attached image is a crop from the SAME original PDF page, not the full slide. First read the printed text beneath any 'Question [exam/year]', 'JEE Mains', or equivalent question banner; extract its printed stem and options, while ignoring handwritten working, ticks, circles and answers. If no such banner is present, identify and extract any visible printed question text."
      : "You are a meticulous, high-recall exam-question extraction engine. Inspect all supplied views of the SAME PDF page: the full slide for context and focused overlapping crops for small printed text. Read each view closely; the crops are not separate pages.",
    "IMAGE-ONLY RULE: when selectable text is missing or very short, the pixels are the source of truth, not an empty page. Inspect the printed banner, every stem line, each option, and lower/side regions. Return one JSON object per distinct printed question; never return only the clearest question if more than one is visible.",
    "IMPORTANT FOR LECTURE-SLIDE PDFs: if printed content is headed by a red or colored banner such as 'Question [JEE Mains-2023]', it IS a question and must be transcribed, even if a teacher has handwritten a solution over or beside it. Extract the printed problem statement, subparts, and printed options. Do not mistake handwritten calculations, circled answers or solution annotations for the question text.",
    "Extract EVERY actually visible exam/practice question: all numbered items (1., Q1, 1)), subparts (a), (b), (i), (ii), assertion/reason, matching, fill-in-the-blanks, true/false, numerical questions, passage-based questions, and questions that depend on a table, graph, circuit or diagram. A question does NOT need a question mark. Inspect both columns, the margins and the bottom of the page; never stop after the first question.",
    "Use selectable PDF text as a second source and reconcile it against the image; it can be incomplete, scrambled or missing entirely. Preserve visible wording, subpart labels, math symbols, superscripts/subscripts when readable, units, values, original language/script (including Hindi), and option order. Do not paraphrase, shorten, combine separate numbered questions, or skip a question because its wording is incomplete.",
    "Return only question statements, their subparts, options and necessary diagram descriptions. NEVER include answers, worked solutions, hints, explanations or answer-key text even when printed nearby. Ignore solution paragraphs. If part of a question is visibly present but unreadable, retain all legible text, mark the unreadable span [unclear], and require review instead of dropping the question or guessing.",
    "For any required diagram, geometry figure, graph or table, describe visible labels, shapes, axes, arrows and markings in diagramDescription without inventing details. For a continued question, capture the visible portion and flag it for review. Return an empty questions array ONLY when the page truly has no visible question; never create a question from headings, instructions or solution text.",
    "Return JSON only: {\"questions\":[{\"questionText\":\"...\",\"options\":[\"(A) ...\"],\"diagramDescription\":\"\",\"confidence\":0.0,\"reviewRequired\":false,\"reviewNotes\":[]}]}",
    "Source filename: " + fileName,
    "Page: " + pageNumber + " of " + pageCount,
    "Selectable PDF text (may be incomplete; the attached page image must also be inspected):",
    pageText || "[No selectable text; inspect the attached page image.]"
  ].join("\n");

  try {
    const parts: Array<{text:string} | {inlineData:{mimeType:string;data:string}}> = [{ text: prompt }];
    if (imageData) parts.push({ text: focusedOnly ? "FOCUSED CROP 1 (same page; this is not a full-page image):" : "FULL PAGE VIEW (context):" }, { inlineData: { mimeType: "image/jpeg", data: imageData } });
    imageDataSegments.forEach((data, index) => parts.push({ text: `FOCUSED CROP ${index + (focusedOnly ? 2 : 1)} (same page; inspect small question text):` }, { inlineData: { mimeType: "image/jpeg", data } }));
    const result = await withGeminiApiKeyFailover((ai) => ai.models.generateContent({
      model: process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }, maxOutputTokens: 16384 }
    }));
    const parsed = parseModelJson(result.text || "");
    if (!parsed || !Array.isArray(parsed.questions)) return json(res, 502, { error: "Gemini response did not contain a questions array." });
    const questions = (parsed.questions as RawQuestion[]).slice(0, 40).map((q) => {
      const questionText = cleanString(q?.questionText);
      const options = Array.isArray(q?.options) ? q.options.slice(0, 12).map((o) => cleanString(o, 1500)) : [];
      const confidence = typeof q?.confidence === "number" && Number.isFinite(q.confidence) ? Math.max(0, Math.min(1, q.confidence)) : 0.5;
      const diagramDescription = cleanString(q?.diagramDescription, 3000);
      const reviewNotes = Array.isArray(q?.reviewNotes) ? q.reviewNotes.slice(0, 8).map(n => cleanString(n, 500)).filter(Boolean) : [];
      const reviewRequired = shouldFlagForReview({ explicitReview: q?.reviewRequired, confidence, questionText, options, diagramDescription });
      if (!questionText) reviewNotes.push("Question text is missing or unreadable.");
      return { questionText, options, diagramDescription, confidence, reviewRequired: reviewRequired || !questionText, reviewNotes };
    }).filter(q => q.questionText);
    return json(res, 200, { fileName, pageNumber, questions, warning: questions.length === 40 ? "Question count was capped at 40 for one page." : undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini extraction failed.";
    return json(res, 502, { error: `Extraction failed for page ${pageNumber}: ${message.slice(0, 350)}` });
  }
}
