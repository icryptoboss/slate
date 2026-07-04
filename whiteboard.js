// ===== App shell / router =====
const views = {
  folders: document.getElementById("foldersView"),
  files: document.getElementById("filesView"),
  viewer: document.getElementById("viewerView"),
  empty: document.getElementById("emptyState"),
};
const crumbEl = document.getElementById("crumb");
const backBtn = document.getElementById("backBtn");

let ActiveViewer = null; // PDFViewer or Whiteboard, whichever is open
let isWhiteboardMode = false;

const App = {
  refreshToolbarState() {
    if (!ActiveViewer) return;
    const engine = ActiveViewer.currentEngine ? ActiveViewer.currentEngine() : null;
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");
    if (engine) {
      undoBtn.disabled = !engine.canUndo();
      redoBtn.disabled = !engine.canRedo();
    }
  },
};

function showView(name) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
  backBtn.classList.toggle("hidden", name === "folders");
}

function iconFolder() {
  return `<svg class="card-icon" width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2.5h8.5A1.5 1.5 0 0121 9v9.5A1.5 1.5 0 0119.5 20h-15A1.5 1.5 0 013 18.5v-12z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function iconFile() {
  return `<svg class="card-icon" width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

function skeletonGrid(el, count) {
  el.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const s = document.createElement("div");
    s.className = "skeleton";
    el.appendChild(s);
  }
}

function showEmpty(message) {
  document.getElementById("emptyMessage").textContent = message;
  showView("empty");
}

// ----- Last opened (continue where you left off) -----
function saveLastOpen(fileId, fileName, page) {
  localStorage.setItem("slate_last_open", JSON.stringify({ fileId, fileName, page, at: Date.now() }));
}
function readLastOpen() {
  try {
    const raw = localStorage.getItem("slate_last_open");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function renderContinueCard() {
  const card = document.getElementById("continueCard");
  const last = readLastOpen();
  if (!last) {
    card.classList.add("hidden");
    return;
  }
  document.getElementById("continueTitle").textContent = `${last.fileName} — page ${last.page}`;
  card.href = `#/file/${last.fileId}/${encodeURIComponent(last.fileName)}?page=${last.page}`;
  card.classList.remove("hidden");
}

// ----- Router -----
function parseHash() {
  const hash = location.hash.slice(2); // strip "#/"
  const [pathPart, queryPart] = hash.split("?");
  const [route, id, ...nameParts] = pathPart.split("/");
  const name = decodeURIComponent(nameParts.join("/") || "");
  const params = new URLSearchParams(queryPart || "");
  return { route, id, name, params };
}

async function router() {
  const { route, id, name, params } = parseHash();

  if (ActiveViewer && ActiveViewer.destroy) ActiveViewer.destroy();
  ActiveViewer = null;
  isWhiteboardMode = false;

  if (!route || route === "") {
    crumbEl.textContent = "";
    await renderFolders();
  } else if (route === "folder") {
    crumbEl.textContent = name;
    await renderFiles(id, name);
  } else if (route === "file") {
    crumbEl.textContent = name;
    const startPage = Number(params.get("page")) || 1;
    await openViewer(id, name, startPage);
  } else if (route === "whiteboard") {
    crumbEl.textContent = "Blank board";
    openWhiteboard();
  } else {
    showEmpty("That page doesn't exist.");
  }
}

async function renderFolders() {
  showView("folders");
  renderContinueCard();
  const grid = document.getElementById("foldersGrid");
  skeletonGrid(grid, 6);
  try {
    const folders = await Drive.listChildren(null, { foldersOnly: true });
    if (folders.length === 0) {
      grid.innerHTML = "";
      showEmpty("No subject folders found in your root Drive folder yet.");
      return;
    }
    grid.innerHTML = "";
    for (const f of folders) {
      const card = document.createElement("a");
      card.className = "folder-card";
      card.href = `#/folder/${f.id}/${encodeURIComponent(f.name)}`;
      card.innerHTML = `${iconFolder()}<div><div class="card-title">${escapeHtml(f.name)}</div><div class="card-sub">Subject folder</div></div>`;
      grid.appendChild(card);
    }
  } catch (err) {
    grid.innerHTML = "";
    showEmpty("Couldn't load your Drive folders — check the server's API key and folder ID.");
    console.error(err);
  }
}

async function renderFiles(folderId, folderName) {
  showView("files");
  document.getElementById("filesTitle").textContent = folderName;
  const grid = document.getElementById("filesGrid");
  skeletonGrid(grid, 6);
  try {
    const files = await Drive.listChildren(folderId, { pdfsOnly: true });
    if (files.length === 0) {
      grid.innerHTML = "";
      showEmpty(`No PDFs in "${folderName}" yet.`);
      return;
    }
    grid.innerHTML = "";
    for (const f of files) {
      const card = document.createElement("a");
      card.className = "file-card";
      card.href = `#/file/${f.id}/${encodeURIComponent(f.name)}`;
      card.innerHTML = `${iconFile()}<div><div class="card-title">${escapeHtml(f.name)}</div><div class="card-sub">PDF</div></div>`;
      grid.appendChild(card);
    }
  } catch (err) {
    grid.innerHTML = "";
    showEmpty("Couldn't load files in this folder.");
    console.error(err);
  }
}

async function openViewer(fileId, fileName, startPage) {
  showView("viewer");
  const stage = document.getElementById("pdfStage");
  try {
    await PDFViewer.open(fileId, stage, {
      startPage,
      onPageChange: (entry, pos) => saveLastOpen(fileId, fileName, pos),
    });
    ActiveViewer = PDFViewer;
    App.refreshToolbarState();
  } catch (err) {
    showEmpty("Couldn't open this PDF. It may not be public yet.");
    console.error(err);
  }
}

function openWhiteboard() {
  showView("viewer");
  isWhiteboardMode = true;
  const stage = document.getElementById("pdfStage");
  Whiteboard.open(stage);
  ActiveViewer = Whiteboard;
  App.refreshToolbarState();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ----- Back button -----
backBtn.addEventListener("click", () => {
  const { route } = parseHash();
  if (route === "file" || route === "whiteboard") {
    history.back();
  } else {
    location.hash = "#/";
  }
});

// ----- New whiteboard button -----
document.getElementById("newBoardBtn").addEventListener("click", () => {
  location.hash = "#/whiteboard";
});

// ----- Logout / lock button -----
document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (!confirm("Lock this site? You'll need the password to open it again.")) return;
  await fetch("/api/logout", { method: "POST" });
  location.reload();
});

// ----- Viewer nav buttons -----
document.getElementById("prevPageBtn").addEventListener("click", () => ActiveViewer && ActiveViewer.prevPage());
document.getElementById("nextPageBtn").addEventListener("click", () => ActiveViewer && ActiveViewer.nextPage());
document.getElementById("insertPageBtn").addEventListener("click", () => {
  if (isWhiteboardMode) {
    Whiteboard.addPage();
  } else if (ActiveViewer && ActiveViewer.insertBlankPage) {
    ActiveViewer.insertBlankPage();
  }
});
window.addEventListener("keydown", (e) => {
  if (views.viewer.classList.contains("hidden") || !ActiveViewer) return;
  if (e.key === "ArrowDown" || e.key === "ArrowRight") ActiveViewer.nextPage();
  if (e.key === "ArrowUp" || e.key === "ArrowLeft") ActiveViewer.prevPage();
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); doRedo(); }
});

