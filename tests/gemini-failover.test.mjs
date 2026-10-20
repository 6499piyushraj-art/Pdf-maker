import test from "node:test";
import assert from "node:assert/strict";
import { getGeminiApiKeys, hasGeminiApiKey, runWithGeminiKeyFailover } from "../src/server/gemini.ts";

test("reads seven numbered Gemini key slots in priority order and appends the legacy fallback", () => {
  const env = {
    GEMINI_API_KEY_1: " first-key ",
    GEMINI_API_KEY_2: "   ",
    GEMINI_API_KEY_3: "third-key",
    GEMINI_API_KEY_4: "first-key",
    GEMINI_API_KEY_7: "seventh-key",
    GEMINI_API_KEY: "legacy-key",
  };
  assert.deepEqual(getGeminiApiKeys(env), ["first-key", "third-key", "seventh-key", "legacy-key"]);
  assert.equal(hasGeminiApiKey(env), true);
  assert.deepEqual(getGeminiApiKeys({ GEMINI_API_KEY_2: "only-numbered" }), ["only-numbered"]);
  assert.equal(hasGeminiApiKey({ GEMINI_API_KEY_1: "  " }), false);
});

test("moves to the next configured Gemini key when an earlier request fails", async () => {
  const attempts = [];
  const result = await runWithGeminiKeyFailover(
    ["key-one", " ", "key-two", "key-three", "key-two"],
    async (key, attempt) => {
      attempts.push({ key, attempt });
      if (key !== "key-three") throw new Error("synthetic failure");
      return "success";
    },
  );
  assert.equal(result, "success");
  assert.deepEqual(attempts, [
    { key: "key-one", attempt: 1 },
    { key: "key-two", attempt: 2 },
    { key: "key-three", attempt: 3 },
  ]);
});

test("reports a generic failure after exhausting keys without printing key values", async () => {
  await assert.rejects(
    runWithGeminiKeyFailover(["secret-one", "secret-two"], async () => {
      throw new Error("request failed");
    }),
    (error) => {
      assert.match(error.message, /All 2 configured Gemini API key\(s\) failed/);
      assert.doesNotMatch(error.message, /secret-one|secret-two/);
      return true;
    },
  );
  await assert.rejects(runWithGeminiKeyFailover([], async () => "unused"), /No Gemini API key is configured/);
});
