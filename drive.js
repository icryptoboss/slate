// ===== PDF viewer =====
// Supports a mixed sequence of real PDF pages and inserted blank pages (so you can
// work something out right where you need it, without leaving the document), full-size
// rendering that fills the available screen, and the shared drawing engine for
// pen/shapes/undo on every page.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

const PDFViewer = (() => {
  let pdfDoc = null;
  let currentFileId = null;
  let numPages = 0;
  let currentPage = 1; // 1-based position within `sequence`
  let stageEl = null;
  let observer = null;
  let onPageChange = null;
  let sequence = []; // [{ type: "pdf", ref: pageNum } | { type: "blank", ref: blankId }]
  const renderedPositions = new Set();
  const engines = new Map(); // sequence position -> { engine, renderCanvas }

  function structureKey(fileId) {
    return `slate_structure:${fileId}`;
  }
  function saveSequence() {
    localStorage.setItem(structureKey(currentFileId), JSON.stringify(sequence));
  }
  function loadSequence(fileId, total) {
    try {
      const raw = localStorage.getItem(structureKey(fileId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const pdfRefs = parsed.filter((e) => e.type === "pdf").map((e) => e.ref);
      const validRange = pdfRefs.every((r) => r >= 1 && r <= total);
      if (!validRange || pdfRefs.length !== total) return null; // structure stale/mismatched, ignore
      return parsed;
    } catch {
      return null;
    }
  }

  function annotationPageKey(entry) {
    return entry.type === "pdf" ? String(entry.ref) : `blank-${entry.ref}`;
  }

  function renumberDom() {
    const els = stageEl.querySelectorAll(".pdf-page");
    els.forEach((el, i) => { el.dataset.page = String(i + 1); });
  }

  function rebuildObserver() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pos = Number(entry.target.dataset.page);
            currentPage = pos;
            document.getElementById("pageIndicator").textContent = `${pos} / ${sequence.length}`;
            renderAt(pos);
            renderAt(Math.min(pos + 1, sequence.length));
            if (onPageChange) onPageChange(sequence[pos - 1], pos);
            App.refreshToolbarState();
          }
        }
      },
      { root: stageEl, threshold: 0.5 }
    );
    stageEl.querySelectorAll(".pdf-page").forEach((el) => observer.observe(el));
  }

  function buildSkeletonEl(pos) {
    const el = document.createElement("div");
    el.className = "pdf-page";
    el.dataset.page = String(pos);
    el.innerHTML = `<div class="skeleton page-skel" style="width:min(94vw,900px);height:70vh"></div>`;
    return el;
  }

  async function renderAt(pos) {
    if (renderedPositions.has(pos)) return;
    const entry = sequence[pos - 1];
    if (!entry) return;
    renderedPositions.add(pos);

    const container = stageEl.querySelector(`.pdf-page[data-page="${pos}"]`);
    if (!container) return;
    const skeleton = container.querySelector(".page-skel");
    if (skeleton) skeleton.remove();

    const stageRect = stageEl.getBoundingClientRect();
    const availWidth = stageRect.width * 0.96;
    const availHeight = stageRect.height * 0.94;
    const pixelRatio = window.devicePixelRatio || 1;

    let cssWidth, cssHeight, renderCanvas;

    if (entry.type === "pdf") {
      const page = await pdfDoc.getPage(entry.ref);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(availWidth / base.width, availHeight / base.height);
      const viewport = page.getViewport({ scale });
      cssWidth = viewport.width;
      cssHeight = viewport.height;

      renderCanvas = document.createElement("canvas");
      renderCanvas.className = "render-canvas";
      renderCanvas.width = cssWidth * pixelRatio;
      renderCanvas.height = cssHeight * pixelRatio;
      renderCanvas.style.width = cssWidth + "px";
      renderCanvas.style.height = cssHeight + "px";

      const ctx = renderCanvas.getContext("2d");
      ctx.scale(pixelRatio, pixelRatio);
      await page.render({ canvasContext: ctx, viewport }).promise;
    } else {
      // Blank inserted page — matches the aspect ratio of a standard A4 sheet.
      const aspect = 1 / Math.SQRT2;
      cssHeight = availHeight;
      cssWidth = cssHeight * aspect;
      if (cssWidth > availWidth) { cssWidth = availWidth; cssHeight = cssWidth / aspect; }

      renderCanvas = document.createElement("canvas");
      renderCanvas.className = "render-canvas";
      renderCanvas.width = cssWidth * pixelRatio;
      renderCanvas.height = cssHeight * pixelRatio;
      renderCanvas.style.width = cssWidth + "px";
      renderCanvas.style.height = cssHeight + "px";
      const bgctx = renderCanvas.getContext("2d");
      bgctx.scale(pixelRatio, pixelRatio);
      bgctx.fillStyle = "#ffffff";
      bgctx.fillRect(0, 0, cssWidth, cssHeight);
    }

    const drawCanvas = document.createElement("canvas");
    drawCanvas.className = "draw-canvas";
    drawCanvas.width = cssWidth * pixelRatio;
    drawCanvas.height = cssHeight * pixelRatio;
    drawCanvas.style.width = cssWidth + "px";
    drawCanvas.style.height = cssHeight + "px";

    const wrap = document.createElement("div");
    wrap.style.position = "relative";
    wrap.style.width = cssWidth + "px";
    wrap.style.height = cssHeight + "px";
    wrap.appendChild(renderCanvas);
    wrap.appendChild(drawCanvas);
    container.appendChild(wrap);

    const engine = attachDrawingEngine(drawCanvas, currentFileId, annotationPageKey(entry));
    engines.set(pos, { engine, renderCanvas });
  }

  async function open(fileId, containerEl, opts = {}) {
    currentFileId = fileId;
    stageEl = containerEl;
    onPageChange = opts.onPageChange || null;
    stageEl.innerHTML = "";
    renderedPositions.clear();
    engines.clear();

    const loading = document.createElement("div");
    loading.className = "empty-card";
    loading.style.margin = "auto";
    loading.innerHTML = `<p class="handwritten">Opening your sheet…</p>`;
    stageEl.appendChild(loading);

    const url = Drive.fileContentUrl(fileId);
    pdfDoc = await pdfjsLib.getDocument(url).promise;
    numPages = pdfDoc.numPages;
    stageEl.innerHTML = "";

    sequence = loadSequence(fileId, numPages) ||
      Array.from({ length: numPages }, (_, i) => ({ type: "pdf", ref: i + 1 }));

    sequence.forEach((_, i) => stageEl.appendChild(buildSkeletonEl(i + 1)));

    currentPage = Math.min(Math.max(opts.startPage || 1, 1), sequence.length);
    document.getElementById("pageIndicator").textContent = `${currentPage} / ${sequence.length}`;

    rebuildObserver();
    await renderAt(currentPage);
    if (currentPage > 1) goTo(currentPage, "auto");
  }

  function goTo(pos, behavior = "smooth") {
    const target = stageEl.querySelector(`.pdf-page[data-page="${pos}"]`);
    if (target) target.scrollIntoView({ behavior, block: "start" });
  }
  function nextPage() { if (currentPage < sequence.length) goTo(currentPage + 1); }
  function prevPage() { if (currentPage > 1) goTo(currentPage - 1); }

  function insertBlankPage() {
    const blankId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
    const insertAt = currentPage; // new page goes right after the one you're viewing
    sequence.splice(insertAt, 0, { type: "blank", ref: blankId });
    saveSequence();

    const newEl = buildSkeletonEl(insertAt + 1);
    const afterEl = stageEl.querySelector(`.pdf-page[data-page="${insertAt}"]`);
    afterEl.insertAdjacentElement("afterend", newEl);
    renumberDom();

    // Positions after the insert point shifted by +1 — re-key tracking maps (highest
    // position first, so we never overwrite a slot before reading it).
    const shiftFrom = insertAt + 1;
    for (const pos of [...renderedPositions].filter((p) => p >= shiftFrom).sort((a, b) => b - a)) {
      renderedPositions.delete(pos);
      renderedPositions.add(pos + 1);
    }
    for (const [pos, val] of [...engines.entries()].filter(([p]) => p >= shiftFrom).sort((a, b) => b[0] - a[0])) {
      engines.delete(pos);
      engines.set(pos + 1, val);
    }

    rebuildObserver();
    document.getElementById("pageIndicator").textContent = `${insertAt + 1} / ${sequence.length}`;
    goTo(insertAt + 1);
  }

  function currentEngine() {
    const entry = engines.get(currentPage);
    return entry ? entry.engine : null;
  }

  function setDrawingEnabled(v) {
    engines.forEach(({ engine }) => engine.setDrawingEnabled(v));
  }

  function exportCurrentPage() {
    const entry = engines.get(currentPage);
    if (!entry) return null;
    return entry.engine.exportPNG(entry.renderCanvas);
  }

  function destroy() {
    if (observer) observer.disconnect();
    pdfDoc = null;
    sequence = [];
    renderedPositions.clear();
    engines.clear();
  }

  return {
    open, nextPage, prevPage, destroy, setDrawingEnabled, exportCurrentPage, insertBlankPage,
    currentEngine, getCurrentPage: () => currentPage, getNumPages: () => sequence.length,
  };
})();
