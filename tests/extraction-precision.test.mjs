import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const extract = await readFile(new URL("../api/extract.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../api/audit.ts", import.meta.url), "utf8");
const dedupe = await import("../src/lib/question-dedupe.ts");
const dedupeSource = await readFile(new URL("../src/lib/question-dedupe.ts", import.meta.url), "utf8");

test("PDF pages are sent to Gemini at higher resolution and quality", () => {
  assert.equal((main.match(/Math\.min\(2, 2300 \/ baseViewport\.width\)/g) || []).length, 2);
  assert.match(main, /for \(const cropQuality of \[0\.82, 0\.76, 0\.70, 0\.64, 0\.58\]\)/);
  assert.match(main, /total <= 3_650_000/);
});

test("selectable PDF text preserves end-of-line boundaries", () => {
  assert.equal((main.match(/"hasEOL" in item && item\.hasEOL/g) || []).length, 2);
  assert.ok(main.includes('replace(/[ \\t]+\\n/g, "\\n")'));
});

test("question extractor scans all provided views and retains exact question-only text", () => {
  assert.match(extract, /full slide for context and focused overlapping crops/i);
  assert.match(extract, /A question does NOT need a question mark/i);
  assert.match(extract, /never stop after the first question/i);
  assert.match(extract, /NEVER include answers, worked solutions/i);
  assert.match(extract, /FOCUSED CROP/);
});

