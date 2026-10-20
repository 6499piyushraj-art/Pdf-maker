import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const extract = await readFile(new URL("../api/extract.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../api/audit.ts", import.meta.url), "utf8");
const extract = await readFile(new URL("../api/extract.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../api/audit.ts", import.meta.url), "utf8");

test("PDF pages are sent to Gemini at a substantially higher image resolution and quality", () => {
  assert.equal((main.match(/Math\.min\(2, 1600 \/ baseViewport\.width\)/g) || []).length, 2);
  assert.equal((main.match(/canvas\.toDataURL\("image\/jpeg", 0\.82\)/g) || []).length, 2);
});

test("selectable PDF text preserves end-of-line boundaries for OCR/model context", () => {
  assert.equal((main.match(/"hasEOL" in item && item\.hasEOL/g) || []).length, 2);
  assert.ok(main.includes('replace(/[ \\t]+\\n/g, "\\n")'));
});

test("first-pass extraction instructions require a complete page scan and exact question-only content", () => {
  assert.match(extract, /inspect the ENTIRE attached page image/i);
  assert.match(extract, /A question does NOT need a question mark/i);
  assert.match(extract, /Never stop after the first question/i);
  assert.match(extract, /NEVER include answers, worked solutions/i);
});

test("empty model entries are not turned into fake placeholder questions", () => {
  assert.match(extract, /return \{ questionText, options, diagramDescription/);
  assert.match(extract, /\.filter\(q => q\.questionText\)/);
  assert.doesNotMatch(extract, /\[unclear question text\]/);
});

test("second pass independently rescans the entire page even when first pass returned no questions", () => {
  assert.match(audit, /independent SECOND-PASS visual completeness audit/i);
  assert.match(audit, /Even if FIRST-PASS QUESTIONS is empty/i);
  assert.match(audit, /question need not end in a question mark/i);
  assert.match(audit, /preserve the visible fragment/i);
});

test("pages with zero detected questions explicitly ask the user to verify them", () => {
  assert.match(main, /No questions detected — manually verify this page/);
});

test("image-only PDF requests include a full-slide view and focused crop views in both passes", () => {
  assert.match(main, /function makePageImagePayload/);
  assert.match(main, /cropHeight = Math\.max\(1, Math\.ceil\(canvas\.height \* 0\.62\)\)/);
  assert.equal((main.match(/imageDataSegments \}\s*\} = makePageImagePayload\(canvas\)/g) || []).length, 2);
  assert.match(main, /imageDataSegments, questions:/);
  assert.match(extract, /FOCUSED CROP/);
  assert.match(audit, /FOCUSED CROP/);
  assert.match(extract, /imageBytesTotal > 4400000/);
  assert.match(audit, /imageBytesTotal > 4400000/);
});
