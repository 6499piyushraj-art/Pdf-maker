import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./style.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type Question = {
  id: string; fileName: string; pageNumber: number; questionText: string;
  options: string[]; diagramDescription: string; confidence: number;
  reviewRequired: boolean; reviewNotes: string[];
};
type PageRecord = { fileName: string; pageNumber: number; text: string; status: "done" | "failed"; error?: string; questions: number };
type AppState = { authenticated: boolean; configured: boolean; apiUnavailable: boolean; busy: boolean; files: File[]; questions: Question[]; pages: PageRecord[]; message: string; search: string; activeTab: "questions" | "pages"; googleDocsConfigured: boolean; googleDocsConnected: boolean };
const state: AppState = { authenticated: false, configured: false, apiUnavailable: false, busy: false, files: [], questions: [], pages: [], message: "", search: "", activeTab: "questions", googleDocsConfigured: false, googleDocsConnected: false };
const app = document.querySelector<HTMLDivElement>("#app")!;
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function makePageImagePayload(canvas: HTMLCanvasElement): { imageData: string; imageDataSegments: string[] } {
  const imageData = canvas.toDataURL("image/jpeg", 0.82).split(",")[1] || "";
  // Image-only lecture PDFs often place small printed questions beside large handwritten work.
  // Keep the full slide for context and add overlapping top/bottom crops for legibility.
  const cropHeight = Math.max(1, Math.ceil(canvas.height * 0.62));
  const cropStarts = [0, Math.max(0, canvas.height - cropHeight)];
  const imageDataSegments = cropStarts.map((startY) => {
    const crop = document.createElement("canvas");
    crop.width = canvas.width;
    crop.height = Math.min(cropHeight, canvas.height - startY);
    const context = crop.getContext("2d");
    if (!context) throw new Error("Could not prepare focused PDF image crops.");
    context.drawImage(canvas, 0, startY, canvas.width, crop.height, 0, 0, crop.width, crop.height);
    const encoded = crop.toDataURL("image/jpeg", 0.84).split(",")[1] || "";
    crop.width = 0;
    crop.height = 0;
    return encoded;
  });
  return { imageData, imageDataSegments };
}

const jsonPost = async (url: string, body: unknown) => {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
};


async function extractPageWithFocusedFallback(input: {
  fileName: string;
  pageNumber: number;
  pageCount: number;
  pageText: string;
  imageData: string;
  imageDataSegments: string[];
}): Promise<any> {
  const initial = await jsonPost("/api/extract", { ...input });
  if (!Array.isArray(initial?.questions) || initial.questions.length > 0 || input.imageDataSegments.length < 2) return initial;

  // Pass 2: read overlapping upper/lower crops without the full-page view.
  const candidateSets: any[][] = [];
  try {
    const focused = await jsonPost("/api/extract", {
      fileName: input.fileName,
      pageNumber: input.pageNumber,
      pageCount: input.pageCount,
      pageText: input.pageText,
      imageData: input.imageDataSegments[0],
      imageDataSegments: [input.imageDataSegments[1]],
      focusedOnly: true
    });
    if (Array.isArray(focused?.questions) && focused.questions.length) candidateSets.push(focused.questions);
  } catch {
    // Continue to the independent crop attempts below.
  }

  // Passes 3–4: ask about each crop separately. Some vision calls miss small text
  // when the complete slide and handwritten work are shown together.
  if (!candidateSets.some(set => set.length)) {
    for (const [index, cropData] of input.imageDataSegments.entries()) {
      try {
        const cropResult = await jsonPost("/api/extract", {
          fileName: input.fileName,
          pageNumber: input.pageNumber,
          pageCount: input.pageCount,
          pageText: input.pageText,
          imageData: cropData,
          imageDataSegments: [],
          focusedOnly: true
        });
        if (Array.isArray(cropResult?.questions) && cropResult.questions.length) candidateSets.push(cropResult.questions);
      } catch {
        // A failed crop doesn't prevent the other crop from being inspected.
      }
    }
  }

  if (!candidateSets.length) return { ...initial, focusedFallbackAttempted: true };

  const seen = new Set<string>();
  const questions: any[] = [];
  for (const set of candidateSets) {
    for (const question of set) {
      const key = String(question?.questionText || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      questions.push(question);
    }
  }
  return {
    ...initial,
    questions,
    focusedFallbackUsed: true,
    focusedFallbackPasses: candidateSets.length
  };
}

async function checkAuth() {
  state.apiUnavailable = false;
  try {
    const response = await fetch("/api/auth", { credentials: "same-origin", cache: "no-store" });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("application/json")) {
      throw new Error("This host did not return the PaperPilot API response.");
    }
    const data = await response.json();
    if (typeof data !== "object" || data === null || typeof data.configured !== "boolean") {
      throw new Error("The PaperPilot API response is not valid.");
    }
    state.configured = Boolean(data.configured);
    state.authenticated = Boolean(data.authenticated);
    if (state.authenticated) await refreshGoogleDocsStatus();
    else { state.googleDocsConfigured = false; state.googleDocsConnected = false; }
    const googleStatus = new URLSearchParams(window.location.search).get("google");
    if (googleStatus === "connected") state.message = "Google Docs connected successfully.";
    else if (googleStatus === "error") state.message = "Google sign-in did not finish. Check the OAuth setup and try again.";
    if (googleStatus) window.history.replaceState({}, document.title, window.location.pathname);
  } catch {
    state.configured = false;
    state.authenticated = false;
    state.apiUnavailable = true;
    state.message = "This host cannot run PaperPilot's serverless API.";
  }
  render();
}

