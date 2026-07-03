// ===== PDF viewer (uses the shared drawing engine for pen/shapes/undo) =====
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";

const PDFViewer = (() => {
  let pdfDoc = null;
  let currentFileId = null;
  let numPages = 0;
  let currentPage = 1;
  let stageEl = null;
  let observer = null;
  let onPageChange = null;
  const renderedPages = new Set();
  const engines = new Map(); // page number -> engine

  async function renderPage(pageNum) {
    if (renderedPages.has(pageNum)) return;
    renderedPages.add(pageNum);

    const page = await pdfDoc.getPage(pageNum);
    const container = stageEl.querySelector(`.pdf-page[data-page="${pageNum}"]`);
    const skeleton = container.querySelector(".page-skel");
    if (skeleton) skeleton.remove();

    const viewportBase = page.getViewport({ scale: 1 });
    const maxWidth = Math.min(window.innerWidth * 0.94, 900);
    const scale = maxWidth / viewportBase.width;
    const viewport = page.getViewport({ scale });

    const renderCanvas = document.createElement("canvas");
    renderCanvas.className = "render-canvas";
    renderCanvas.width = viewport.width;
    renderCanvas.height = viewport.height;
    renderCanvas.style.width = viewport.width + "px";
    renderCanvas.style.height = viewport.height + "px";

    const drawCanvas = document.createElement("canvas");
    drawCanvas.className = "draw-canvas";
    drawCanvas.width = viewport.width;
    drawCanvas.height = viewport.height;
    drawCanvas.style.width = viewport.width + "px";
    drawCanvas.style.height = viewport.height + "px";

    const wrap = document.createElement("div");
    wrap.style.position = "relative";
    wrap.appendChild(renderCanvas);
    wrap.appendChild(drawCanvas);
    container.appendChild(wrap);

    const ctx = renderCanvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    const engine = attachDrawingEngine(drawCanvas, currentFileId, pageNum);
    engine._renderCanvas = engine._renderCanvas || renderCanvas;
    renderCanvas._ref = renderCanvas;
    engines.set(pageNum, { engine, renderCanvas });
  }

  function setupObserver() {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNum = Number(entry.target.dataset.page);
          if (entry.isIntersecting) {
            currentPage = pageNum;
            document.getElementById("pageIndicator").textContent = `${pageNum} / ${numPages}`;
            renderPage(pageNum);
            renderPage(Math.min(pageNum + 1, numPages));
            if (onPageChange) onPageChange(pageNum);
            App.refreshToolbarState();
          }
        }
      },
      { root: stageEl, threshold: 0.5 }
    );
    stageEl.querySelectorAll(".pdf-page").forEach((el) => observer.observe(el));
  }

  async function open(fileId, containerEl, opts = {}) {
    currentFileId = fileId;
    stageEl = containerEl;
    onPageChange = opts.onPageChange || null;
    stageEl.innerHTML = "";
    renderedPages.clear();
    engines.clear();
    currentPage = opts.startPage || 1;

    const loading = document.createElement("div");
    loading.className = "empty-card";
    loading.style.margin = "auto";
    loading.innerHTML = `<p class="handwritten">Opening your sheet…</p>`;
    stageEl.appendChild(loading);

    const url = Drive.fileContentUrl(fileId);
    pdfDoc = await pdfjsLib.getDocument(url).promise;
    numPages = pdfDoc.numPages;
    stageEl.innerHTML = "";

    for (let i = 1; i <= numPages; i++) {
      const page = document.createElement("div");
      page.className = "pdf-page";
      page.dataset.page = String(i);
      page.innerHTML = `<div class="skeleton page-skel" style="width:min(94vw,900px);height:70vh"></div>`;
      stageEl.appendChild(page);
    }
    const startPage = Math.min(Math.max(currentPage, 1), numPages);
    document.getElementById("pageIndicator").textContent = `${startPage} / ${numPages}`;

    setupObserver();
    await renderPage(startPage);
    if (startPage > 1) goTo(startPage, "auto");
  }

  function goTo(pageNum, behavior = "smooth") {
    const target = stageEl.querySelector(`.pdf-page[data-page="${pageNum}"]`);
    if (target) target.scrollIntoView({ behavior, block: "start" });
  }

  function nextPage() { if (currentPage < numPages) goTo(currentPage + 1); }
  function prevPage() { if (currentPage > 1) goTo(currentPage - 1); }

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
    renderedPages.clear();
    engines.clear();
  }

  return {
    open, nextPage, prevPage, destroy, setDrawingEnabled, exportCurrentPage,
    currentEngine, getCurrentPage: () => currentPage, getNumPages: () => numPages,
  };
})();
