import { diagramRegionArea, normalizeDiagramRegion } from "./diagram-region";

export type QuestionCandidate = {
  questionText?: unknown;
  options?: unknown;
  diagramDescription?: unknown;
  diagramRegion?: unknown;
  confidence?: unknown;
  reviewRequired?: unknown;
  reviewNotes?: unknown;
};

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at", "as", "by", "with", "from",
  "is", "are", "be", "being", "shown", "figure", "given", "this", "that", "these", "those", "it",
  "its", "their", "then", "when", "where", "which", "what", "how", "do", "does", "has", "have",
  "will", "would", "can", "could", "should", "into", "onto", "than", "over", "under", "there",
  "each", "all"
]);

export function questionKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase()
    .replace(/\bcent(?:er|re)\s+of\s+mass\b/g, " centerofmass ")
    .replace(/\bcom\b/g, " centerofmass ")
    .replace(/\bcentre\b/g, "center")
    .replace(/([\p{L}])(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})([\p{L}])/gu, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function questionTokens(value: string): string[] {
  return [...new Set(questionKey(value.replace(/\[unclear\]/gi, " ")).split(/\s+/)
    .filter(token => token && !STOP_WORDS.has(token)))];
}

export function isPlausibleQuestionText(value: string): boolean {
  const text = value.trim().replace(/^\s*question\s*(?:no\.?\s*)?\d+\s*[:.\-]?\s*/i, "").trim();
  if (!text || /^\[?unclear\]?$/i.test(text)) return false;
  const hasTask = /\b(find|calculate|determine|compute|evaluate|solve|prove|show|obtain|select|choose|identify|state|derive|would|which|what|how|remainder|coefficient)\b/i.test(text);
  if (/^\s*(?:given|solution|working|therefore|hence|let us|we know|diagram notes?)\b/i.test(text) && !hasTask) return false;
  return questionTokens(text).length >= 2 || hasTask || /[?？]/.test(text);
}

function explicitQuestionNumber(value: string): string | null {
  const match = value.match(/\b(?:question|ques\.?|q)\s*#?\s*(\d{1,3})\b/i);
  return match?.[1] || null;
}

export function areDuplicateCandidates(a: QuestionCandidate, b: QuestionCandidate): boolean {
  const aText = String(a?.questionText || "").trim();
  const bText = String(b?.questionText || "").trim();
  const aNumber = explicitQuestionNumber(aText);
  const bNumber = explicitQuestionNumber(bText);
  if (aNumber && bNumber && aNumber !== bNumber) return false;
  if (questionKey(aText) === questionKey(bText)) return true;
  const aTokens = questionTokens(aText);
  const bTokens = questionTokens(bText);
  if (!aTokens.length || !bTokens.length) return false;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const overlap = [...aSet].filter(token => bSet.has(token)).length;
  const shorterCoverage = overlap / Math.min(aSet.size, bSet.size);
  return (overlap >= 4 && shorterCoverage >= 0.8)
    || (overlap >= 3 && shorterCoverage >= 0.92 && Math.min(aSet.size, bSet.size) <= 5);
}

function qualityScore(question: QuestionCandidate): number {
  const text = String(question?.questionText || "").trim();
  let score = new Set(questionTokens(text)).size;
  const options = Array.isArray(question?.options) ? question.options : [];
  score += Math.min(options.length, 6) * 1.5;
  if (/\b(find|calculate|determine|compute|evaluate|solve|prove|show|obtain|which|what|how)\b/i.test(text)) score += 2;
  score -= (text.match(/\[unclear\]/gi) || []).length * 4;
  if (/\brac\s*\{/i.test(text) || /(?:^|[^\\])\\frac\b/.test(text)) score -= 1;
  if (/^\s*(?:given|solution|working|therefore|hence)\b/i.test(text) && !isPlausibleQuestionText(text)) score -= 20;
  return score;
}

function optionScore(options: unknown): number {
  if (!Array.isArray(options)) return 0;
  return options.length * 100 + options.reduce<number>((sum, option) => sum + String(option ?? "").trim().length, 0);
}

export function addCandidateDeduplicated<T extends QuestionCandidate>(list: T[], candidate: T): void {
  const text = String(candidate?.questionText || "").trim();
  if (!isPlausibleQuestionText(text)) return;
  const index = list.findIndex(existing => areDuplicateCandidates(existing, candidate));
  if (index < 0) {
    list.push(candidate);
    return;
  }

  const existing = list[index];
  const existingText = String(existing?.questionText || "").trim();
  const notes = [
    ...(Array.isArray(existing?.reviewNotes) ? existing.reviewNotes.map(String) : []),
    ...(Array.isArray(candidate?.reviewNotes) ? candidate.reviewNotes.map(String) : [])
  ];
  if (qualityScore(candidate) > qualityScore(existing)) existing.questionText = candidate.questionText;
  if (optionScore(candidate.options) > optionScore(existing.options)) existing.options = candidate.options;
  if (String(candidate?.diagramDescription || "").length > String(existing?.diagramDescription || "").length) {
    existing.diagramDescription = candidate.diagramDescription;
  }
  if (diagramRegionArea(candidate.diagramRegion) < diagramRegionArea(existing.diagramRegion)) {
    existing.diagramRegion = normalizeDiagramRegion(candidate.diagramRegion);
  }
  existing.reviewRequired = Boolean(existing?.reviewRequired || candidate?.reviewRequired || questionKey(existingText) !== questionKey(text));
  existing.confidence = Math.min(
    typeof existing?.confidence === "number" ? existing.confidence : 0.5,
    typeof candidate?.confidence === "number" ? candidate.confidence : 0.5
  );
  existing.reviewNotes = [...new Set([
    ...notes,
    "Duplicate or near-duplicate candidates were merged; verify wording, options and notation against the original PDF page."
  ])].slice(0, 12);
}

export function deduplicateCandidates<T extends QuestionCandidate>(values: T[]): T[] {
  const result: T[] = [];
  for (const candidate of values) addCandidateDeduplicated(result, candidate);
  return result;
}
