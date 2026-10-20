import type { VercelRequest, VercelResponse } from "@vercel/node";
import { protectedApiError } from "../src/server/auth";
import { hasGeminiApiKey, withGeminiApiKeyFailover } from "../src/server/gemini";

type Input = { fileName?: unknown; pageNumber?: unknown; pageText?: unknown; imageData?: unknown; questions?: unknown };
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
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return json(res, 400, { error: "Invalid page number." });
  if (body.questions.length > 40) return json(res, 413, { error: "Too many questions for one page audit." });
  if (imageData && (imageData.length > 3600000 || !/^[A-Za-z0-9+/=]+$/.test(imageData))) return json(res, 413, { error: "Rendered page image is too large or invalid." });
  const questions = body.questions.map((q: any) => ({
    questionText: str(q?.questionText, 8000),
    options: Array.isArray(q?.options) ? q.options.slice(0, 12).map((v: unknown) => str(v, 1500)) : [],
    diagramDescription: str(q?.diagramDescription, 3000)
  }));
  if (!hasGeminiApiKey()) return json(res, 503, { error: "Configure a Gemini API key on the server before auditing pages." });

  const prompt = [
    "Perform a SECOND-PASS visual completeness check for one PDF page. Compare the attached page IMAGE and selectable text with extracted questions.",
    "The image is authoritative for diagrams, equations, labels and layout; text helps detect omitted wording. Look for omitted questions/subquestions, options, cut-off wording, math symbols/units misread, diagram/table/graph details omitted, duplicates, and text continued from another page.",
    "Do not solve anything and never return answers, solutions, hints, or explanations. Do not invent content. Return only clearly visible questions missing from the supplied list in missingQuestions; avoid duplicating any existing question. If unsure, provide a review note rather than guessing. Run this check even when the first-pass list is empty.",
    "Return JSON only: {\"issues\":[{\"questionIndex\":0,\"issue\":\"short concrete note\"}],\"missingQuestions\":[{\"questionText\":\"...\",\"options\":[\"...\"],\"diagramDescription\":\"\",\"confidence\":0.0,\"reviewRequired\":true,\"reviewNotes\":[]}],\"summary\":\"short status\"}",
    "File: " + fileName + "; page: " + pageNumber,
    "SELECTABLE SOURCE TEXT:",
    pageText || "[No selectable text; use the attached image.]",
    "FIRST-PASS QUESTIONS (zero-based indexes):",
    JSON.stringify(questions)
  ].join("\n");
  try {
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];
    if (imageData) parts.push({ inlineData: { mimeType: "image/jpeg", data: imageData } });
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