// ----- Pen toolbar -----
document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool-btn[data-tool]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    PenState.tool = btn.dataset.tool;
  });
});
document.querySelectorAll(".swatch").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".swatch").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    PenState.color = btn.dataset.color;
  });
});
document.getElementById("thicknessRange").addEventListener("input", (e) => {
  PenState.thickness = Number(e.target.value);
});
document.getElementById("clearPageBtn").addEventListener("click", () => {
  if (!ActiveViewer) return;
  if (confirm("Clear all drawing on this page?")) {
    const engine = ActiveViewer.currentEngine();
    if (engine) engine.clear();
    App.refreshToolbarState();
  }
});

function doUndo() {
  if (!ActiveViewer) return;
  const engine = ActiveViewer.currentEngine();
  if (engine) engine.undo();
  App.refreshToolbarState();
}
function doRedo() {
  if (!ActiveViewer) return;
  const engine = ActiveViewer.currentEngine();
  if (engine) engine.redo();
  App.refreshToolbarState();
}
document.getElementById("undoBtn").addEventListener("click", doUndo);
document.getElementById("redoBtn").addEventListener("click", doRedo);

let drawingOn = true;
document.getElementById("toggleDrawBtn").addEventListener("click", (e) => {
  drawingOn = !drawingOn;
  if (ActiveViewer) ActiveViewer.setDrawingEnabled(drawingOn);
  e.currentTarget.classList.toggle("active", !drawingOn);
  e.currentTarget.title = drawingOn ? "Pause drawing (pan/scroll freely)" : "Resume drawing";
});

// ----- Fullscreen -----
const fsBtn = document.getElementById("fullscreenBtn");
fsBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});
document.addEventListener("fullscreenchange", () => {
  const active = Boolean(document.fullscreenElement);
  document.body.classList.toggle("fullscreen-active", active);
  document.getElementById("fsIconExpand").classList.toggle("hidden", active);
  document.getElementById("fsIconCollapse").classList.toggle("hidden", !active);
});

// ----- Online/offline indicator -----
window.addEventListener("offline", () => {
  document.getElementById("syncState").className = "sync-state offline";
});
window.addEventListener("online", () => {
  document.getElementById("syncState").className = "sync-state";
});

// ----- Service worker (offline support) -----
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}

// ----- Boot -----
window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", () => {
  if (!navigator.onLine) document.getElementById("syncState").className = "sync-state offline";
  router();
});
