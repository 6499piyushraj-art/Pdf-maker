import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";
import { protectedApiError } from "../src/server/auth";

type Input = { fileName?: unknown; pageNumber?: unknown; pageText?: unknown; questions?: unknown };
function json(res: VercelResponse, status: number, body: unknown) {
  return res.status(status).setHeader("Cache-Control", "no-store").setHeader("X-Content-Type-Options", "nosniff").setHeader("Content-Type", "application/json; charset=utf-8").json(body);
}
function parseBody(body: unknown): Input | null {
  if (typeof body === "string") { try { return JSON.parse(body) as Input; } catch { return null; } }
  return body && typeof body === "object" ? body as Input : null;
}
function parseModelJson(text: string): any {
  const clean = text.trim().replace(/^\uFEFF/, "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(clean); } catch {
    const first = clean.indexOf("{"); const last = clean.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(clean.slice(first, last + 1));
    throw new Error("Gemini returned invalid JSON.");
  }
}
function str(value: unknown, max = 20000): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Use POST." }); }
  if (protectedApiError(req, res)) return;
  const body = parseBody(req.body);
  if (!body || !Array.isArray(body.questions)) return json(res, 400, { error: "Expected page text and a questions array." });
  const fileName = str(body.fileName, 240) || "uploaded.pdf";
  const pageNumber = Number(body.pageNumber);
  const pageText = str(body.pageText, 22000);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return json(res, 400, { error: "Invalid page number." });
  if (body.questions.length > 40) return json(res, 413, { error: "Too many questions for one page audit." });
  const questions = body.questions.map((q: any) => ({
    questionText: str(q?.questionText, 4000),
    options: Array.isArray(q?.options) ? q.options.slice(0, 12).map((v: unknown) => str(v, 1000)) : [],
    answer: str(q?.answer, 1500)
  }));
  if (!questions.length) return json(res, 200, { issues: [], summary: "No questions were extracted from this page." });
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return json(res, 503, { error: "GEMINI_API_KEY is not configured on the server." });
  const prompt = `Perform a cautious second-pass quality audit of questions extracted from ONE PDF page. Compare against the supplied page text. Do not invent missing content and do not mark a question wrong merely because the answer is absent. Flag only concrete issues: likely omitted question visible in source, visibly truncated wording, suspiciously missing option, unclear math/units, duplicated extraction, or answer/explanation not supported by the provided text. The source text may itself be incomplete, so phrase uncertain findings as "check". Do not rewrite the source.
Return JSON only: {"issues":[{"questionIndex":0,"issue":"short actionable note"}],"summary":"short summary"}
File: ${fileName}; page: ${pageNumber}
SOURCE PAGE TEXT:
${pageText || "[No selectable text was available; audit completeness is limited.]"}
EXTRACTED QUESTIONS (index is zero-based):
${JSON.stringify(questions)}`;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json", temperature: 0.1 }
    });
    const parsed = parseModelJson(result.text || "");
    const issues = Array.isArray(parsed?.issues) ? parsed.issues.slice(0, 30).map((issue: any) => ({
      questionIndex: Number.isInteger(issue?.questionIndex) ? issue.questionIndex : -1,
      issue: str(issue?.issue, 500)
    })).filter((issue: {questionIndex:number;issue:string}) => issue.questionIndex >= 0 && issue.questionIndex < questions.length && issue.issue) : [];
    return json(res, 200, { issues, summary: str(parsed?.summary, 1000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini audit failed.";
    // Audit failure must never discard questions that extraction already recovered.
    const issues = questions.map((_, questionIndex) => ({
      questionIndex,
      issue: "Automated second-pass audit failed; manually compare this question with the original PDF."
    }));
    return json(res, 200, { issues, warning: `Audit failed for page ${pageNumber}: ${message.slice(0, 180)}` });
  }
}
