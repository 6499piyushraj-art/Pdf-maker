import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";
import { protectedApiError } from "../src/server/auth";
import { shouldFlagForReview } from "../src/lib/question-quality";

type Input = { fileName?: unknown; pageNumber?: unknown; pageCount?: unknown; pageText?: unknown; imageData?: unknown };
type RawQuestion = { questionText?: unknown; options?: unknown; answer?: unknown; explanation?: unknown; diagramDescription?: unknown; confidence?: unknown; reviewRequired?: unknown; reviewNotes?: unknown };

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
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isInteger(pageCount) || pageCount < pageNumber) return json(res, 400, { error: "Invalid PDF page metadata." });
  if (!pageText && !imageData) return json(res, 422, { error: "This page has no readable text or rendered image." });
  if (imageData && (imageData.length > 3600000 || !/^[A-Za-z0-9+/=]+$/.test(imageData))) return json(res, 413, { error: "Rendered page image is too large. Try a lower-resolution PDF." });
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return json(res, 503, { error: "GEMINI_API_KEY is not configured on the server." });

  const prompt = `You are a careful PDF question extraction system. Extract EVERY educational question visible on this single PDF page, in exact reading order. Do not invent text. Preserve mathematical notation, variables, units, superscripts/subscripts when possible, option labels and ordering. Include diagram-dependent questions and describe the visible diagram without guessing missing labels. Use "[unclear]" for illegible parts and flag those for human review. If the page contains no question, return an empty questions array. A question may continue from another page; only extract what is actually visible here and mention incomplete context in reviewNotes.
Return JSON only in this shape:
{"questions":[{"questionText":"...","options":["(A) ..."],"answer":"only if explicitly shown; otherwise empty","explanation":"only if explicitly shown; otherwise empty","diagramDescription":"empty if none","confidence":0.0,"reviewRequired":false,"reviewNotes":[]}]}
Source filename: ${fileName}
Page: ${pageNumber} of ${pageCount}
Extracted page text (may be incomplete; image is authoritative for layout):
${pageText || "[No selectable text; inspect the page image.]"}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const parts: Array<{text:string} | {inlineData:{mimeType:string;data:string}}> = [{ text: prompt }];
    if (imageData) parts.push({ inlineData: { mimeType: "image/jpeg", data: imageData } });
    const result = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json", temperature: 0.1 }
    });
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
      return { questionText: questionText || "[unclear question text]", options, answer: cleanString(q?.answer, 3000), explanation: cleanString(q?.explanation, 5000), diagramDescription, confidence, reviewRequired: reviewRequired || !questionText, reviewNotes };
    }).filter(q => q.questionText);
    return json(res, 200, { fileName, pageNumber, questions, warning: questions.length === 40 ? "Question count was capped at 40 for one page." : undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini extraction failed.";
    return json(res, 502, { error: `Extraction failed for page ${pageNumber}: ${message.slice(0, 350)}` });
  }
}
