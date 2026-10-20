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
type AppState = { authenticated: boolean; configured: boolean; apiUnavailable: boolean; busy: boolean; files: File[]; questions: Question[]; pages: PageRecord[]; message: string; search: string; activeTab: "questions" | "pages" };
const state: AppState = { authenticated: false, configured: false, apiUnavailable: false, busy: false, files: [], questions: [], pages: [], message: "", search: "", activeTab: "questions", googleDocsConfigured: false, googleDocsConnected: false };
const app = document.querySelector<HTMLDivElement>("#app")!;
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonPost = async (url: string, body: unknown) => {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
};

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
  <section class="panel results-panel"><div class="section-heading results-heading"><div><p class="eyebrow">STEP 02</p><h2>Your question bank</h2><p class="muted">Only question text, options and necessary figure notes are included. Answers, solutions and explanations are excluded.</p></div><div class="google-actions">${renderGoogleDocsAction()}</div></div>
  <div class="results-tools"><div class="tabs"><button data-tab="questions" class="${state.activeTab==="questions"?"selected":""}">Questions <span>${state.questions.length}</span></button><button data-tab="pages" class="${state.activeTab==="pages"?"selected":""}">Page log <span>${state.pages.length}</span></button></div>${state.activeTab==="questions"?'<input id="search" class="search" placeholder="Search questions…" value="'+escapeHtml(state.search)+'">':""}</div>
  ${state.activeTab==="questions" ? (visible.length ? visible.map((q,i)=>`<article class="question-card"><div class="question-top"><span class="question-number">Q${state.questions.indexOf(q)+1}</span><span class="source">${escapeHtml(q.fileName)} · page ${q.pageNumber}</span>${q.reviewRequired?'<span class="review-badge">Review</span>':'<span class="ok-badge">Checked</span>'}</div>
    <label class="field-label">Question</label><textarea data-edit="questionText" data-id="${q.id}" rows="2">${escapeHtml(q.questionText)}</textarea>
    ${q.options.length?'<label class="field-label">Options</label>'+q.options.map((o,j)=>`<input class="option-edit" data-option="${j}" data-id="${q.id}" value="${escapeHtml(o)}">`).join(""):""}
    ${q.diagramDescription?'<p class="diagram-note">Diagram: '+escapeHtml(q.diagramDescription)+'</p>':""}
    ${q.reviewNotes.length?'<p class="review-note">'+escapeHtml(q.reviewNotes.join(" · "))+'</p>':""}
    <div class="card-footer"><span>Confidence ${Math.round(q.confidence*100)}%</span><label class="review-toggle"><input type="checkbox" data-review="${q.id}" ${q.reviewRequired?"checked":""}> Needs manual review</label></div></article>`).join("") : '<div class="empty-state"><div>✧</div><h3>No questions yet</h3><p>Choose your PDFs above, then start extraction.</p></div>') : (state.pages.length ? state.pages.map(p=>`<div class="page-row"><span class="status-dot ${p.status}"></span><div><strong>${escapeHtml(p.fileName)} · page ${p.pageNumber}</strong><small>${p.status==="done"?p.questions+" question(s) extracted":escapeHtml(p.error||"Processing failed")}</small></div>${p.status==="failed"?'<button class="retry secondary" data-file="'+escapeHtml(p.fileName)+'" data-page="'+p.pageNumber+'">Retry page</button>':""}</div>`).join(""):'<div class="empty-state"><h3>No pages processed yet</h3><p>Your page-by-page progress will appear here.</p></div>')}
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
          pageText = textContent.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
          const baseViewport = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(1.1, 1000 / baseViewport.width) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not render the PDF page.");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const imageData = canvas.toDataURL("image/jpeg", 0.55).split(",")[1];
          const result = await jsonPost("/api/extract", { fileName: file.name, pageNumber, pageCount: pdf.numPages, pageText, imageData });
          const newQuestions: Question[] = (result.questions || []).map((q: any, i: number) => ({
            id: crypto.randomUUID(), fileName: file.name, pageNumber,
            questionText: String(q.questionText || ""), options: Array.isArray(q.options) ? q.options.map(String) : [],
diagramDescription: String(q.diagramDescription || ""),
            confidence: Number.isFinite(q.confidence) ? Math.max(0, Math.min(1, q.confidence)) : 0.5,
            reviewRequired: Boolean(q.reviewRequired), reviewNotes: Array.isArray(q.reviewNotes) ? q.reviewNotes.map(String) : []
          }));
          let audit: any = { issues: [] };
          try {
            audit = await jsonPost("/api/audit", { fileName: file.name, pageNumber, pageText, imageData, questions: newQuestions.map(q => ({ questionText: q.questionText, options: q.options, diagramDescription: q.diagramDescription })) });
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
    const pageText = textContent.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1.1, 1000 / baseViewport.width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not render the PDF page.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const imageData = canvas.toDataURL("image/jpeg", 0.55).split(",")[1];
    const result = await jsonPost("/api/extract", { fileName: file.name, pageNumber, pageCount: pdf.numPages, pageText, imageData });
    const questions: Question[] = (result.questions || []).map((q: any) => ({
      id: crypto.randomUUID(), fileName: file.name, pageNumber,
      questionText: String(q.questionText || ""), options: Array.isArray(q.options) ? q.options.map(String) : [],
diagramDescription: String(q.diagramDescription || ""),
      confidence: Number.isFinite(q.confidence) ? Math.max(0, Math.min(1, q.confidence)) : 0.5,
      reviewRequired: Boolean(q.reviewRequired), reviewNotes: Array.isArray(q.reviewNotes) ? q.reviewNotes.map(String) : []
    }));
    try {
      const audit = await jsonPost("/api/audit", { fileName: file.name, pageNumber, pageText, imageData, questions: questions.map(q => ({ questionText: q.questionText, options: q.options, diagramDescription: q.diagramDescription })) });
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