function render() {
  if (!state.authenticated) {
    app.innerHTML = `<main class="login-shell"><div class="brand-mark">P</div><p class="eyebrow">PAPERPILOT AI</p><h1>Your PDFs.<br><span>Your question bank.</span></h1><p class="muted">Extract only questions and options from PDFs. A second visual check looks for omissions; answers and solutions are excluded.</p>
      ${state.apiUnavailable ? '<div class="notice danger"><strong>Backend unavailable on this deployment.</strong><br>GitHub Pages and plain static hosting cannot run the /api/auth, /api/extract and /api/audit endpoints. Deploy the full project on Render to sign in and extract PDFs. <a href="https://dashboard.render.com/" target="_blank" rel="noreferrer">Open Render dashboard ↗</a></div>' : !state.configured ? '<div class="notice danger">Setup required: configure at least one Gemini key slot (GEMINI_API_KEY_1 through _7), APP_PASSWORD and SESSION_SECRET in your hosting environment.</div>' : ""}
      <form id="login-form" class="login-form"><label for="password">Workspace password</label><input id="password" name="password" type="password" autocomplete="current-password" required minlength="1" placeholder="Enter your password" ${state.apiUnavailable ? "disabled" : ""}><button class="primary" type="submit" ${state.apiUnavailable ? "disabled" : ""}>Unlock workspace <span>→</span></button></form>
      <p class="message">${escapeHtml(state.message)}</p><p class="tiny">Your API key is never sent to the browser.</p></main>`;
    return;
  }
  const visible = state.questions.filter(q => [q.questionText, q.fileName, ...q.options].join(" ").toLowerCase().includes(state.search.toLowerCase()));
  app.innerHTML = `<header class="topbar"><a class="brand" href="#"><span class="brand-mark small">P</span><span>PaperPilot <small>AI QUESTION MAKER</small></span></a><div class="top-actions"><span class="secure"><i></i> Private workspace</span><button class="quiet" id="logout">Sign out</button></div></header>
  <main class="workspace"><section class="hero"><div><p class="eyebrow">STUDY MATERIAL, ORGANIZED</p><h1>Turn PDFs into a<br><span>question bank.</span></h1><p class="muted">Each page gets text + visual extraction and a second visual completeness check. Unclear equations and diagram-dependent questions are flagged for review.</p></div><div class="hero-art"><div class="paper paper-back"></div><div class="paper paper-front"><b>Q.</b><span></span><span></span><span class="short"></span><em>✓</em></div><div class="spark">✦</div></div></section>
  <section class="stats"><div><small>QUESTIONS</small><strong>${state.questions.length}</strong></div><div><small>PAGES CHECKED</small><strong>${state.pages.filter(p=>p.status==="done").length}</strong></div><div><small>NEEDS REVIEW</small><strong class="review-count">${state.questions.filter(q=>q.reviewRequired).length}</strong></div><div><small>FAILED PAGES</small><strong>${state.pages.filter(p=>p.status==="failed").length}</strong></div></section>
  <section class="panel upload-panel"><div class="section-heading"><div><p class="eyebrow">STEP 01</p><h2>Bring in your PDFs</h2><p class="muted">Up to 20 files. Pages are processed sequentially to preserve order.</p></div><span class="step-icon">↥</span></div>
  <label class="dropzone" for="pdf-input"><input id="pdf-input" type="file" accept="application/pdf,.pdf" multiple ${state.busy?"disabled":""}><span class="upload-icon">↑</span><strong>Choose PDF files</strong><span>or use your device's file picker</span><small>PDF only · maximum 20 files · 20 MB per file</small></label>
  ${state.files.length ? `<div class="file-list">${state.files.map((f,i)=>`<div class="file-row"><span class="file-icon">PDF</span><span class="file-name">${escapeHtml(f.name)}<small>${(f.size/1048576).toFixed(1)} MB</small></span><button class="icon-button remove-file" data-index="${i}" aria-label="Remove file" ${state.busy?"disabled":""}>×</button></div>`).join("")}</div><button id="process" class="primary process-button" ${state.busy?"disabled":""}>${state.busy?'<span class="spinner"></span> Processing pages…':'Extract questions <span>→</span>'}</button>` : ""}
  <p class="message">${escapeHtml(state.message)}</p></section>
  <section class="panel results-panel"><div class="section-heading results-heading"><div><p class="eyebrow">STEP 02</p><h2>Your question bank</h2><p class="muted">Only question text, options and necessary figure notes are included. Download PDF works without Google sign-in, with each question on a separate page.</p></div><div class="google-actions">${renderPdfExportAction()}${renderGoogleDocsAction()}</div></div>
  <div class="results-tools"><div class="tabs"><button data-tab="questions" class="${state.activeTab==="questions"?"selected":""}">Questions <span>${state.questions.length}</span></button><button data-tab="pages" class="${state.activeTab==="pages"?"selected":""}">Page log <span>${state.pages.length}</span></button></div>${state.activeTab==="questions"?'<input id="search" class="search" placeholder="Search questions…" value="'+escapeHtml(state.search)+'">':""}</div>
  ${state.activeTab==="questions" ? (visible.length ? visible.map((q,i)=>`<article class="question-card"><div class="question-top"><span class="question-number">Q${state.questions.indexOf(q)+1}</span><span class="source">${escapeHtml(q.fileName)} · page ${q.pageNumber}</span>${q.reviewRequired?'<span class="review-badge">Review</span>':'<span class="ok-badge">Checked</span>'}</div>
    <label class="field-label">Question</label><textarea data-edit="questionText" data-id="${q.id}" rows="2">${escapeHtml(q.questionText)}</textarea>
    ${q.options.length?'<label class="field-label">Options</label>'+q.options.map((o,j)=>`<input class="option-edit" data-option="${j}" data-id="${q.id}" value="${escapeHtml(o)}">`).join(""):""}
    ${q.diagramDescription?'<p class="diagram-note">Diagram: '+escapeHtml(q.diagramDescription)+'</p>':""}
    ${q.reviewNotes.length?'<p class="review-note">'+escapeHtml(q.reviewNotes.join(" · "))+'</p>':""}
    <div class="card-footer"><span>Confidence ${Math.round(q.confidence*100)}%</span><label class="review-toggle"><input type="checkbox" data-review="${q.id}" ${q.reviewRequired?"checked":""}> Needs manual review</label></div></article>`).join("") : '<div class="empty-state"><div>✧</div><h3>No questions yet</h3><p>Choose your PDFs above, then start extraction.</p></div>') : (state.pages.length ? state.pages.map(p=>`<div class="page-row"><span class="status-dot ${p.status}"></span><div><strong>${escapeHtml(p.fileName)} · page ${p.pageNumber}</strong><small>${p.status==="done"?(p.questions===0?"No questions detected — manually verify this page; faint/scanned questions can be missed":p.questions+" question(s) extracted"):escapeHtml(p.error||"Processing failed")}</small></div>${(p.status==="failed"||p.questions===0)?'<button class="retry secondary" data-file="'+escapeHtml(p.fileName)+'" data-page="'+p.pageNumber+'">'+(p.status==="failed"?"Retry page":"Re-scan page")+'</button>':""}</div>`).join(""):'<div class="empty-state"><h3>No pages processed yet</h3><p>Your page-by-page progress will appear here.</p></div>')}
  </section><footer><span>PaperPilot AI</span><span>AI extraction can make mistakes. Always verify important answers.</span></footer></main>`;
}

