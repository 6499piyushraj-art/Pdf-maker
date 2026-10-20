# PaperPilot AI — PDF Question Maker

PaperPilot is a private workspace for extracting questions from PDF study material, auditing extracted results, editing questions, and exporting an editable Word document. The UI is Vite + TypeScript; PDF pages are rendered in the browser, while Gemini requests run in Vercel serverless functions.

## Why GitHub Pages can show a blank page

This repository is **not a plain static HTML website**. Its index.html points at /src/main.ts, which is TypeScript that imports packages such as PDF.js and DOCX. Those imports need Vite's production build; a GitHub Pages "Deploy from a branch" setup that serves the repository root directly does not compile them, so the browser may show an empty page. The index.html now includes a visible startup diagnostic instead of an empty root.

GitHub Pages is also static-only and cannot run this app's /api/auth, /api/extract, or /api/audit endpoints. A built frontend alone is not enough for extraction. **Use Vercel for the full working app**, because Vercel can serve the built dist/ assets and run the api/ serverless functions.

## What it does

- Accepts up to 20 PDFs, up to 20 MB each, processed in source order.
- Reads selectable text and renders each page locally so Gemini can inspect scans, equations, symbols, options, tables, and diagrams.
- Keeps question text, options, visible answers/explanations, diagram descriptions, confidence, source filename, and page number.
- Flags low-confidence or unclear content and preserves successful results if individual pages fail. Failed pages can be retried.
- Audits extracted questions, maps findings back to each question, supports search and manual edits, shows original source pages, and exports DOCX.
- Keeps the Gemini key on the server; the shared workspace uses a signed HttpOnly session cookie and same-origin checks.

## Deploy the complete app to Vercel

1. Open https://vercel.com/new and import 6499piyushraj-art/Pdf-maker.
2. Keep the Root Directory at the repository root. Use Framework Preset Vite, Build Command npm run build, and Output Directory dist. These are declared in vercel.json.
3. Add these environment variables under Vercel Project Settings → Environment Variables for Production (and Preview if needed):
   - GEMINI_API_KEY: a server-side Google AI Studio API key.
   - APP_PASSWORD: a unique workspace password of at least 12 characters.
   - SESSION_SECRET: a separate random value of at least 32 characters.
   - GEMINI_MODEL: optional; defaults to gemini-2.5-flash. Use a model available to your API key.
4. Redeploy after setting the variables. Open the Vercel deployment URL, not the GitHub Pages URL, and sign in using APP_PASSWORD.
5. Check https://YOUR-VERCEL-DOMAIN/api/auth: it should return JSON, not an HTML 404. Its configured field should be true after the required environment variables are set.

Never put the Gemini key in a VITE_* variable, commit it to Git, or share it in chat. The password gate is a shared-workspace gate, not a complete account system or rate limiter; keep the deployment URL private.

## Local setup

Requirements: Node.js 22 or newer.

1. Copy .env.example to .env.local.
2. Fill in GEMINI_API_KEY, APP_PASSWORD, SESSION_SECRET, and optionally GEMINI_MODEL.
3. Run:

```sh
npm install --no-audit --no-fund
npm run dev:vercel
```

Running only npm run dev starts Vite but not the /api endpoints; sign-in and extraction will not work through that server.

## Tests and commands

- npm test — regression tests for extraction-quality flags, session auth, and deployment configuration.
- npm run typecheck — TypeScript validation.
- npm run build — typecheck and production build to dist/.
- npm run dev:vercel — local UI plus Vercel-compatible serverless API runtime.
- npm run preview — static frontend preview (API functions still require a serverless runtime).

## Limitations and privacy

- The app does not solve the questions. Always verify equations, values, option labels, answers, and diagrams against the source PDF.
- AI extraction and the audit are not guaranteed to be complete or correct.
- Rendered page images and selectable text are sent to your configured API and the Gemini provider. Do not upload confidential material unless the providers' privacy terms are acceptable.
- Results stay in the current browser session; there is no database or cross-device history.
- Vercel Functions have request-size limits. A complex PDF page may need a lower-resolution or split PDF.
- DOCX embeds a limited number of source-page previews and marks recorded extraction failures clearly.
