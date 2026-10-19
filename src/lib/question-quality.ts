export const REVIEW_CONFIDENCE_THRESHOLD = 0.8;

export type ReviewSignals = {
  explicitReview?: unknown;
  confidence?: unknown;
  questionText?: unknown;
  options?: unknown;
  diagramDescription?: unknown;
};

export function normalizeConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.5;
}

export function hasUnclearMarker(value: unknown): boolean {
  if (typeof value === "string") return /\[unclear\]/i.test(value);
  return Array.isArray(value) && value.some((item) => typeof item === "string" && /\[unclear\]/i.test(item));
}

export function shouldFlagForReview(signals: ReviewSignals): boolean {
  const confidence = normalizeConfidence(signals.confidence);
  return signals.explicitReview === true
    || confidence < REVIEW_CONFIDENCE_THRESHOLD
    || hasUnclearMarker(signals.questionText)
    || hasUnclearMarker(signals.options)
    || (typeof signals.diagramDescription === "string" && signals.diagramDescription.trim().length > 0);
}
