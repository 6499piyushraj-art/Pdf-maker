import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const extract = await readFile(new URL("../api/extract.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../api/audit.ts", import.meta.url), "utf8");

test("PDF pages are sent to Gemini at higher resolution and quality", () => {
  assert.equal((main.match(/Math\.min\(2, 2560 \/ baseViewport\.width\)/g) || []).length, 2);
  assert.equal((main.match(/canvas\.toDataURL\("image\/jpeg", 0\.82\)/g) || []).length, 1);
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
  assert.match(extract, /\.filter\(q => q\.questionText\)/);
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
  assert.match(main, /cropHeight = Math\.max\(1, Math\.ceil\(canvas\.height \* 0\.62\)\)/);
  assert.equal((main.match(/makePageImagePayload\(canvas\)/g) || []).length, 2);
  assert.match(main, /imageDataSegments, questions:/);
  assert.match(extract, /imageBytesTotal > 4400000/);
  assert.match(audit, /imageBytesTotal > 4400000/);
});

test("pages with zero detected questions explicitly ask the user to verify them and can be re-scanned", () => {
  assert.match(main, /No questions detected — manually verify this page/);
  assert.match(main, /p.status==="failed"\|\|p.questions===0/);
  assert.match(main, /Re-scan page/);
});

test("image-only pages with few detected questions retry focused crops", () => {
  assert.ok(main.includes("const imageOnlyPage = input.pageText.trim().length < 80;"));
  assert.ok(main.includes("initialQuestions.length > 2) return initial;"));
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
  assert.match(main, /initialQuestions\.length > 2\) return initial/);
  assert.match(main, /collectUnique\(candidateSets\)\.length <= 2/);
  assert.match(main, /for \(const cropData of input\.imageDataSegments\)/);
  assert.match(extract, /pixels are the source of truth, not an empty page/i);
  assert.match(audit, /do not recover only the easiest-to-read one/i);
});

test("question deduplication preserves Hindi and other non-Latin scripts", () => {
  assert.match(main, /replace\(\/\[\^\\p\{L\}\\p\{N\}\]\+\/gu, " "\)/);
});
