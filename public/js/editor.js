// Document editor using TipTap rich text (CDN-loaded for ESM support).
// Multiple documents stored in localStorage as HTML.
// Formatting toolbar: bold, italic, headings, lists, links, images.
// Export to .html and .txt.

const TIP = "https://esm.sh/@tiptap";

let activeEditor = null;

export async function initEditor(containerEl, initialContent = "") {
  const { Editor } = await import(TIP + "/core@2.11.7");
  const { StarterKit } = await import(TIP + "/starter-kit@2.11.7");
  const { Link } = await import(TIP + "/extension-link@2.11.7");
  const { Image } = await import(TIP + "/extension-image@2.11.7");

  const toolbar = document.createElement("div");
  toolbar.style.cssText = "display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid var(--line);flex-wrap:wrap;background:var(--bg);";

  const mk = (label, action, isActive) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "padding:3px 8px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--ink);cursor:pointer;font-size:12px;font-family:var(--font);";
    b.onclick = (e) => { e.preventDefault(); action(); };
    return b;
  };

  const bB = mk("B", () => activeEditor?.chain().focus().toggleBold().run(), () => activeEditor?.isActive("bold"));
  bB.style.fontWeight = "700";
  const bI = mk("I", () => activeEditor?.chain().focus().toggleItalic().run(), () => activeEditor?.isActive("italic"));
  bI.style.fontStyle = "italic";
  toolbar.append(bB, bI);

  for (const h of ["P", "H1", "H2", "H3"]) {
    const b = mk(h, () => {
      if (h === "P") activeEditor?.chain().focus().setParagraph().run();
      else activeEditor?.chain().focus().toggleHeading({ level: parseInt(h[1]) }).run();
    }, () => false);
    b.style.fontSize = h === "P" ? "12px" : (13 - parseInt(h[1]) * 1) + "px";
    b.style.fontWeight = h === "P" ? "400" : "700";
    toolbar.appendChild(b);
  }

  toolbar.appendChild(mk("\u2022", () => activeEditor?.chain().focus().toggleBulletList().run(), () => false));
  toolbar.appendChild(mk("1.", () => activeEditor?.chain().focus().toggleOrderedList().run(), () => false));
  toolbar.appendChild(mk("\u{1F517}", () => { const u = prompt("URL:", "https://"); if (u) activeEditor?.chain().focus().setLink({ href: u }).run(); }, () => false));
  toolbar.appendChild(mk("\u{1F5BC}", () => { const u = prompt("Image URL:"); if (u) activeEditor?.chain().focus().setImage({ src: u }).run(); }, () => false));

  containerEl.innerHTML = "";
  containerEl.appendChild(toolbar);

  const editorEl = document.createElement("div");
  editorEl.style.cssText = "flex:1;overflow-y:auto;padding:12px;outline:none;";
  containerEl.appendChild(editorEl);

  const editor = new Editor({
    element: editorEl,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Link.configure({ openOnClick: false }), Image],
    content: initialContent || "<p>Start writing...</p>",
  });

  activeEditor = editor;
  return editor;
}

export function saveDocument(id, html) {
  try { localStorage.setItem("lux.doc." + id, html); return true; } catch { return false; }
}

export function loadDocument(id) {
  try { return localStorage.getItem("lux.doc." + id) || "<p>Start writing...</p>"; } catch { return "<p>Start writing...</p>"; }
}

export function getActiveEditor() { return activeEditor; }

export function exportAsHtml() {
  if (!activeEditor) return;
  download("document.html", activeEditor.getHTML(), "text/html");
}

export function exportAsText() {
  if (!activeEditor) return;
  download("document.txt", activeEditor.getText(), "text/plain");
}

function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
}
