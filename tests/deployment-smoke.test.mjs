import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const pagesWorkflow = await readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");

test("index has visible startup diagnostics instead of an empty app root", () => {
  assert.match(index, /id="app"[\s\S]*startup-fallback/);
  assert.match(index, /The app bundle has not loaded/);
  assert.match(index, /GitHub Pages cannot run them/);
  assert.match(index, /type="module" src="\/src\/main\.ts"/);
});

test("Vercel and GitHub Pages use different, explicit Vite base paths", () => {
  assert.match(viteConfig, /process\.env\.GITHUB_PAGES === "true"/);
  assert.match(viteConfig, /base:\s*isGitHubPages\s*\?\s*"\/Pdf-maker\/"\s*:\s*"\/"/);
  assert.equal(vercel.framework, "vite");
  assert.equal(vercel.buildCommand, "npm run build");
  assert.equal(vercel.outputDirectory, "dist");
  assert.ok(vercel.functions && Object.keys(vercel.functions).some((key) => key.startsWith("api/")));
});

test("GitHub Pages workflow builds Vite output rather than deploying source TypeScript", () => {
  assert.match(pagesWorkflow, /workflow_dispatch/);
  assert.match(pagesWorkflow, /GITHUB_PAGES:\s*"true"/);
  assert.match(pagesWorkflow, /upload-pages-artifact@v3/);
  assert.match(pagesWorkflow, /deploy-pages@v4/);
});

test("docs distinguish static GitHub Pages from a full Vercel deployment", () => {
  assert.match(readme, /can show a blank page/);
  assert.match(readme, /Pages is static hosting/);
  assert.match(readme, /6499piyushraj-art\/Pdf-maker/);
  assert.match(readme, /vercel.com\/new/);
  assert.match(readme, /Vercel deployment URL.*not the GitHub Pages URL/);
});
