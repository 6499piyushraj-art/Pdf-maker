import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

const distDir = resolve(process.cwd(), "dist");
const htmlPath = resolve(distDir, "index.html");
const html = await readFile(htmlPath, "utf8");
const pagesBuild = process.env.GITHUB_PAGES === "true";
const expectedBase = pagesBuild ? "/Pdf-maker/" : "/";

assert.doesNotMatch(
  html,
  /(?:src|href)=["']\/src\/main\.ts["']/,
  "Production HTML still points at the TypeScript source instead of the Vite bundle."
);
assert.match(html, /<script[^>]+type=["']module["'][^>]+src=/, "The built page has no module entry point.");
assert.match(html, /The app bundle has not loaded/, "The startup diagnostic was lost from the built HTML.");

const assetRefs = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map((match) => match[1]);
assert.ok(assetRefs.some((ref) => /\.js(?:\?|$)/.test(ref)), "No JavaScript bundle is referenced by dist/index.html.");
assert.ok(assetRefs.some((ref) => /\.css(?:\?|$)/.test(ref)), "No CSS bundle is referenced by dist/index.html.");

for (const ref of assetRefs) {
  const pathname = new URL(ref, "https://paperpilot-smoke.test/").pathname;
  assert.ok(pathname.startsWith(expectedBase), `Asset URL does not use expected base ${expectedBase}: ${ref}`);
  const relativeAssetPath = pathname.slice(expectedBase.length);
  const assetPath = resolve(distDir, relativeAssetPath);
  assert.ok(assetPath.startsWith(distDir + sep), `Unexpected asset path escaped dist: ${ref}`);
  const info = await stat(assetPath).catch(() => null);
  assert.ok(info?.isFile(), `Referenced production asset is missing: ${ref}`);
  assert.ok(info.size > 0, `Referenced production asset is empty: ${ref}`);
}

console.log(`Production output smoke test passed for base ${expectedBase}: ${assetRefs.length} referenced JS/CSS asset(s) exist in dist/.`);
