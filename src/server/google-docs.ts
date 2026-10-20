import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type GoogleTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
};
export type QuestionForGoogleDocs = {
  questionText?: unknown;
  options?: unknown;
  diagramDescription?: unknown;
};
const DEFAULT_REDIRECT_URI = "https://paperpilot-pdf-maker.onrender.com/api/google?action=callback";

export function googleOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()
    && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32);
}
export function googleRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
  return env.GOOGLE_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
}
function encryptionKey(secret: string): Buffer {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return createHash("sha256").update(secret).digest();
}
export function sealGoogleTokens(tokens: GoogleTokenPayload, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function unsealGoogleTokens(value: string, secret: string): GoogleTokenPayload | null {
  try {
    const parts = value.split(".");
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0]!, "base64url");
    const tag = Buffer.from(parts[1]!, "base64url");
    const encrypted = Buffer.from(parts[2]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || !encrypted.length) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAuthTag(tag);
    const decoded = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(decoded) as GoogleTokenPayload;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch { return null; }
}
export function constantTimeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\r/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Build a formatted Google Docs batch while ignoring any answer/solution properties. */
export function buildQuestionDocument(questionsInput: unknown, documentTitle = "PaperPilot Question Bank"): {
  title: string;
  text: string;
  requests: Array<Record<string, unknown>>;
  questionCount: number;
} {
  if (!Array.isArray(questionsInput)) throw new Error("Questions must be an array.");
  if (questionsInput.length > 1500) throw new Error("This document is limited to 1,500 questions. Split the PDF batch and try again.");
  const title = clean(documentTitle, 180) || "PaperPilot Question Bank";
  const safeQuestions = (questionsInput as QuestionForGoogleDocs[]).map(q => ({
    questionText: clean(q?.questionText, 8000),
    options: Array.isArray(q?.options) ? q.options.slice(0, 12).map(option => clean(option, 1500)).filter(Boolean) : [],
    diagramDescription: clean(q?.diagramDescription, 2500)
  })).filter(q => q.questionText);
  if (!safeQuestions.length) throw new Error("No question text was supplied for export.");

  let text = title + "\n\n";
  const requests: Array<Record<string, unknown>> = [
    { insertText: { location: { index: 1 }, text: "" } },
    { updateParagraphStyle: { range: { startIndex: 1, endIndex: 1 + title.length }, paragraphStyle: { namedStyleType: "TITLE", alignment: "CENTER", spaceBelow: { magnitude: 16, unit: "PT" } }, fields: "namedStyleType,alignment,spaceBelow" } }
  ];
  let cursor = 1 + text.length;
  safeQuestions.forEach((question, index) => {
    const heading = "Q" + (index + 1) + ". " + question.questionText + "\n";
    const headingStart = cursor;
    text += heading;
    cursor += heading.length;
    requests.push({ updateParagraphStyle: { range: { startIndex: headingStart, endIndex: cursor }, paragraphStyle: { namedStyleType: "HEADING_2", keepWithNext: true, spaceAbove: { magnitude: 12, unit: "PT" }, spaceBelow: { magnitude: 5, unit: "PT" } }, fields: "namedStyleType,keepWithNext,spaceAbove,spaceBelow" } });
    question.options.forEach(option => {
      const line = "   " + option + "\n";
      const start = cursor;
      text += line;
      cursor += line.length;
      requests.push({ updateParagraphStyle: { range: { startIndex: start, endIndex: cursor }, paragraphStyle: { indentStart: { magnitude: 18, unit: "PT" }, spaceBelow: { magnitude: 3, unit: "PT" } }, fields: "indentStart,spaceBelow" } });
    });
    if (question.diagramDescription) {
      const line = "Figure/diagram: " + question.diagramDescription + "\n";
      const start = cursor;
      text += line;
      cursor += line.length;
      requests.push({ updateTextStyle: { range: { startIndex: start, endIndex: cursor - 1 }, textStyle: { italic: true, foregroundColor: { color: { rgbColor: { red: 0.22, green: 0.38, blue: 0.36 } } } }, fields: "italic,foregroundColor" } });
    }
    text += "\n";
    cursor += 1;
  });
  requests[0] = { insertText: { location: { index: 1 }, text } };
  return { title, text, requests, questionCount: safeQuestions.length };
}
