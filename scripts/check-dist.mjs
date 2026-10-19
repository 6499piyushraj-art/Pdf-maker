import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

const distDir = resolve(process.cwd(), "dist");
const htmlPath = resolve(distDir, "index.html");
const html = await readFile(htmlPath, "utf8");

assert.doesNotMatch(
  html,
  /(?:src|href)=["']\/src\/main\.ts["']/,
  "Production HTML still points at the TypeScript source instead of the Vite bundle."
);
assert.match(html, /<script[^>]+type=["']module["'][^>]+src=/, "The built page has no module entry point.");
assert.match(html, /The app bundle has not loaded/, "The nonblank startup diagnostic was lost from the production HTML.");

const assetRefs = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map((match) => match[1]);
assert.ok(assetRefs.some((ref) => /\.js(?:\?|$)/.test(ref)), "No JavaScript bundle is referenced by dist/index.html.");
assert.ok(assetRefs.some((ref) => /\.css(?:\?|$)/.test(ref)), "No CSS bundle is referenced by dist/index.html.");

for (const ref of assetRefs) {
  const pathname = new URL(ref, "https://paperpilot-smoke.test/").pathname;
  const assetPath = resolve(distDir, pathname.replace(/^\/+/, ""));
  assert.ok(assetPath.startsWith(distDir + sep), `Unexpected asset path escaped dist: ${ref}`);
  const info = await stat(assetPath).catch(() => null);
  assert.ok(info?.isFile(), `Referenced production asset is missing: ${ref}`);
  assert.ok(info.size > 0, `Referenced production asset is empty: ${ref}`);
}

console.log(`Production output smoke test passed: ${assetRefs.length} JS/CSS reference(s) exist in dist/.`);
