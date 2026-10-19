import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("index has visible startup diagnostics instead of an empty app root", () => {
  assert.match(index, /id="app"[\s\S]*startup-fallback/);
  assert.match(index, /The app bundle has not loaded/);
  assert.match(index, /GitHub Pages cannot run them/);
  assert.match(index, /type="module" src="\/src\/main\.ts"/);
});

test("deployment config builds and serves the Vite dist output on Vercel", () => {
  assert.match(viteConfig, /base:\s*"\/"/);
  assert.equal(vercel.framework, "vite");
  assert.equal(vercel.buildCommand, "npm run build");
  assert.equal(vercel.outputDirectory, "dist");
  assert.ok(vercel.functions && Object.keys(vercel.functions).some((key) => key.startsWith("api/")));
});

test("docs distinguish static GitHub Pages from a full Vercel deployment", () => {
  assert.match(readme, /GitHub Pages (?:shows|can show) a blank page/);
  assert.match(readme, /GitHub Pages (?:is static hosting|is also static-only)/);
  assert.match(readme, /6499piyushraj-art\/Pdf-maker/);
  assert.match(readme, /vercel.com\/new/);
  assert.match(readme, /Open the Vercel deployment URL, not the GitHub Pages URL/);
});
