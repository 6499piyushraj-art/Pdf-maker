import test from "node:test";
import assert from "node:assert/strict";
import { hasUnclearMarker, normalizeConfidence, shouldFlagForReview } from "../src/lib/question-quality.ts";

test("normalizes valid confidence values and clamps out-of-range values", () => {
  assert.equal(normalizeConfidence(0.93), 0.93);
  assert.equal(normalizeConfidence(-1), 0);
  assert.equal(normalizeConfidence(4), 1);
});

test("uses a cautious default for absent or invalid confidence", () => {
  assert.equal(normalizeConfidence(undefined), 0.5);
  assert.equal(normalizeConfidence(null), 0.5);
  assert.equal(normalizeConfidence("0.99"), 0.5);
  assert.equal(normalizeConfidence(true), 0.5);
  assert.equal(normalizeConfidence(Number.NaN), 0.5);
});

test("detects unclear markers in question text and option arrays", () => {
  assert.equal(hasUnclearMarker("What is [unclear]?"), true);
  assert.equal(hasUnclearMarker(["(A) 1", "(B) [UNCLEAR]"]), true);
  assert.equal(hasUnclearMarker("fully legible"), false);
  assert.equal(hasUnclearMarker(["(A) 1", "(B) 2"]), false);
});

test("flags explicit uncertainty, low confidence, unclear content, and diagrams", () => {
  assert.equal(shouldFlagForReview({ explicitReview: true, confidence: 0.99 }), true);
  assert.equal(shouldFlagForReview({ confidence: 0.79 }), true);
  assert.equal(shouldFlagForReview({ confidence: 0.99, questionText: "[unclear]" }), true);
  assert.equal(shouldFlagForReview({ confidence: 0.99, diagramDescription: "A triangle with marked angles" }), true);
  assert.equal(shouldFlagForReview({ confidence: 0.99, questionText: "Find x", options: ["(A) 1", "(B) 2"] }), false);
});