app.addEventListener("submit", async (event) => {
  const form = event.target as HTMLFormElement;
  if (form.id !== "login-form") return;
  event.preventDefault();
  state.message = "";
  const password = String(new FormData(form).get("password") || "");
  try {
    await jsonPost("/api/auth", { password });
    state.authenticated = true;
    await refreshGoogleDocsStatus();
  } catch (error) { state.message = error instanceof Error ? error.message : "Sign-in failed."; }
  render();
});

app.addEventListener("change", async (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (target.id === "pdf-input" && target instanceof HTMLInputElement) {
    const picked = Array.from(target.files || []);
    if (picked.length > 20) { state.message = "Choose no more than 20 PDFs."; render(); return; }
    const invalid = picked.find(f => f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf"));
    if (invalid) { state.message = `${invalid.name} is not a PDF.`; render(); return; }
    const tooLarge = picked.find(f => f.size > 20 * 1024 * 1024);
    if (tooLarge) { state.message = `${tooLarge.name} is over the 20 MB per-file limit.`; render(); return; }
    state.files = picked; state.message = ""; render(); return;
  }
  const id = target.dataset.id;
  if (id && target.dataset.edit) {
    const q = state.questions.find(item => item.id === id);
    if (q) (q as any)[target.dataset.edit] = target.value;
  }
  if (id && target.dataset.option !== undefined) {
    const q = state.questions.find(item => item.id === id);
    if (q) q.options[Number(target.dataset.option)] = target.value;
  }
  if (target instanceof HTMLInputElement && target.dataset.review) {
    const q = state.questions.find(item => item.id === target.dataset.review);
    if (q) q.reviewRequired = target.checked;
    render();
  }
});

app.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === "search") {
    const pos = target.selectionStart;
    state.search = target.value;
    render();
    const replacement = document.querySelector<HTMLInputElement>("#search");
    replacement?.focus(); replacement?.setSelectionRange(pos, pos);
  }
});

