// ===== Blank whiteboard (no PDF, just pages to write on) =====
const Whiteboard = (() => {
  const CONTEXT_ID = "whiteboard";
  let stageEl = null;
  let numPages = 1;
  let currentPage = 1;
  let observer = null;
  const engines = new Map();

  function pageCount() {
    const raw = localStorage.getItem("slate_whiteboard_pages");
    return raw ? Number(raw) : 1;
  }
  function savePageCount(n) {
    localStorage.setItem("slate_whiteboard_pages", String(n));
  }

  function buildPageEl(pageNum) {
    const page = document.createElement("div");
    page.className = "pdf-page whiteboard-page";
    page.dataset.page = String(pageNum);

    const width = Math.min(window.innerWidth * 0.94, 900);
    const height = window.innerHeight * 0.8;

    const bg = document.createElement("canvas");
    bg.className = "render-canvas whiteboard-bg";
    bg.width = width; bg.height = height;
    bg.style.width = width + "px"; bg.style.height = height + "px";
    const bgctx = bg.getContext("2d");
    bgctx.fillStyle = "#1E2925";
    bgctx.fillRect(0, 0, width, height);

    const drawCanvas = document.createElement("canvas");
    drawCanvas.className = "draw-canvas";
    drawCanvas.width = width; drawCanvas.height = height;
    drawCanvas.style.width = width + "px"; drawCanvas.style.height = height + "px";

    const wrap = document.createElement("div");
    wrap.style.position = "relative";
    wrap.appendChild(bg);
    wrap.appendChild(drawCanvas);
    page.appendChild(wrap);

    const engine = attachDrawingEngine(drawCanvas, CONTEXT_ID, pageNum);
    engines.set(pageNum, { engine, renderCanvas: bg });
    return page;
  }

  function setupObserver() {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            currentPage = Number(entry.target.dataset.page);
            document.getElementById("pageIndicator").textContent = `${currentPage} / ${numPages}`;
            App.refreshToolbarState();
          }
        }
      },
      { root: stageEl, threshold: 0.5 }
    );
    stageEl.querySelectorAll(".pdf-page").forEach((el) => observer.observe(el));
  }

  function open(containerEl) {
    stageEl = containerEl;
    stageEl.innerHTML = "";
    engines.clear();
    numPages = pageCount();
    currentPage = 1;

    for (let i = 1; i <= numPages; i++) {
      stageEl.appendChild(buildPageEl(i));
    }
    document.getElementById("pageIndicator").textContent = `1 / ${numPages}`;
    setupObserver();
  }

  function addPage() {
    numPages += 1;
    savePageCount(numPages);
    const el = buildPageEl(numPages);
    stageEl.appendChild(el);
    observer.observe(el);
    goTo(numPages);
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
    engines.clear();
  }

  return {
    open, nextPage, prevPage, addPage, destroy, setDrawingEnabled, exportCurrentPage,
    currentEngine, getCurrentPage: () => currentPage, getNumPages: () => numPages,
  };
})();
