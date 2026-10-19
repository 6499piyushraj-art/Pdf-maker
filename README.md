# PaperPilot AI — PDF Question Maker

PaperPilot is a private workspace for extracting questions from PDF study material, checking extracted content with a second Gemini pass, editing the results, and exporting an editable Word document.

## Features

- Select up to 20 PDF files (20 MB per file); processing runs one page at a time to preserve source order.
- PDF.js extracts selectable text and renders each page locally so scanned text, equations, options and diagrams can be inspected by Gemini.
- Keeps question text, options, visible answers/explanations, diagram descriptions, confidence, source filename and page number.
- Flags low-confidence, unclear and diagram-dependent content for manual review.
- Audits each extracted page against available selectable text; audit findings appear on the related question.
- Keeps a page log when processing fails; DOCX export includes a warning and failure log so partial extraction is not presented as complete.
- Lets you edit questions, options, answers and explanations, search results, and export DOCX in the browser.
- Keeps the Gemini key server-side. A shared password and signed HttpOnly session cookie protect the API endpoints.

## Requirements

- Node.js 22 or newer.
- A Google AI Studio Gemini API key with access to the selected model.
- For local API routes, use Vercel CLI. Running npm run dev alone serves only the Vite frontend and does not run /api functions.

## Local setup

1. Copy .env.example to .env.local.
2. Set these values in .env.local:
   - GEMINI_API_KEY: your server-side Gemini key.
   - GEMINI_MODEL: optional; defaults to gemini-2.5-flash. Use a model currently enabled for your API key.
   - APP_PASSWORD: a unique password with at least 12 characters.
   - SESSION_SECRET: a separate random secret with at least 32 characters.
3. Run:

```sh
npm install --no-audit --no-fund
npm run dev:vercel
```

Open the local URL printed by Vercel. Never commit .env.local, publish your API key, or put a secret in a VITE_* variable.

## Deploy to Vercel

1. Import this repository into Vercel.
2. Add GEMINI_API_KEY, APP_PASSWORD, and SESSION_SECRET in the Vercel project's Environment Variables. GEMINI_MODEL is optional.
3. Redeploy after setting the variables.
4. Open the deployed site and sign in with APP_PASSWORD.

The password is a shared-workspace gate, not a full user-account system or rate limiter. Keep the password and deployment URL private. Gemini calls can consume quota or incur charges according to your provider plan.

## Commands and checks

- npm test — Node built-in tests for confidence/review rules and session-auth behavior.
- npm run typecheck — TypeScript validation.
- npm run build — typecheck and production Vite build.
- npm run dev:vercel — local frontend plus serverless API routes.
- npm run preview — preview static build (API routes still need a serverless runtime).

## Important limitations

- AI extraction is not guaranteed to be complete or correct. Check all equations, symbols, option labels, answers and diagrams against the original PDF.
- Audit quality is limited by the page's selectable text and model judgment; it cannot prove a page was transcribed perfectly.
- Rendered page previews and selectable text are sent to your configured API and Gemini provider. Do not upload confidential documents unless the relevant privacy terms are acceptable.
- Results are held in the current browser session and are not saved to a database.
- Very image-heavy pages can exceed the serverless request limit; use a lower-resolution PDF if a page fails.