app.addEventListener("click", async (event) => {
  const target = (event.target as HTMLElement).closest("button") as HTMLButtonElement | null;
  if (!target) return;
  if (target.id === "logout") {
    try { await jsonPost("/api/auth", { action: "logout" }); } catch {}
    state.authenticated = false; state.message = ""; render(); return;
  }
  if (target.classList.contains("remove-file")) {
    state.files.splice(Number(target.dataset.index), 1); render(); return;
  }
  if (target.dataset.tab) { state.activeTab = target.dataset.tab as AppState["activeTab"]; render(); return; }
  if (target.id === "process") { await processFiles(); return; }
  if (target.id === "export-pdf") { downloadQuestionPdf(); return; }
  if (target.id === "export-google") { await exportGoogleDoc(); return; }
  if (target.id === "disconnect-google") { await disconnectGoogleDocs(); return; }
  if (target.classList.contains("retry")) {
    await retryPage(target.dataset.file || "", Number(target.dataset.page));
    return;
  }
});

async function processFiles() {
  if (!state.files.length || state.busy) return;
  state.busy = true; state.message = "Preparing PDF pages…"; render();
  const selected = [...state.files];
  try {
    for (const file of selected) {
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        state.message = `Reading ${file.name} · page ${pageNumber} of ${pdf.numPages}`; render();
        let pageText = "";
        try {
          const page = await pdf.getPage(pageNumber);
          const textContent = await page.getTextContent();
          pageText = textContent.items.map((item) => "str" in item ? item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ") : "").join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
          const baseViewport = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2, 2560 / baseViewport.width) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not render the PDF page.");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const { imageData, imageDataSegments } = makePageImagePayload(canvas);
          const result = await extractPageWithFocusedFallback({ fileName: file.name, pageNumber, pageCount: pdf.numPages, pageText, imageData, imageDataSegments });
          const newQuestions: Question[] = (result.questions || []).map((q: any, i: number) => ({
            id: crypto.randomUUID(), fileName: file.name, pageNumber,
            questionText: String(q.questionText || ""), options: Array.isArray(q.options) ? q.options.map(String) : [],
diagramDescription: String(q.diagramDescription || ""),
            confidence: Number.isFinite(q.confidence) ? Math.max(0, Math.min(1, q.confidence)) : 0.5,
            reviewRequired: Boolean(q.reviewRequired) || Boolean(result.focusedFallbackUsed), reviewNotes: [...(Array.isArray(q.reviewNotes) ? q.reviewNotes.map(String) : []), ...(result.focusedFallbackUsed ? ["Recovered by focused-only fallback; verify against the source PDF."] : [])]
          }));
          let audit: any = { issues: [] };
          try {
            audit = await jsonPost("/api/audit", { fileName: file.name, pageNumber, pageText, imageData, imageDataSegments, questions: newQuestions.map(q => ({ questionText: q.questionText, options: q.options, diagramDescription: q.diagramDescription })) });
            for (const issue of audit.issues || []) {
              const q = newQuestions[Number(issue.questionIndex)];
              if (q) { q.reviewRequired = true; q.reviewNotes.push(String(issue.issue || "Second-pass audit flagged this question.")); }
            }
          } catch {
            for (const q of newQuestions) { q.reviewRequired = true; q.reviewNotes.push("Second-pass audit failed; compare this page with the original PDF."); }
          }
          mergeRecoveredQuestions(newQuestions, audit?.missingQuestions || [], file.name, pageNumber);
          state.questions.push(...newQuestions);
          state.pages.push({ fileName: file.name, pageNumber, text: pageText, status: "done", questions: newQuestions.length });
        } catch (error) {
          state.pages.push({ fileName: file.name, pageNumber, text: pageText, status: "failed", error: error instanceof Error ? error.message : "Unknown page error", questions: 0 });
        }
        render();
      }
    }
    state.activeTab = "questions";
    const failedCount = state.pages.filter(p=>p.status==="failed").length;
    state.message = `Completed ${state.pages.length} page(s): ${state.questions.length} question(s) extracted and checked. ${failedCount ? failedCount + " page(s) failed—retry them before creating the Google Doc." : "All pages completed."}`;
  } catch (error) {
    state.message = error instanceof Error ? error.message : "PDF processing failed.";
  } finally { state.busy = false; render(); }
}

