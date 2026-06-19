// Document editor. Uses a plain contenteditable with document.execCommand
// for formatting — zero dependencies, works offline. Covers the 80% of what
// TipTap offered (bold/italic/headings/lists/links) without a CDN dependency.
//
// Multiple documents stored as HTML in localStorage.
// Export to .html and .txt.

let activeEditor = null;
let activeDocId = null;

export async function initEditor(containerEl, initialContent = "") {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;height:100%;position:relative;";

  // Formatting toolbar.
  const toolbar = document.createElement("div");
  toolbar.style.cssText =
    "display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid var(--line);" +
    "flex-wrap:wrap;background:var(--bg);align-items:center;";

  const mk = (label, action, title) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.title = title || label;
    btn.style.cssText =
      "padding:4px 8px;border:1px solid var(--line);border-radius:4px;" +
      "background:var(--bg);color:var(--ink);cursor:pointer;font-size:13px;";
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => { action(); surface.focus(); };
    return btn;
  };

  const surface = document.createElement("div");
  surface.contentEditable = "true";
  surface.spellcheck = false;
  surface.style.cssText =
    "flex:1;overflow:auto;padding:16px;font-size:16px;line-height:1.6;" +
    "outline:none;color:var(--ink);font-family:var(--font);";
  surface.innerHTML = initialContent || "<p><br></p>";

  toolbar.appendChild(mk("B", () => document.execCommand("bold"), "Bold"));
  toolbar.appendChild(mk("I", () => document.execCommand("italic"), "Italic"));
  toolbar.appendChild(mk("H1", () => document.execCommand("formatBlock", false, "H1"), "Heading 1"));
  toolbar.appendChild(mk("H2", () => document.execCommand("formatBlock", false, "H2"), "Heading 2"));
  toolbar.appendChild(mk("P", () => document.execCommand("formatBlock", false, "P"), "Paragraph"));
  toolbar.appendChild(mk("\u2022 List", () => document.execCommand("insertUnorderedList"), "Bullet list"));
  toolbar.appendChild(mk("1. List", () => document.execCommand("insertOrderedList"), "Numbered list"));
  toolbar.appendChild(mk("Link", () => {
    const url = prompt("Enter URL:");
    if (url) document.execCommand("createLink", false, url);
  }, "Insert link"));

  // Document selector + save/export.
  const docSelect = document.createElement("select");
  docSelect.style.cssText = "padding:4px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--ink);font-size:12px;margin-left:auto;";

  const newDocBtn = mk("+ New", () => {
    const id = "doc_" + Date.now();
    const docs = getDocs();
    docs[id] = { id, title: "New Document", html: "<p><br></p>", updated: Date.now() };
    saveDocs(docs);
    loadDocList(docSelect);
    switchDoc(id, surface);
  }, "New document");

  const saveBtn = mk("Save", () => saveCurrent(surface), "Save");
  const exportHtml = mk("Export HTML", () => {
    const blob = new Blob([surface.innerHTML], { type: "text/html" });
    downloadBlob(blob, "document.html");
  }, "Export as HTML");
  const exportTxt = mk("Export TXT", () => {
    const blob = new Blob([surface.innerText], { type: "text/plain" });
    downloadBlob(blob, "document.txt");
  }, "Export as text");

  function loadDocList(sel) {
    const docs = getDocs();
    let keys = Object.keys(docs).sort((a, b) => (docs[b].updated || 0) - (docs[a].updated || 0));
    if (keys.length === 0) {
      const id = "doc_" + Date.now();
      docs[id] = { id, title: "Document", html: "<p><br></p>", updated: Date.now() };
      saveDocs(docs);
      keys = [id];
    }
    sel.innerHTML = "";
    for (const k of keys) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = docs[k].title || "Untitled";
      sel.appendChild(opt);
    }
  }

  function switchDoc(id, surf) {
    const docs = getDocs();
    const doc = docs[id];
    activeDocId = id;
    surf.innerHTML = (doc && doc.html) || "<p><br></p>";
    docSelect.value = id;
  }

  function saveCurrent(surf) {
    if (!activeDocId) return;
    const docs = getDocs();
    docs[activeDocId] = { id: activeDocId, title: "Document", html: surf.innerHTML, updated: Date.now() };
    saveDocs(docs);
    showStatus("Saved", wrap);
  }

  docSelect.onchange = () => switchDoc(docSelect.value, surface);
  loadDocList(docSelect);

  // Auto-save (debounced).
  let saveTimer = null;
  surface.addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveCurrent(surface), 2000);
  });

  toolbar.appendChild(docSelect);
  toolbar.appendChild(newDocBtn);
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(exportHtml);
  toolbar.appendChild(exportTxt);

  wrap.appendChild(toolbar);
  wrap.appendChild(surface);
  containerEl.innerHTML = "";
  containerEl.appendChild(wrap);

  // Load the most recent document.
  const docs = getDocs();
  const firstKey = Object.keys(docs).sort((a, b) => (docs[b].updated || 0) - (docs[a].updated || 0))[0];
  if (firstKey) switchDoc(firstKey, surface);

  activeEditor = { surface, activeDocId };
  return activeEditor;
}

function getDocs() {
  try { return JSON.parse(localStorage.getItem("lux.docs") || "{}"); }
  catch { return {}; }
}
function saveDocs(docs) {
  localStorage.setItem("lux.docs", JSON.stringify(docs));
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showStatus(msg, wrap) {
  let el = wrap.querySelector(".editor-status");
  if (!el) {
    el = document.createElement("div");
    el.className = "editor-status";
    el.style.cssText = "position:absolute;top:42px;right:12px;font-size:11px;color:var(--ink-soft);background:var(--bg);padding:2px 6px;border-radius:4px;opacity:0;transition:opacity 0.3s;pointer-events:none;";
    wrap.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  setTimeout(() => { el.style.opacity = "0"; }, 1500);
}

// Compat exports for main.js.
export function saveDocument(id, html) { saveDocs({ ...getDocs(), [id]: { id, html, updated: Date.now() } }); }
export function loadDocument(id) { return (getDocs()[id] || {}).html || "<p><br></p>"; }
export function getActiveEditor() { return activeEditor; }
export function exportAsHtml() { if (activeEditor) downloadBlob(new Blob([activeEditor.surface.innerHTML], { type: "text/html" }), "document.html"); }
export function exportAsText() { if (activeEditor) downloadBlob(new Blob([activeEditor.surface.innerText], { type: "text/plain" }), "document.txt"); }
