import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ThinkingLevel } from "@google/genai";
import { protectedApiError } from "../src/server/auth";
import { hasGeminiApiKey, withGeminiApiKeyFailover } from "../src/server/gemini";
import { normalizeDiagramRegion, type DiagramRegion } from "../src/lib/diagram-region";

type Input = { fileName?: unknown; pageNumber?: unknown; pageText?: unknown; imageData?: unknown; imageDataSegments?: unknown; questions?: unknown };
type Candidate = { questionText: string; options: string[]; diagramDescription: string; diagramRegion?: DiagramRegion; confidence: number; reviewRequired: boolean; reviewNotes: string[] };
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
  if (imageDataSegments.length > 2 || imageData.length > 1750000 || imageDataSegments.some(value => value.length > 1250000) || imageBytesTotal > 3650000) return json(res, 413, { error: "Focused page images are too large. Try a lower-resolution PDF." });
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return json(res, 400, { error: "Invalid page number." });
  if (body.questions.length > 40) return json(res, 413, { error: "Too many questions for one page audit." });
  if ([imageData, ...imageDataSegments].some(value => value && !/^[A-Za-z0-9+/=]+$/.test(value))) return json(res, 400, { error: "Rendered page image data is invalid." });
  const questions = body.questions.map((q: any) => ({
    questionText: str(q?.questionText, 8000),
    options: Array.isArray(q?.options) ? q.options.slice(0, 12).map((v: unknown) => str(v, 1500)) : [],
    diagramDescription: str(q?.diagramDescription, 3000),
    diagramRegion: normalizeDiagramRegion(q?.diagramRegion)
  }));
  if (!hasGeminiApiKey()) return json(res, 503, { error: "Configure a Gemini API key on the server before auditing pages." });

  const prompt = [
    "Perform an independent SECOND-PASS visual completeness audit using every supplied view of the SAME page: full slide plus focused overlapping crops. Check the crops separately for small print that may be hard to read in the full-slide view.",
    "The image is authoritative. When selectable text is missing or short, treat the page as image-only, not blank. Inspect printed question banners, every visible stem, each option, and lower/side regions. A banner alone is not a question stem: recover only actual omitted problem statements that are visibly present in the image.",
    "The image is authoritative for whether a question is visibly present, diagrams, equations, labels and layout. The selectable text is a second source, not a substitute for looking at the image. Look for every omitted numbered question and subquestion, options, question statements without a question mark, small/faint/scanned text, cut-off wording, math symbols/units, diagram/table/graph-dependent questions, and text continued from another page.",
    "Independently re-read the page; do not assume the first pass is complete or correct. Even if FIRST-PASS QUESTIONS is empty, recover all actually visible omitted question statements into missingQuestions. A question need not end in a question mark. Do not return answers, solutions, hints or explanations. If a visible question is partly unreadable, preserve its legible fragment, mark uncertainty with [unclear], and require review. Do not reconstruct a missing prompt from handwritten working or intermediate equations. If the page has no visible problem statement, return an empty missingQuestions array even if it contains givens or a derivation.",
    "NO-INVENTION RULE: do not infer a task from solution steps. If the source page only shows givens, equations, a derivation, or teacher working without the actual requested task, do not create a question from it. Do not generate a generic paraphrase such as Find the centre of mass unless those words or an equivalent requested task are visible in the source.",
    "SEMANTIC DEDUPLICATION RULE: missingQuestions must include only genuinely distinct questions not already represented by FIRST-PASS QUESTIONS. Different OCR/model phrasings of the same stem, options, values and diagram are the same question; never return shortened paraphrases as additional questions. Crops are views of one page, not separate question sources.",
    "MATH FIDELITY: do not silently correct equations. Keep visible notation as faithfully as possible, mark uncertain spans [unclear], and request manual review for questionable transcription.",
    "MATH OUTPUT FORMAT: do not add dollar-sign or backslash math delimiters, and do not emit LaTeX macros that would print literally. Use faithful readable plain-text notation such as x^2, sqrt(x), or a/b without changing signs, values or powers; mark genuinely uncertain pieces [unclear] and request review.",
    "DIAGRAM REGION RULE: for a missing question that depends on a figure, graph, circuit, geometry drawing or table, return diagramRegion as {x,y,width,height} with integer coordinates from 0 to 1000 relative to the FULL PAGE VIEW only. Make the box tight around the figure and its labels; exclude handwritten working, derivations, calculations and answers. Return null if a safe tight box cannot be identified, never the whole slide.",
    "Return JSON only: {\"issues\":[{\"questionIndex\":0,\"issue\":\"short concrete note\"}],\"missingQuestions\":[{\"questionText\":\"...\",\"options\":[\"...\"],\"diagramDescription\":\"\",\"diagramRegion\":null,\"confidence\":0.0,\"reviewRequired\":true,\"reviewNotes\":[]}],\"summary\":\"short status\"}",
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
      model: process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }, maxOutputTokens: 16384 }
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
      const diagramRegion = normalizeDiagramRegion(q?.diagramRegion);
      const confidence = typeof q?.confidence === "number" && Number.isFinite(q.confidence) ? Math.max(0, Math.min(1, q.confidence)) : 0.5;
      const reviewNotes = Array.isArray(q?.reviewNotes) ? q.reviewNotes.slice(0, 8).map((v: unknown) => str(v, 500)).filter(Boolean) : [];
      return { questionText, options, diagramDescription, diagramRegion, confidence, reviewRequired: true, reviewNotes: [...reviewNotes, "Recovered by second-pass visual completeness check; compare with the source PDF."] };
    }).filter((q: Candidate) => q.questionText && !/^\s*\[?unclear\]?\s*$/i.test(q.questionText)) : [];
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