async function retryPage(fileName: string, pageNumber: number) {
  const file = state.files.find(item => item.name === fileName);
  if (!file || state.busy || !Number.isInteger(pageNumber) || pageNumber < 1) {
    state.message = "Keep the original PDF selected to retry a failed page.";
    render();
    return;
  }
  state.busy = true;
  state.message = `Retrying ${file.name} · page ${pageNumber}…`;
  render();
  try {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => "str" in item ? item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ") : "").join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 2560 / baseViewport.width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not render the PDF page.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const { imageData, imageDataSegments } = makePageImagePayload(canvas);
    const result = await extractPageWithFocusedFallback({ fileName: file.name, pageNumber, pageCount: pdf.numPages, pageText, imageData, imageDataSegments });
    const questions: Question[] = (result.questions || []).map((q: any) => ({
      id: crypto.randomUUID(), fileName: file.name, pageNumber,
      questionText: String(q.questionText || ""), options: Array.isArray(q.options) ? q.options.map(String) : [],
diagramDescription: String(q.diagramDescription || ""),
      confidence: Number.isFinite(q.confidence) ? Math.max(0, Math.min(1, q.confidence)) : 0.5,
      reviewRequired: Boolean(q.reviewRequired) || Boolean(result.focusedFallbackUsed), reviewNotes: [...(Array.isArray(q.reviewNotes) ? q.reviewNotes.map(String) : []), ...(result.focusedFallbackUsed ? ["Recovered by focused-only fallback; verify against the source PDF."] : [])]
    }));
    try {
      const audit = await jsonPost("/api/audit", { fileName: file.name, pageNumber, pageText, imageData, imageDataSegments, questions: questions.map(q => ({ questionText: q.questionText, options: q.options, diagramDescription: q.diagramDescription })) });
      for (const issue of audit.issues || []) {
        const q = questions[Number(issue.questionIndex)];
        if (q) { q.reviewRequired = true; q.reviewNotes.push(String(issue.issue || "Second-pass audit flagged this question.")); }
      }
      mergeRecoveredQuestions(questions, audit?.missingQuestions || [], file.name, pageNumber);
    } catch {
      for (const q of questions) { q.reviewRequired = true; q.reviewNotes.push("Second-pass audit failed; compare this page with the original PDF."); }
    }
    state.questions = state.questions.filter(q => !(q.fileName === file.name && q.pageNumber === pageNumber));
    state.questions.push(...questions);
    const pageIndex = state.pages.findIndex(p => p.fileName === file.name && p.pageNumber === pageNumber);
    const record: PageRecord = { fileName: file.name, pageNumber, text: pageText, status: "done", questions: questions.length };
    if (pageIndex >= 0) state.pages[pageIndex] = record; else state.pages.push(record);
    state.message = `Retry complete: ${questions.length} question(s) recovered from page ${pageNumber}.`;
    state.activeTab = "questions";
  } catch (error) {
    state.message = error instanceof Error ? error.message : "Page retry failed.";
  } finally {
    state.busy = false;
    render();
  }
}

