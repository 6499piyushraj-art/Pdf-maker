import type { VercelRequest, VercelResponse } from "@vercel/node";
import { protectedApiError } from "../src/server/auth";
import { hasGeminiApiKey, withGeminiApiKeyFailover } from "../src/server/gemini";

type Input = { fileName?: unknown; pageNumber?: unknown; pageText?: unknown; imageData?: unknown; imageDataSegments?: unknown; questions?: unknown };
type Candidate = { questionText: string; options: string[]; diagramDescription: string; confidence: number; reviewRequired: boolean; reviewNotes: string[] };
function json(res: VercelResponse, status: number, body: unknown) {
  return res.status(status).setHeader("Cache-Control", "no-store").setHeader("X-Content-Type-Options", "nosniff").setHeader("Content-Type", "application/json; charset=utf-8").json(body);
}
function parseBody(body: unknown): Input | null {
  if (typeof body === "string") { try { return JSON.parse(body) as Input; } catch { return null; } }
  return body && typeof body === "object" ? body as Input : null;
}
function parseModelJson(text: string): any {
  const clean = text.trim().replace(/^\uFEFF/, "");
  try { return JSON.parse(clean); } catch {
    const first = clean.indexOf("{"); const last = clean.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(clean.slice(first, last + 1));
    throw new Error("Gemini returned invalid JSON.");
  }
}
function str(value: unknown, max = 12000): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Use POST." }); }
  if (protectedApiError(req, res)) return;
  const body = parseBody(req.body);
  if (!body || !Array.isArray(body.questions)) return json(res, 400, { error: "Expected page text and a questions array." });
  const fileName = str(body.fileName, 240) || "uploaded.pdf";
  const pageNumber = Number(body.pageNumber);
  const pageText = str(body.pageText, 30000);
  const imageData = typeof body.imageData === "string" ? body.imageData : "";
  const imageDataSegments = Array.isArray(body.imageDataSegments) ? body.imageDataSegments.filter((v): v is string => typeof v === "string") : [];
  const imageBytesTotal = imageData.length + imageDataSegments.reduce((sum, value) => sum + value.length, 0);
  if (imageDataSegments.length > 2 || imageData.length > 2000000 || imageDataSegments.some(value => value.length > 1500000) || imageBytesTotal > 4400000) return json(res, 413, { error: "Focused page images are too large. Try a lower-resolution PDF." });
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return json(res, 400, { error: "Invalid page number." });
  if (body.questions.length > 40) return json(res, 413, { error: "Too many questions for one page audit." });
  if ([imageData, ...imageDataSegments].some(value => value && !/^[A-Za-z0-9+/=]+$/.test(value))) return json(res, 400, { error: "Rendered page image data is invalid." });
  const questions = body.questions.map((q: any) => ({
    questionText: str(q?.questionText, 8000),
    options: Array.isArray(q?.options) ? q.options.slice(0, 12).map((v: unknown) => str(v, 1500)) : [],
    diagramDescription: str(q?.diagramDescription, 3000)
  }));
  if (!hasGeminiApiKey()) return json(res, 503, { error: "Configure a Gemini API key on the server before auditing pages." });

  const prompt = [
    "Perform an independent SECOND-PASS visual completeness audit using every supplied view of the SAME page: full slide plus focused overlapping crops. Check the crops separately for small print that may be hard to read in the full-slide view.",
    "The image is authoritative for whether a question is visibly present, diagrams, equations, labels and layout. The selectable text is a second source, not a substitute for looking at the image. Look for every omitted numbered question and subquestion, options, question statements without a question mark, small/faint/scanned text, cut-off wording, math symbols/units, diagram/table/graph-dependent questions, and text continued from another page.",
    "Independently re-read the page; do not assume the first pass is complete or correct. Even if FIRST-PASS QUESTIONS is empty, extract all clearly visible missing questions into missingQuestions. A question need not end in a question mark. Do not solve anything or return answers, solutions, hints or explanations. Never invent unreadable content; if a question is visibly there but partly unreadable, preserve the visible fragment, mark uncertainty with [unclear], and set reviewRequired=true. Avoid duplicates of existing items. If the page truly has no questions, return an empty missingQuestions array.",
    "Return JSON only: {\"issues\":[{\"questionIndex\":0,\"issue\":\"short concrete note\"}],\"missingQuestions\":[{\"questionText\":\"...\",\"options\":[\"...\"],\"diagramDescription\":\"\",\"confidence\":0.0,\"reviewRequired\":true,\"reviewNotes\":[]}],\"summary\":\"short status\"}",
    "File: " + fileName + "; page: " + pageNumber,
    "SELECTABLE SOURCE TEXT:",
    pageText || "[No selectable text; use the attached image.]",
    "FIRST-PASS QUESTIONS (zero-based indexes):",
    JSON.stringify(questions)
  ].join("\n");
  try {
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];
    if (imageData) parts.push({ text: "FULL PAGE VIEW (context):" }, { inlineData: { mimeType: "image/jpeg", data: imageData } });
    imageDataSegments.forEach((data, index) => parts.push({ text: `FOCUSED CROP ${index + 1} (same page; check for omitted questions):` }, { inlineData: { mimeType: "image/jpeg", data } }));
    const result = await withGeminiApiKeyFailover((ai) => ai.models.generateContent({
      model: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite",
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 8192 }
    }));
    const parsed = parseModelJson(result.text || "");
    const issues = Array.isArray(parsed?.issues) ? parsed.issues.slice(0, 30).map((issue: any) => ({
      questionIndex: Number.isInteger(issue?.questionIndex) ? issue.questionIndex : -1,
      issue: str(issue?.issue, 500)
    })).filter((issue: { questionIndex: number; issue: string }) => issue.questionIndex >= 0 && issue.questionIndex < questions.length && issue.issue) : [];
    const missingQuestions: Candidate[] = Array.isArray(parsed?.missingQuestions) ? parsed.missingQuestions.slice(0, 20).map((q: any) => {
      const questionText = str(q?.questionText, 8000);
      const options = Array.isArray(q?.options) ? q.options.slice(0, 12).map((v: unknown) => str(v, 1500)) : [];
      const diagramDescription = str(q?.diagramDescription, 3000);
      const confidence = typeof q?.confidence === "number" && Number.isFinite(q.confidence) ? Math.max(0, Math.min(1, q.confidence)) : 0.5;
      const reviewNotes = Array.isArray(q?.reviewNotes) ? q.reviewNotes.slice(0, 8).map((v: unknown) => str(v, 500)).filter(Boolean) : [];
      return { questionText, options, diagramDescription, confidence, reviewRequired: true, reviewNotes: [...reviewNotes, "Recovered by second-pass visual completeness check; compare with the source PDF."] };
    }).filter((q: Candidate) => q.questionText) : [];
    return json(res, 200, { issues, missingQuestions, summary: str(parsed?.summary, 1000) });
  } catch (error) {
    const issues = questions.map((_, questionIndex) => ({
      questionIndex,
      issue: "Second-pass visual audit failed; manually compare this page with the source PDF."
    }));
    const message = error instanceof Error ? error.message : "Gemini audit failed.";
    return json(res, 200, { issues, missingQuestions: [], warning: "Audit failed for page " + pageNumber + ": " + message.slice(0, 180) });
  }
}
