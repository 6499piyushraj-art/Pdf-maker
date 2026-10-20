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

test("zero-question result triggers one focused-only fallback call", () => {
  assert.match(main, /async function extractPageWithFocusedFallback/);
  assert.match(main, /result\.questions\.length > 0/);
  assert.match(main, /focusedOnly: true/);
  assert.match(main, /Recovered by focused-only fallback/);
});

test("focused-only fallback labels crops honestly and accepts crop-only image payloads", () => {
  assert.match(extract, /focused-only fallback: all attached images are overlapping crops/i);
  assert.match(extract, /focusedOnly \? "FOCUSED CROP 1/);
  assert.match(extract, /!imageData && imageDataSegments.length === 0/);
});

test("zero-result recovery independently retries each focused crop and merges candidates", () => {
  assert.match(main, /Pass 2: read overlapping upper\/lower crops/);
  assert.match(main, /Passes 3–4: ask about each crop separately/);
  assert.match(main, /for \(const \[index, cropData\] of input\.imageDataSegments\.entries\(\)\)/);
  assert.match(main, /focusedFallbackPasses/);
  assert.match(extract, /Question \[JEE Mains-2023\]/);
  assert.match(extract, /ignore handwritten working, ticks, circles and answers/);
});