async function refreshGoogleDocsStatus() {
  try {
    const response = await fetch("/api/google?action=status", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    state.googleDocsConfigured = Boolean(data.configured);
    state.googleDocsConnected = Boolean(data.connected);
  } catch {
    state.googleDocsConfigured = false;
    state.googleDocsConnected = false;
  }
}
function renderGoogleDocsAction(): string {
  if (!state.googleDocsConfigured) return '<span class="tiny google-setup-note">Google Docs setup needed: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Render.</span>';
  if (!state.googleDocsConnected) return '<a class="secondary google-connect" href="/api/google?action=login">Sign in with Google ↗</a>';
  const blocked = !state.questions.length || state.busy || state.pages.some(page => page.status === "failed");
  const label = state.pages.some(page => page.status === "failed") ? "Retry failed pages first" : "Create Google Doc ↗";
  return '<span class="google-connected"><i></i> Google connected</span><button id="export-google" class="secondary" ' + (blocked ? "disabled" : "") + '>' + label + '</button><button id="disconnect-google" class="quiet" ' + (state.busy ? "disabled" : "") + '>Disconnect</button>';
}
function renderPdfExportAction(): string {
  const hasFailedPages = state.pages.some(page => page.status === "failed");
  const blocked = !state.questions.length || state.busy || hasFailedPages;
  const label = hasFailedPages ? "Retry failed pages first" : "Download PDF ↓";
  return '<button id="export-pdf" class="secondary" ' + (blocked ? "disabled" : "") + ' title="One question per page; choose Save as PDF in the print dialog.">' + label + '</button>';
}

function questionKey(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function mergeRecoveredQuestions(questions: Question[], rawMissing: unknown, fileName: string, pageNumber: number): void {
  if (!Array.isArray(rawMissing)) return;
  for (const candidate of rawMissing.slice(0, 20) as any[]) {
    const questionText = String(candidate?.questionText || "").trim();
    const key = questionKey(questionText);
    if (!key || questions.some(existing => questionKey(existing.questionText) === key)) continue;
    const reviewNotes = Array.isArray(candidate?.reviewNotes) ? candidate.reviewNotes.map(String) : [];
    questions.push({
      id: crypto.randomUUID(), fileName, pageNumber, questionText,
      options: Array.isArray(candidate?.options) ? candidate.options.map(String).slice(0, 12) : [],
      diagramDescription: String(candidate?.diagramDescription || ""),
      confidence: Number.isFinite(candidate?.confidence) ? Math.max(0, Math.min(1, candidate.confidence)) : 0.5,
      reviewRequired: true,
      reviewNotes: [...reviewNotes, "Recovered by the second-pass completeness check. Verify against the original PDF."]
    });
  }
}
function downloadQuestionPdf() {
  if (!state.questions.length || state.busy) return;
  if (state.pages.some(page => page.status === "failed")) {
    state.message = "Retry every failed page before exporting, so the PDF is not knowingly incomplete.";
    render();
    return;
  }

  // Open synchronously from the user's click so mobile browsers do not block the print view.
  const printWindow = window.open("about:blank", "_blank");
  if (!printWindow) {
    state.message = "The PDF print window was blocked. Allow pop-ups for this site and try again.";
    render();
    return;
  }

  const pages = state.questions.map((q, index) => {
    const questionText = escapeHtml(q.questionText).replace(/\r?\n/g, "<br>");
    const options = q.options.map(option =>
      '<div class="option">' + escapeHtml(option).replace(/\r?\n/g, "<br>") + "</div>"
    ).join("");
    const diagram = q.diagramDescription
      ? '<section class="diagram"><h2>Diagram / figure notes</h2><p>' + escapeHtml(q.diagramDescription).replace(/\r?\n/g, "<br>") + "</p></section>"
      : "";
    const review = q.reviewRequired
      ? '<p class="review-note">Please verify this question against the original PDF.</p>'
      : "";
    return '<section class="question-page"><header><span>PaperPilot AI · Question Bank</span><span>Question ' + (index + 1) + " of " + state.questions.length + '</span></header><h1>Question ' + (index + 1) + '</h1><p class="source">Source: ' + escapeHtml(q.fileName) + " · original PDF page " + q.pageNumber + '</p><div class="stem">' + questionText + '</div>' + (options ? '<section class="options"><h2>Options</h2>' + options + '</section>' : "") + diagram + review + '<footer>Extracted question only · answers and worked solutions are not included</footer></section>';
  }).join("");

  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PaperPilot-Question-Bank</title><style>' +
    '@page{size:A4;margin:17mm 16mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:12pt;line-height:1.55;margin:0}.question-page{position:relative;break-after:page;page-break-after:always;break-inside:auto;min-height:250mm;padding-bottom:15mm}.question-page:last-child{break-after:auto;page-break-after:auto}header{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #d8dfeb;padding-bottom:9px;color:#536179;font-size:9pt}h1{font-size:21pt;line-height:1.2;margin:24px 0 8px;color:#111827}.source{font-size:9pt;color:#5b6578;margin:0 0 22px;overflow-wrap:anywhere}.stem{font-size:12pt;white-space:normal;overflow-wrap:anywhere}.options{margin-top:24px}.options h2,.diagram h2{font-size:11pt;margin:0 0 9px}.option{margin:8px 0 8px 12px;white-space:normal;overflow-wrap:anywhere}.diagram{margin-top:22px;padding:12px;border:1px solid #d9e0ea;border-radius:8px;break-inside:avoid}.diagram p{margin:0;overflow-wrap:anywhere}.review-note{margin-top:22px;padding:8px 10px;border-left:3px solid #b7791f;color:#714d11;font-size:9pt}.question-page footer{position:absolute;bottom:0;left:0;right:0;border-top:1px solid #e1e5ec;padding-top:7px;color:#788195;font-size:8pt}@media screen{body{background:#eef1f7;padding:18px}.question-page{background:white;max-width:800px;margin:0 auto 18px;padding:28px;box-shadow:0 4px 24px #17203318;min-height:980px}.question-page footer{left:28px;right:28px;bottom:28px}}@media print{.question-page{min-height:0}.question-page footer{position:fixed}}' +
    '</style></head><body><main>' + pages + '</main></body></html>';

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  state.message = "PDF print view opened. In the print window, choose Save as PDF.";
  render();
  window.setTimeout(() => {
    if (!printWindow.closed) {
      printWindow.focus();
      printWindow.print();
    }
  }, 450);
}

async function exportGoogleDoc() {
  if (!state.questions.length || state.busy) return;
  if (state.pages.some(page => page.status === "failed")) {
    state.message = "Retry every failed page before exporting, so the Google Doc is not knowingly incomplete.";
    render();
    return;
  }
  const tab = window.open("about:blank", "_blank");
  state.busy = true;
  state.message = "Creating a Google Doc with question text, options and required figure notes only…";
  render();
  try {
    const result = await jsonPost("/api/google?action=export", {
      title: "PaperPilot Question Bank",
      questions: state.questions.map(q => ({ questionText: q.questionText, options: q.options, diagramDescription: q.diagramDescription }))
    });
    state.message = "Google Doc created with " + result.questionCount + " questions.";
    if (tab) tab.location.href = result.url;
    else state.message += " Open it here: " + result.url;
  } catch (error) {
    if (tab) tab.close();
    state.message = error instanceof Error ? error.message : "Google Docs export failed.";
  } finally {
    state.busy = false;
    render();
  }
}
async function disconnectGoogleDocs() {
  try {
    await jsonPost("/api/google?action=disconnect", {});
    state.googleDocsConnected = false;
    state.message = "Google Docs disconnected from this workspace.";
  } catch (error) {
    state.message = error instanceof Error ? error.message : "Could not disconnect Google Docs.";
  }
  render();
}

checkAuth();
