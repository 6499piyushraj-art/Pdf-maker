import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import "./style.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type Question = {
  id: string; fileName: string; pageNumber: number; questionText: string;
  options: string[]; answer: string; explanation: string; diagramDescription: string;
  confidence: number; reviewRequired: boolean; reviewNotes: string[];
};
type PageRecord = { fileName: string; pageNumber: number; text: string; status: "done" | "failed"; error?: string; questions: number };
type AppState = { authenticated: boolean; configured: boolean; busy: boolean; files: File[]; questions: Question[]; pages: PageRecord[]; message: string; search: string; activeTab: "questions" | "pages" };
const state: AppState = { authenticated: false, configured: false, busy: false, files: [], questions: [], pages: [], message: "", search: "", activeTab: "questions" };
const app = document.querySelector<HTMLDivElement>("#app")!;
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonPost = async (url: string, body: unknown) => {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
};

async function checkAuth() {
  try {
    const response = await fetch("/api/auth", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json();
    state.configured = Boolean(data.configured);
    state.authenticated = Boolean(data.authenticated);
  } catch { state.configured = false; state.authenticated = false; }
  render();
}

function render() {
  if (!state.authenticated) {
    app.innerHTML = `<main class="login-shell"><div class="brand-mark">P</div><p class="eyebrow">PAPERPILOT AI</p><h1>Your PDFs.<br><span>Your question bank.</span></h1><p class="muted">Extract, check and export questions while keeping your Gemini key on the server.</p>
      ${!state.configured ? '<div class="notice danger">Setup required: configure GEMINI_API_KEY, APP_PASSWORD and SESSION_SECRET in your hosting environment.</div>' : ""}
      <form id="login-form" class="login-form"><label for="password">Workspace password</label><input id="password" name="password" type="password" autocomplete="current-password" required minlength="1" placeholder="Enter your password"><button class="primary" type="submit">Unlock workspace <span>→</span></button></form>
      <p class="message">${escapeHtml(state.message)}</p><p class="tiny">Your API key is never sent to the browser.</p></main>`;
    return;
  }
  const visible = state.questions.filter(q => [q.questionText, q.fileName, q.answer, ...q.options].join(" ").toLowerCase().includes(state.search.toLowerCase()));
  app.innerHTML = `<header class="topbar"><a class="brand" href="#"><span class="brand-mark small">P</span><span>PaperPilot <small>AI QUESTION MAKER</small></span></a><div class="top-actions"><span class="secure"><i></i> Private workspace</span><button class="quiet" id="logout">Sign out</button></div></header>
  <main class="workspace"><section class="hero"><div><p class="eyebrow">STUDY MATERIAL, ORGANIZED</p><h1>Turn PDFs into a<br><span>question bank.</span></h1><p class="muted">Extract each page in order, flag uncertain content, review answers and export a clean Word document.</p></div><div class="hero-art"><div class="paper paper-back"></div><div class="paper paper-front"><b>Q.</b><span></span><span></span><span class="short"></span><em>✓</em></div><div class="spark">✦</div></div></section>
  <section class="stats"><div><small>QUESTIONS</small><strong>${state.questions.length}</strong></div><div><small>PAGES CHECKED</small><strong>${state.pages.filter(p=>p.status==="done").length}</strong></div><div><small>NEEDS REVIEW</small><strong class="review-count">${state.questions.filter(q=>q.reviewRequired).length}</strong></div><div><small>FAILED PAGES</small><strong>${state.pages.filter(p=>p.status==="failed").length}</strong></div></section>
  <section class="panel upload-panel"><div class="section-heading"><div><p class="eyebrow">STEP 01</p><h2>Bring in your PDFs</h2><p class="muted">Up to 20 files. Pages are processed sequentially to preserve order.</p></div><span class="step-icon">↥</span></div>
  <label class="dropzone" for="pdf-input"><input id="pdf-input" type="file" accept="application/pdf,.pdf" multiple ${state.busy?"disabled":""}><span class="upload-icon">↑</span><strong>Choose PDF files</strong><span>or use your device's file picker</span><small>PDF only · maximum 20 files · 20 MB per file</small></label>
  ${state.files.length ? `<div class="file-list">${state.files.map((f,i)=>`<div class="file-row"><span class="file-icon">PDF</span><span class="file-name">${escapeHtml(f.name)}<small>${(f.size/1048576).toFixed(1)} MB</small></span><button class="icon-button remove-file" data-index="${i}" aria-label="Remove file" ${state.busy?"disabled":""}>×</button></div>`).join("")}</div><button id="process" class="primary process-button" ${state.busy?"disabled":""}>${state.busy?'<span class="spinner"></span> Processing pages…':'Extract questions <span>→</span>'}</button>` : ""}
  <p class="message">${escapeHtml(state.message)}</p></section>
  <section class="panel results-panel"><div class="section-heading results-heading"><div><p class="eyebrow">STEP 02</p><h2>Your question bank</h2><p class="muted">Review extracted content before exporting.</p></div><button id="export" class="secondary" ${state.questions.length?"":"disabled"}>Export DOCX ↓</button></div>
  <div class="results-tools"><div class="tabs"><button data-tab="questions" class="${state.activeTab==="questions"?"selected":""}">Questions <span>${state.questions.length}</span></button><button data-tab="pages" class="${state.activeTab==="pages"?"selected":""}">Page log <span>${state.pages.length}</span></button></div>${state.activeTab==="questions"?'<input id="search" class="search" placeholder="Search questions…" value="'+escapeHtml(state.search)+'">':""}</div>
  ${state.activeTab==="questions" ? (visible.length ? visible.map((q,i)=>`<article class="question-card"><div class="question-top"><span class="question-number">Q${state.questions.indexOf(q)+1}</span><span class="source">${escapeHtml(q.fileName)} · page ${q.pageNumber}</span>${q.reviewRequired?'<span class="review-badge">Review</span>':'<span class="ok-badge">Checked</span>'}</div>
    <label class="field-label">Question</label><textarea data-edit="questionText" data-id="${q.id}" rows="2">${escapeHtml(q.questionText)}</textarea>
    ${q.options.length?'<label class="field-label">Options</label>'+q.options.map((o,j)=>`<input class="option-edit" data-option="${j}" data-id="${q.id}" value="${escapeHtml(o)}">`).join(""):""}
    <div class="answer-grid"><div><label class="field-label">Answer</label><input data-edit="answer" data-id="${q.id}" value="${escapeHtml(q.answer)}" placeholder="Answer not detected"></div><div><label class="field-label">Explanation</label><textarea data-edit="explanation" data-id="${q.id}" rows="2">${escapeHtml(q.explanation)}</textarea></div></div>
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
  if (target.id === "export") { await exportDocx(); return; }
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
          const viewport = page.getViewport({ scale: Math.min(1.4, 1200 / page.getViewport({scale:1}).width) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not render the PDF page.");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const imageData = canvas.toDataURL("image/jpeg", 0.68).split(",")[1];
          const result = await jsonPost("/api/extract", { fileName: file.name, pageNumber, pageCount: pdf.numPages, pageText, imageData });
          const newQuestions: Question[] = (result.questions || []).map((q: any, i: number) => ({
            id: crypto.randomUUID(), fileName: file.name, pageNumber,
            questionText: String(q.questionText || ""), options: Array.isArray(q.options) ? q.options.map(String) : [],
            answer: String(q.answer || ""), explanation: String(q.explanation || ""), diagramDescription: String(q.diagramDescription || ""),
            confidence: Number.isFinite(q.confidence) ? Math.max(0, Math.min(1, q.confidence)) : 0.5,
            reviewRequired: Boolean(q.reviewRequired), reviewNotes: Array.isArray(q.reviewNotes) ? q.reviewNotes.map(String) : []
          }));
          let audit: any = { issues: [] };
          try {
            audit = await jsonPost("/api/audit", { fileName: file.name, pageNumber, pageText, questions: newQuestions.map(q => ({ questionText: q.questionText, options: q.options, answer: q.answer })) });
            for (const issue of audit.issues || []) {
              const q = newQuestions[Number(issue.questionIndex)];
              if (q) { q.reviewRequired = true; q.reviewNotes.push(String(issue.issue || "Second-pass audit flagged this question.")); }
            }
          } catch {
            for (const q of newQuestions) { q.reviewRequired = true; q.reviewNotes.push("Second-pass audit failed; compare this page with the original PDF."); }
          }
          state.questions.push(...newQuestions);
          state.pages.push({ fileName: file.name, pageNumber, text: pageText, status: "done", questions: newQuestions.length });
        } catch (error) {
          state.pages.push({ fileName: file.name, pageNumber, text: pageText, status: "failed", error: error instanceof Error ? error.message : "Unknown page error", questions: 0 });
        }
        render();
      }
    }
    state.activeTab = "questions";
    state.message = `Finished. ${state.questions.length} question(s) extracted; ${state.pages.filter(p=>p.status==="failed").length} page(s) failed and are listed in Page log.`;
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
      answer: String(q.answer || ""), explanation: String(q.explanation || ""), diagramDescription: String(q.diagramDescription || ""),
      confidence: Number.isFinite(q.confidence) ? Math.max(0, Math.min(1, q.confidence)) : 0.5,
      reviewRequired: Boolean(q.reviewRequired), reviewNotes: Array.isArray(q.reviewNotes) ? q.reviewNotes.map(String) : []
    }));
    try {
      const audit = await jsonPost("/api/audit", { fileName: file.name, pageNumber, pageText, questions: questions.map(q => ({ questionText: q.questionText, options: q.options, answer: q.answer })) });
      for (const issue of audit.issues || []) {
        const q = questions[Number(issue.questionIndex)];
        if (q) { q.reviewRequired = true; q.reviewNotes.push(String(issue.issue || "Second-pass audit flagged this question.")); }
      }
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

async function exportDocx() {
  if (!state.questions.length) return;
  const blocks: Paragraph[] = [
    new Paragraph({ text: "PaperPilot AI — Question Bank", heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `Questions: ${state.questions.length} | Pages processed: ${state.pages.filter(p=>p.status==="done").length} | Failed pages: ${state.pages.filter(p=>p.status==="failed").length}` }),
    new Paragraph({ text: "Review all AI-generated answers before using them.", spacing: { after: 240 } })
  ];
  if (state.pages.some(p=>p.status==="failed")) blocks.push(new Paragraph({ children: [new TextRun({ text: "WARNING: Some PDF pages failed to process. Check the Page log and re-run those pages before relying on this document.", bold: true, color: "B45309" })], spacing: { after: 240 } }));
  state.questions.forEach((q, index) => {
    blocks.push(new Paragraph({ text: `Question ${index+1}`, heading: HeadingLevel.HEADING_2 }));
    blocks.push(new Paragraph({ children: [new TextRun({ text: q.questionText })] }));
    q.options.forEach(option => blocks.push(new Paragraph({ text: option, indent: { left: 360 } })));
    if (q.answer) blocks.push(new Paragraph({ children: [new TextRun({ text: "Answer: ", bold: true }), new TextRun(q.answer)] }));
    if (q.explanation) blocks.push(new Paragraph({ children: [new TextRun({ text: "Explanation: ", bold: true }), new TextRun(q.explanation)] }));
    if (q.diagramDescription) blocks.push(new Paragraph({ children: [new TextRun({ text: "Diagram note: ", bold: true }), new TextRun(q.diagramDescription)] }));
    blocks.push(new Paragraph({ children: [new TextRun({ text: `Source: ${q.fileName}, page ${q.pageNumber} · Confidence ${Math.round(q.confidence*100)}% · ${q.reviewRequired?"Manual review required":"No automatic review flag"}`, italics: true, color: "64748B" })], spacing: { after: 220 } }));
  });
  if (state.pages.some(p=>p.status==="failed")) {
    blocks.push(new Paragraph({ text: "Failed page log", heading: HeadingLevel.HEADING_1 }));
    state.pages.filter(p=>p.status==="failed").forEach(p=>blocks.push(new Paragraph({ text: `${p.fileName}, page ${p.pageNumber}: ${p.error || "Processing failed"}` })));
  }
  const blob = await Packer.toBlob(new Document({ sections: [{ children: blocks }] }));
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = "PaperPilot-Question-Bank.docx"; link.click(); URL.revokeObjectURL(url);
}

checkAuth();
