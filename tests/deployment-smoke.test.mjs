import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const pagesWorkflow = await readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
const tsconfig = JSON.parse(await readFile(new URL("../tsconfig.json", import.meta.url), "utf8"));
const npmrc = await readFile(new URL("../.npmrc", import.meta.url), "utf8");

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

test("Render starts a Node server that serves the frontend and API handlers", () => {
  assert.equal(pkg.scripts.start, "tsx server.ts");
  assert.ok(pkg.dependencies.express);
  assert.ok(pkg.dependencies.tsx);
  assert.ok(tsconfig.include.includes("server.ts"));
  assert.match(server, /app\.get\("\/healthz"/);
  assert.match(server, /app\.all\("\/api\/auth"/);
  assert.match(server, /app\.all\("\/api\/extract"/);
  assert.match(server, /app\.all\("\/api\/audit"/);
  assert.match(server, /app\.use\(express\.static\(distPath/);
  assert.match(server, /0\.0\.0\.0/);
  assert.match(npmrc, /include=dev/);
});

test("GitHub Pages workflow builds Vite output rather than deploying source TypeScript", () => {
  assert.match(pagesWorkflow, /workflow_dispatch/);
  assert.match(pagesWorkflow, /GITHUB_PAGES:\s*"true"/);
  assert.match(pagesWorkflow, /upload-pages-artifact@v3/);
  assert.match(pagesWorkflow, /deploy-pages@v4/);
});

test("docs clearly explain hosting requirements and Render deployment", () => {
  assert.match(readme, /not a plain static HTML page/);
  assert.match(readme, /GitHub Pages is static hosting/);
  assert.match(readme, /6499piyushraj-art\/Pdf-maker/);
  assert.match(readme, /Render/);
  assert.match(readme, /npm start/);
  assert.match(readme, /GEMINI_API_KEY/);
});
