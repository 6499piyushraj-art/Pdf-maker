# PaperPilot AI — PDF Question Maker

PaperPilot is a password-protected workspace for extracting questions from PDF study material, auditing extracted results, editing questions, and exporting an editable Word document. The frontend is Vite + TypeScript. PDF files are rendered in the browser; Gemini requests run on the server so the API key stays server-side.

## Deploy the full app to Render

1. Open the [Render dashboard](https://dashboard.render.com/) and create a **Web Service** from `https://github.com/6499piyushraj-art/Pdf-maker`, branch `main`.
2. Runtime: **Node**. Build command: `npm install --no-audit --no-fund && npm run build`. Start command: `npm start`. Render supplies `PORT`; the server binds to `0.0.0.0`.
3. Add these Environment Variables in Render's Environment tab. Do not put their values in GitHub or share them in chat:
   - `GEMINI_API_KEY_1` through `GEMINI_API_KEY_7`: up to seven server-only Gemini API keys. Fill the slots in priority order; empty slots are skipped.
   - `GEMINI_API_KEY`: optional legacy fallback, attempted after the numbered slots.
   - `APP_PASSWORD`: a unique password of at least 12 characters.
   - `SESSION_SECRET`: a separate random secret of at least 32 characters.
   - `GEMINI_MODEL`: optional; defaults to `gemini-2.5-flash`.
   Save changes and redeploy. The app reports the workspace as configured when the login secrets and at least one Gemini key are present.
4. Wait for the deploy to become **Live**, then open the Render URL.
5. Verify `/healthz` returns `{"ok":true}`, and `/api/auth` returns JSON with `configured: true` and `authenticated: false` before sign-in. Use `APP_PASSWORD` to sign in.

The Render Node server serves the compiled Vite `dist/` files and routes `/api/auth`, `/api/extract`, and `/api/audit` to the existing handlers. Gemini extraction and auditing try numbered keys in order and automatically advance to the next configured key when a Gemini request fails. Duplicate keys and blank slots are skipped; the legacy `GEMINI_API_KEY` is kept as a compatibility fallback. This does not guarantee extra quota: Google may enforce limits at project or model level, even when several keys are configured. The `/healthz` route is safe for service health checks.

## Why a deployment can appear blank

This is not a plain static HTML page. The repository's `index.html` references `/src/main.ts`, which imports TypeScript and packages such as PDF.js and DOCX. Those imports must be compiled by Vite. A host that serves the repository root directly does not build those files, so the browser can show a blank page or a startup diagnostic instead of the app.

GitHub Pages is static hosting and cannot run the `/api` functions. The repository has a Vite Pages workflow for a UI preview only; use Render for sign-in and Gemini extraction. Vercel remains supported as an alternative full-stack host.

## Features

- Select up to 20 PDF files, 20 MB per file. Pages are processed sequentially to preserve source order.
- PDF.js extracts selectable text and renders each page locally so scans, equations, options and diagrams can be inspected by Gemini.
- Keeps question text, options, visible answers/explanations, diagram descriptions, confidence, source filename and page number.
- Flags low-confidence or unclear content for manual review.
- Audits extracted results, preserves successful pages when one page fails, and records failures for retry.
- Supports search and editing extracted questions/options/answers/explanations before exporting DOCX.
- Embeds selected source-page previews and warns when extraction has failed on any pages.
- Keeps the Gemini key on the server; the shared workspace uses a signed HttpOnly session cookie and same-origin checks.

## Local setup

Requirements: Node.js 22 or newer.

1. Copy `.env.example` to `.env.local`.
2. Fill any of `GEMINI_API_KEY_1` through `GEMINI_API_KEY_7` (and optionally legacy `GEMINI_API_KEY`), plus `APP_PASSWORD` (12+ characters), `SESSION_SECRET` (32+ characters), and optionally `GEMINI_MODEL`.
3. Run:

```sh
npm install --no-audit --no-fund
npm run build
npm start
```

For Vite-only UI work use `npm run dev`; it does not provide the API routes. `npm run dev:vercel` runs the Vercel development adapter.

## Tests and commands

- `npm test` — unit/regression tests for deployment setup, Render server routes, and question-quality/auth behavior.
- `npm run typecheck` — TypeScript validation.
- `npm run build` — typecheck and Vite production build to `dist/`.
- `npm run test:dist` — checks that the built HTML references real JavaScript and CSS assets.
- `npm start` — production Node server for Render.
- `npm run dev:vercel` — Vercel-compatible local API runtime.

## Limitations and privacy

- AI extraction is not guaranteed to be complete or correct. Verify equations, values, option labels, answers and diagrams against the source PDF.
- The audit cannot prove that every page was transcribed perfectly.
- Rendered page images and selectable text are sent to your configured server and Gemini provider. Do not upload confidential material unless you are comfortable with those providers' privacy terms.
- Results stay in the current browser session; there is no database or cross-device history.
- Large or complex pages can exceed serverless request limits. Split the PDF or reduce page image resolution if a page fails.