test("empty model entries do not become fabricated placeholder questions", () => {
  assert.match(extract, /return \{ questionText, options, diagramDescription/);
  assert.match(extract, /\.filter\(q => \{/);
  assert.match(extract, /Boolean\(q\.questionText\)/);
  assert.match(extract, /unclear/);
  assert.doesNotMatch(extract, /\[unclear question text\]/);
});

test("second pass checks crops and can recover missing questions when the first pass is empty", () => {
  assert.match(audit, /full slide plus focused overlapping crops/i);
  assert.match(audit, /Even if FIRST-PASS QUESTIONS is empty/i);
  assert.match(audit, /question need not end in a question mark/i);
  assert.match(audit, /FOCUSED CROP/);
});

test("image-only PDF requests include full and focused overlapping views on initial run and retry", () => {
  assert.match(main, /function makePageImagePayload/);
  assert.match(main, /const landscape = canvas\.width >= canvas\.height/);
  assert.match(main, /cropFraction = 0\.66/);
  assert.match(main, /startX = index === 0 \? 0 : canvas\.width - crop\.width/);
  assert.match(main, /startY = index === 0 \? 0 : canvas\.height - crop\.height/);
  assert.equal((main.match(/makePageImagePayload\(canvas\)/g) || []).length, 2);
  assert.match(main, /imageDataSegments, questions:/);
  assert.match(extract, /imageBytesTotal > 3650000/);
  assert.match(audit, /imageBytesTotal > 3650000/);
});

test("pages with zero detected questions explicitly ask the user to verify them and can be re-scanned", () => {
  assert.match(main, /No questions detected — manually verify this page/);
  assert.match(main, /p.status==="failed"\|\|p.questions===0/);
  assert.match(main, /Re-scan page/);
});

test("image-only pages with few detected questions retry focused crops", () => {
  assert.ok(main.includes("const imageOnlyPage = input.pageText.trim().length < 80;"));
  assert.ok(main.includes("initialQuestions.length > 5) return initial;"));
  assert.ok(main.includes("collectUnique(candidateSets).length <= 2"));
  assert.ok(main.includes("focusedOnly: true"));
  assert.ok(main.includes("focusedFallbackUsed: true"));
});

test("focused-only fallback labels crops honestly and accepts crop-only image payloads", () => {
  assert.match(extract, /focused-only fallback: each attached image is a crop/i);
  assert.match(extract, /focusedOnly \? "FOCUSED CROP 1/);
  assert.match(extract, /!imageData && imageDataSegments.length === 0/);
});

test("partial image-only results merge questions from individual crops", () => {
  assert.ok(main.includes("collectUnique(candidateSets)"));
  assert.ok(main.includes("for (const cropData of input.imageDataSegments)"));
  assert.ok(main.includes("focusedFallbackPasses"));
  assert.ok(extract.includes("Question [JEE Mains-2023]"));
  assert.ok(extract.includes("ignoring handwritten working, ticks, circles and answers"));
});

test("question bank PDF export works without Google Docs and starts each question on its own page", () => {
  assert.match(main, /id="export-pdf"/);
  assert.match(main, /function downloadQuestionPdf\(\)/);
  assert.match(main, /printWindow\.print\(\)/);
  assert.match(main, /break-after:page/);
  assert.match(main, /choose Save as PDF in the print dialog/i);
  assert.match(main, /q\.questionText/);
  assert.match(main, /q\.options\.map/);
  assert.match(main, /q\.diagramDescription/);
  assert.match(main, /answers and worked solutions are not included/);
});

test("image-only pages with partial results receive focused retries instead of stopping at one question", () => {
  assert.match(main, /const imageOnlyPage = input\.pageText\.trim\(\)\.length < 80/);
  assert.match(main, /initialQuestions\.length > 5\) return initial/);
  assert.match(main, /collectUnique\(candidateSets\)\.length <= 2/);
  assert.match(main, /for \(const cropData of input\.imageDataSegments\)/);
  assert.match(extract, /pixels are the source of truth, not an empty page/i);
  assert.match(audit, /do not recover only the easiest-to-read one/i);
});

test("question deduplication preserves Hindi and other non-Latin scripts", () => {
  assert.equal(dedupe.questionKey("केंद्र द्रव्यमान"), dedupe.questionKey("केंद्र-द्रव्यमान"));
  assert.match(dedupeSource, /\\p\\{L\\}/);
});

test("question slides with selectable text still get focused completeness retries", () => {
  assert.ok(main.includes("const shouldRetryFocused = imageOnlyPage || initialQuestions.length <= 1 || (initialQuestions.length <= 2 && hasQuestionCue);"));
  assert.ok(main.includes("collectUnique(candidateSets).length <= 2 && (imageOnlyPage || hasQuestionCue || initialQuestions.length === 0)"));
  assert.match(main, /Focused completeness re-scan ran; manually compare this page with the source PDF for omissions/);
});

test("Gemini 3.8 Flash uses high thinking and avoids unsupported sampling settings", () => {
  for (const source of [extract, audit]) {
    assert.ok(source.includes('thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }'));
    assert.ok(source.includes("maxOutputTokens: 16384"));
    assert.doesNotMatch(source, /temperature\s*:/);
  }
});


test("semantic deduplication merges paraphrased model candidates and rejects weak placeholders", () => {
  assert.equal(typeof dedupe.areDuplicateCandidates, "function");
  assert.equal(typeof dedupe.deduplicateCandidates, "function");
  assert.equal(typeof dedupe.isPlausibleQuestionText, "function");
  assert.match(main, /deduplicateCandidates\(Array\.isArray\(result\.questions\)/);
  assert.match(dedupeSource, /Duplicate or near-duplicate candidates were merged/);
  assert.match(extract, /NO-INVENTION RULE/);
  assert.match(extract, /DUPLICATE RULE/);
  assert.match(audit, /SEMANTIC DEDUPLICATION RULE/);
  assert.match(extract, /MATH OUTPUT FORMAT/);
  assert.match(audit, /MATH OUTPUT FORMAT/);
});

test("the original source page is preserved for review and included in question-bank PDF exports", () => {
  assert.match(main, /function makeSourcePreview/);
  assert.match(main, /sourcePreview\?: string/);
  assert.match(main, /function renderSourceReference/);
  assert.match(main, /renderSourceReference\(q\.fileName, q\.pageNumber\)/);
  assert.match(main, /source-reference/);
  assert.match(main, /View original PDF page/);
  const exportSection = main.slice(main.indexOf("function downloadQuestionPdf()"), main.indexOf("function renderGoogleDocsAction()"));
  assert.doesNotMatch(exportSection, /source-reference-print/);
  assert.match(main, /Extracted question only · answers and worked solutions are not included/);
});

test("given-only pseudo-questions and exact unclear placeholders are excluded instead of exported as questions", () => {
  assert.match(extract, /const givenOnly/);
  assert.match(extract, /!givenOnly/);
  assert.equal(dedupe.isPlausibleQuestionText("Given: x=4y^2, X=a, uniform density sigma."), false);
  assert.match(audit, /unclear/);
});


test("dedupe implementation merges paraphrased questions while retaining richer options", () => {
  const first = {
    questionText: "Find the centre of mass of a uniform lamina bounded by x=4y^2 and x=a",
    options: [],
    diagramDescription: "",
    confidence: 0.94,
    reviewRequired: false,
    reviewNotes: []
  };
  const second = {
    questionText: "Determine the centre of mass of the uniform lamina bounded by x = 4 y^2 and x = a",
    options: ["(A) x = a/2", "(B) x = 2a/3"],
    diagramDescription: "Parabolic lamina with vertical boundary x=a.",
    confidence: 0.8,
    reviewRequired: false,
    reviewNotes: []
  };
  assert.equal(dedupe.areDuplicateCandidates(first, second), true);
  const result = dedupe.deduplicateCandidates([first, second]);
  assert.equal(result.length, 1);
  assert.equal(result[0].options.length, 2);
  assert.match(result[0].diagramDescription, /Parabolic lamina/);
  assert.equal(result[0].reviewRequired, true);
  assert.ok(result[0].reviewNotes.some(note => /merged/i.test(note)));
});

test("different explicit question numbers are not merged just because stems are similar", () => {
  assert.equal(dedupe.areDuplicateCandidates(
    { questionText: "Question 1: Find the value of x + 2" },
    { questionText: "Question 2: Find the value of x + 2" }
  ), false);
});

test("given-only notes and exact unclear placeholders are rejected but short actual questions survive", () => {
  assert.equal(dedupe.isPlausibleQuestionText("Given: x = 4y^2, X = a, uniform density sigma."), false);
  assert.equal(dedupe.isPlausibleQuestionText("[unclear]"), false);
  assert.equal(dedupe.isPlausibleQuestionText("Why?"), true);
  assert.equal(dedupe.isPlausibleQuestionText("Calculate x when x+2=5"), true);
});
