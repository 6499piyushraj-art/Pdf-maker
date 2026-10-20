# PaperPilot AI — PDF Question Maker

PaperPilot is a private workspace for extracting questions from PDF study material, auditing extracted results, editing questions, and exporting an editable Word document. The frontend is Vite + TypeScript. PDF files are rendered in the browser; Gemini calls run in Vercel serverless functions so the API key stays server-side.

## Why a deployment can appear blank

This is **not a plain static HTML page**. The repository's index.html references /src/main.ts, which imports TypeScript and packages such as PDF.js and DOCX. Those imports must be compiled by Vite. A host that serves the Git repository root directly does not build those files, so the browser can show a blank page or a startup diagnostic instead of the app.

The repository now has a Vite build workflow for GitHub Pages, but Pages is static hosting: it cannot run /api/auth, /api/extract, or /api/audit. The UI can load there, but sign-in and Gemini extraction will show a backend-unavailable notice. **Deploy to Vercel for the full working app.**

## Deploy the complete app to Vercel (recommended)

1. Open https://vercel.com/new and import 6499piyushraj-art/Pdf-maker.
2. Keep the Root Directory at the repository root. Use Framework Preset Vite, Build Command npm run build, and Output Directory dist. These settings are declared in vercel.json.
3. Add these Environment Variables under Vercel Project Settings → Environment Variables for Production (add Preview too only if you will use preview deployments):
   - GEMINI_API_KEY: a Google AI Studio Gemini API key. Keep this server-side.
   - APP_PASSWORD: a unique workspace password of at least 12 characters.
   - SESSION_SECRET: a separate random value of at least 32 characters.
   - GEMINI_MODEL: optional; defaults to gemini-2.5-flash in .env.example. Choose a model currently available to your API key.
4. Redeploy after adding the variables.
5. Open the **Vercel deployment URL**, not the GitHub Pages URL. Sign in using APP_PASSWORD.
6. Verify https://YOUR-VERCEL-DOMAIN/api/auth returns JSON with configured: true. If it returns a 404 HTML page, the wrong host or an incomplete deployment is being used.

Never put the Gemini key in a VITE_* variable, commit it to Git, or share it in chat. The password gate is a shared-workspace gate, not a complete user-account system or rate limiter; keep the deployment URL private.

## Publish the frontend on GitHub Pages (UI preview only)

Use this only when you want the interface to load from GitHub Pages. It does **not** activate the Gemini backend.

1. Open this repository's Settings → Pages.
2. Under Build and deployment → Source, select **GitHub Actions** (not “Deploy from a branch”). Vite requires a build step for deployment.
3. Open the Actions tab and select **Deploy static frontend to GitHub Pages**.
4. Select Run workflow on the main branch.
5. After the run succeeds, open the Pages URL. The app UI should load from the built assets; because Pages does not run the /api functions, it will tell you to deploy to Vercel for sign-in/extraction.

The Pages build uses the /Pdf-maker/ asset prefix. Vercel builds use the domain-root / prefix. The two builds are tested independently by CI.

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

1. Copy .env.example to .env.local.
2. Add GEMINI_API_KEY, APP_PASSWORD (12+ characters), SESSION_SECRET (32+ characters), and optionally GEMINI_MODEL to .env.local.
3. Run:

```sh
npm install --no-audit --no-fund
npm run dev:vercel
```

Running only npm run dev starts Vite but does not run the /api endpoints; sign-in and extraction need the Vercel-compatible runtime.

## Tests and commands

- npm test — unit/regression tests for deployment setup, question-quality flags and session authentication.
- npm run typecheck — TypeScript validation.
- npm run build — typecheck and Vite production build to dist/.
- npm run test:dist — checks that the built HTML references real JavaScript and CSS assets.
- npm run dev:vercel — local frontend plus serverless API runtime.
- npm run preview — static frontend preview only; API functions still need a serverless runtime.

## Limitations and privacy

- AI extraction is not guaranteed to be complete or correct. Verify equations, values, option labels, answers and diagrams against the source PDF.
- The audit cannot prove that every page was transcribed perfectly.
- Rendered page images and selectable text are sent to your configured API and Gemini provider. Do not upload confidential material unless you are comfortable with those providers' privacy terms.
- Results stay in the current browser session; there is no database or cross-device history.
- Large or complex pages can exceed serverless request limits. Split the PDF or reduce page image resolution if a page fails.
