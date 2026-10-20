import test from "node:test";
import assert from "node:assert/strict";
import { buildQuestionDocument, sealGoogleTokens, unsealGoogleTokens, constantTimeStringEqual } from "../src/server/google-docs.ts";

const secret = "test-session-secret-with-at-least-32-characters";

test("Google OAuth tokens are encrypted and decrypt only with the same secret", () => {
  const tokens = { access_token: "access-secret", refresh_token: "refresh-secret", expiry_date: 123456789 };
  const sealed = sealGoogleTokens(tokens, secret);
  assert.doesNotMatch(sealed, /access-secret|refresh-secret/);
  assert.deepEqual(unsealGoogleTokens(sealed, secret), tokens);
  assert.equal(unsealGoogleTokens(sealed, "different-session-secret-with-at-least-32-chars"), null);
  assert.equal(unsealGoogleTokens("broken.cookie.value", secret), null);
});

test("OAuth state comparison rejects altered values", () => {
  assert.equal(constantTimeStringEqual("same-state", "same-state"), true);
  assert.equal(constantTimeStringEqual("same-state", "other-state"), false);
  assert.equal(constantTimeStringEqual("", ""), false);
});

test("Google document contains question text, options and figure notes but not answers", () => {
  const doc = buildQuestionDocument([{
    questionText: "Find x in the triangle.",
    options: ["(A) 1", "(B) 2"],
    diagramDescription: "A triangle with a right-angle mark.",
    answer: "SECRET_ANSWER_42",
    explanation: "SECRET_EXPLANATION_MULTIPLY"
  }]);
  assert.equal(doc.questionCount, 1);
  assert.match(doc.text, /Q1\. Find x in the triangle\./);
  assert.match(doc.text, /\(A\) 1/);
  assert.match(doc.text, /Figure\/diagram: A triangle with a right-angle mark\./);
  assert.doesNotMatch(doc.text, /SECRET_ANSWER_42|SECRET_EXPLANATION_MULTIPLY/);
  assert.ok(doc.requests.some(request => "updateParagraphStyle" in request));
});

test("Google document validates empty input and export caps", () => {
  assert.throws(() => buildQuestionDocument([]), /No question text/);
  assert.throws(() => buildQuestionDocument(Array.from({ length: 1501 }, () => ({ questionText: "Question?" }))), /1,500/);
});
