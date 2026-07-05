// ════════════════════════════════════════════════
//  Slate Board — app.js  (Edge PDF Viewer style UI)
// ════════════════════════════════════════════════
'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

// ── State ─────────────────────────────────────
const S = {
  view:       'login',
  folderId:   '',
  folderName: '',
  fileId:     null,
  fileName:   '',
  isWhiteboard: false,
  pdfDoc:     null,
  pages:      [],   // [{type:'pdf',pdfPageNum:N} | {type:'blank',id:'...'}]
  drawings:   {},   // pageKey → [strokes]
  mode:       'select',  // 'select' | 'draw'
  tool:       'freehand',
  color:      '#FFFFFF',
  strokeWidth: 4,
  isDrawing:  false,
  activePageKey: null,
  undoStacks: {},
  redoStacks: {},
  offlineQueue: [],
  isOnline:   navigator.onLine,
  currentVisiblePage: 1,
  // Zoom
  zoom: 1.0,
  fitWidth: false,
  // Eraser type: 'pixel' | 'object'
  eraserType: 'pixel',
};

const $  = id => document.getElementById(id);
const EL = {
  loadingOverlay: $('loading-overlay'),
  loginView:      $('login-view'),
  loginForm:      $('login-form'),
  loginError:     $('login-error'),
  pwdInput:       $('pwd-input'),
  pwdEye:         $('pwd-eye'),

  appView:        $('app-view'),
  libHeader:      $('lib-header'),
  logoBtn:        $('logo-btn'),
  breadcrumbs:    $('breadcrumbs'),
  syncBadge:      $('sync-badge'),
  whiteboardBtn:  $('whiteboard-btn'),
  lockBtn:        $('lock-btn'),

  libraryView:    $('library-view'),
  continueSection:$('continue-section'),
  resumeName:     $('resume-name'),
  resumeDetail:   $('resume-detail'),
  resumeBtn:      $('resume-btn'),
  libTitle:       $('lib-title'),
  libGrid:        $('lib-grid'),

  boardView:      $('board-view'),
  pageScrollArea: $('page-scroll-area'),
  pageStack:      $('page-stack'),

  // Toolbar
  pdfToolbar:     $('pdf-toolbar'),
  toolIndicator:  $('tool-indicator'),
  backBtn:        $('back-btn'),
  docTitle:       $('doc-title'),
  btnPrev:        $('btn-prev'),
  btnNext:        $('btn-next'),
  pageInput:      $('page-input'),
  totalPages:     $('total-pages'),
  toolSelectBtn:  $('tool-select'),
  toolDrawBtn:    $('tool-draw'),
  drawTools:      $('draw-tools'),
  strokeSlider:   $('stroke-slider'),
  btnUndo:        $('btn-undo'),
  btnRedo:        $('btn-redo'),
  btnClear:       $('btn-clear'),
  btnAddPage:     $('btn-add-page'),
  btnDeletePage:  $('btn-delete-page'),
  btnFullscreen:  $('btn-fullscreen'),
  // Zoom
  btnZoomIn:      $('btn-zoom-in'),
  btnZoomOut:     $('btn-zoom-out'),
  btnFitWidth:    $('btn-fit-width'),
  zoomLevel:      $('zoom-level'),
  // Erasers
  toolEraserPixel:  $('tool-eraser-pixel'),
  toolEraserObject: $('tool-eraser-object'),
};

// ── Service Worker ────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.warn);
}

// ── Online / Offline ──────────────────────────
window.addEventListener('online',  () => { S.isOnline = true;  updateSync(); flushQueue(); });
window.addEventListener('offline', () => { S.isOnline = false; updateSync(); });

function updateSync() {
  const badge = EL.syncBadge;
  if (S.isOnline) {
    badge.className = 'sync-badge';
    badge.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>Connected</span>';
  } else {
    badge.className = 'sync-badge offline';
    badge.innerHTML = '<i class="fa-solid fa-cloud"></i><span>Offline</span>';
  }
}

// ══════════════════════════════════════════════
//  VIEW HELPERS
// ══════════════════════════════════════════════
function showLoading(v) { EL.loadingOverlay.classList.toggle('hidden', !v); }

function toggle(el, hide) { if (el) el.classList.toggle('hidden', hide); }

function showView(view) {
  S.view = view;
  toggle(EL.loginView,     view !== 'login');
  toggle(EL.appView,       view === 'login');
  toggle(EL.libHeader,     view === 'board');
  toggle(EL.libraryView,   view !== 'library');
  toggle(EL.boardView,     view !== 'board');
}


// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
async function init() {
  showLoading(true);
  try {
    const r = await fetch('/api/auth-check');
    const d = await r.json();
    if (d.authenticated) { showView('library'); await loadLibrary(); }
    else showView('login');
  } catch {
    if (localStorage.getItem('slate_auth') === '1') { showView('library'); await loadLibrary(); }
    else showView('login');
  } finally {
    showLoading(false);
    updateSync();
  }
  try { S.offlineQueue = JSON.parse(localStorage.getItem('slate_queue') || '[]'); } catch {}
}

// ══════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════
EL.pwdEye.addEventListener('click', () => {
  const isText = EL.pwdInput.type === 'text';
  EL.pwdInput.type = isText ? 'password' : 'text';
  EL.pwdEye.innerHTML = isText ? '<i class="fa-regular fa-eye"></i>' : '<i class="fa-regular fa-eye-slash"></i>';
});

EL.loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  EL.loginError.classList.add('hidden');
  showLoading(true);
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: EL.pwdInput.value })
    });
    const d = await r.json();
    if (d.success) {
      localStorage.setItem('slate_auth', '1');
      showView('library');
      EL.pwdInput.value = '';
      await loadLibrary();
    } else {
      EL.loginError.classList.remove('hidden');
    }
  } catch { EL.loginError.classList.remove('hidden'); }
  finally { showLoading(false); }
});

async function logout() {
  showLoading(true);
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('slate_auth');
  showView('login');
  showLoading(false);
}

EL.lockBtn.addEventListener('click', logout);

// ══════════════════════════════════════════════
//  LIBRARY
// ══════════════════════════════════════════════
async function loadLibrary() {
  renderBreadcrumbs();
  renderContinueCard();
  const isRoot = S.folderId === '';
  EL.libTitle.textContent = isRoot ? 'Subjects' : S.folderName;
  showLoading(true);
  try {
    const url = isRoot ? '/api/subjects' : `/api/subjects/${S.folderId}/files`;
    const r = await fetch(url);
    if (r.status === 401) { logout(); return; }
    const items = await r.json();
    renderGrid(items, isRoot);
  } catch {
    EL.libGrid.innerHTML = '<p style="color:#9F9F9F;padding:1rem">Could not load. Check connection.</p>';
  } finally { showLoading(false); }
}

function renderContinueCard() {
  try {
    const sess = JSON.parse(localStorage.getItem('slate_session') || 'null');
    if (!sess) { EL.continueSection.classList.add('hidden'); return; }
    EL.resumeName.textContent   = sess.fileName || '—';
    EL.resumeDetail.textContent = sess.folderName || '—';
    EL.continueSection.classList.remove('hidden');
    EL.resumeBtn.onclick = () => openDocument(sess.fileId, sess.fileName, sess.folderId, sess.folderName);
  } catch { EL.continueSection.classList.add('hidden'); }
}

function renderGrid(items, isRoot) {
  EL.libGrid.innerHTML = '';
  if (!items || items.length === 0) {
    EL.libGrid.innerHTML = '<p style="color:#9F9F9F">No items found.</p>';
    return;
  }
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = `lib-card ${isRoot ? 'folder' : 'file'}`;
    card.innerHTML = `
      <i class="fa-solid ${isRoot ? 'fa-folder' : 'fa-file-pdf'}"></i>
      <span>${item.name.replace(/\.pdf$/i, '')}</span>
    `;
    card.addEventListener('click', () => {
      if (isRoot) { S.folderId = item.id; S.folderName = item.name; loadLibrary(); }
      else openDocument(item.id, item.name, S.folderId, S.folderName);
    });
    EL.libGrid.appendChild(card);
  });
}

function renderBreadcrumbs() {
  EL.breadcrumbs.innerHTML = '';
  const root = document.createElement('a');
  root.textContent = 'Home';
  root.addEventListener('click', () => { S.folderId = ''; S.folderName = ''; loadLibrary(); });
  EL.breadcrumbs.appendChild(root);
  if (S.folderId) {
    const sep = document.createElement('span'); sep.className = 'sep'; sep.innerHTML = ' › ';
    const cur = document.createElement('span'); cur.className = 'cur'; cur.textContent = S.folderName;
    EL.breadcrumbs.appendChild(sep);
    EL.breadcrumbs.appendChild(cur);
  }
}

EL.logoBtn.addEventListener('click', () => {
  S.folderId = ''; S.folderName = '';
  showView('library'); loadLibrary();
});

// ══════════════════════════════════════════════
//  OPEN BOARD
// ══════════════════════════════════════════════
EL.whiteboardBtn.addEventListener('click', () => {
  S.isWhiteboard = true; S.fileId = '__whiteboard__'; S.fileName = 'Whiteboard';
  openBoard();
});

async function openDocument(fileId, fileName, folderId, folderName) {
  S.isWhiteboard = false; S.fileId = fileId; S.fileName = fileName;
  S.folderId = folderId; S.folderName = folderName;
  openBoard();
}

async function openBoard() {
  showView('board');
  showLoading(true);
  EL.pageStack.innerHTML = '';
  EL.docTitle.textContent = S.fileName.replace(/\.pdf$/i, '');

  // Reset zoom
  S.zoom = 1.0;
  S.fitWidth = false;
  applyZoom();

  // Load saved annotations
  S.drawings = {}; S.pages = []; S.undoStacks = {}; S.redoStacks = {};
  try {
    const r = await fetch(`/api/annotations?fileId=${encodeURIComponent(S.fileId)}`);
    if (r.ok) { const d = await r.json(); S.drawings = d.drawings || {}; S.pages = d.pages || []; }
  } catch {
    try {
      const cached = JSON.parse(localStorage.getItem(`slate_ann_${S.fileId}`) || 'null');
      if (cached) { S.drawings = cached.drawings || {}; S.pages = cached.pages || []; }
    } catch {}
  }

  // Load PDF
  if (!S.isWhiteboard) {
    try {
      S.pdfDoc = await pdfjsLib.getDocument({
        url: `/api/files/${encodeURIComponent(S.fileId)}`,
        withCredentials: true,
        disableRange: true,
        disableAutoFetch: true,
      }).promise;
      if (!S.pages.length) {
        S.pages = [];
        for (let i = 1; i <= S.pdfDoc.numPages; i++) S.pages.push({ type: 'pdf', pdfPageNum: i });
      }
    } catch (err) {
      console.error('PDF load error', err);
      alert('Could not load PDF: ' + err.message);
      showView('library'); showLoading(false); return;
    }
  } else {
    S.pdfDoc = null;
    if (!S.pages.length) S.pages = [{ type: 'blank', id: `blank_${Date.now()}` }];
  }

  // Save session
  if (S.fileId !== '__whiteboard__') {
    localStorage.setItem('slate_session', JSON.stringify({
      fileId: S.fileId, fileName: S.fileName, folderId: S.folderId, folderName: S.folderName
    }));
  }

  EL.totalPages.textContent = S.pages.length;
  EL.pageInput.max = S.pages.length;
  EL.pageInput.value = 1;
  S.currentVisiblePage = 1;

  await renderAllPages();
  showLoading(false);
}

// ══════════════════════════════════════════════
//  ZOOM
// ══════════════════════════════════════════════
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3.0;

function applyZoom() {
  EL.boardView.classList.toggle('fit-width-active', S.fitWidth);
  
  if (S.fitWidth) {
    const scrollAreaW = EL.pageScrollArea.clientWidth;
    const stackW = EL.pageStack.clientWidth || 900;
    S.zoom = scrollAreaW / stackW;
  }

  EL.pageStack.style.transform = `scale(${S.zoom})`;
  EL.pageStack.style.transformOrigin = 'top center';
  // Adjust the scroll area height so scrolling works correctly
  // We need to set the page-stack's margin to account for scale shrinkage/growth
  const stackH = EL.pageStack.scrollHeight;
  const scaled = stackH * S.zoom;
  // Use margin-bottom trick for scaling
  EL.pageStack.style.marginBottom = `${(scaled - stackH)}px`;
  EL.zoomLevel.textContent = Math.round(S.zoom * 100) + '%';
  // Update fit-width button active state
  EL.btnFitWidth.classList.toggle('active', S.fitWidth);
}

function zoomIn() {
  S.fitWidth = false;
  const next = ZOOM_STEPS.find(z => z > S.zoom + 0.001);
  S.zoom = next !== undefined ? next : ZOOM_MAX;
  applyZoom();
}

function zoomOut() {
  S.fitWidth = false;
  const prev = [...ZOOM_STEPS].reverse().find(z => z < S.zoom - 0.001);
  S.zoom = prev !== undefined ? prev : ZOOM_MIN;
  applyZoom();
}

function fitToWidth() {
  S.fitWidth = !S.fitWidth;
  applyZoom();
}

EL.btnZoomIn.addEventListener('click', zoomIn);
EL.btnZoomOut.addEventListener('click', zoomOut);
EL.btnFitWidth.addEventListener('click', fitToWidth);

// Mouse wheel zoom (Ctrl+scroll)
EL.pageScrollArea.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  if (e.deltaY < 0) zoomIn(); else zoomOut();
}, { passive: false });


// ══════════════════════════════════════════════
//  PAGE RENDERING
// ══════════════════════════════════════════════
async function renderAllPages() {
  EL.pageStack.innerHTML = '';

  for (let i = 0; i < S.pages.length; i++) {
    if (i > 0) EL.pageStack.appendChild(makeInsertBtn(i));
    EL.pageStack.appendChild(await buildPageEl(i));
  }
  EL.pageStack.appendChild(makeInsertBtn(S.pages.length));

  requestAnimationFrame(() => syncAllDrawCanvases());
  setupScrollPageTracking();
  // Reapply zoom after render
  applyZoom();
}

function makeInsertBtn(idx) {
  const row = document.createElement('div');
  row.className = 'insert-btn-row';
  row.title = 'Insert blank page here';
  row.dataset.index = idx;
  return row;
}

// Delegate page insertion clicks
EL.pageStack.addEventListener('click', e => {
  const btn = e.target.closest('.insert-btn-row');
  if (btn) {
    const idx = parseInt(btn.dataset.index, 10);
    if (!isNaN(idx)) insertBlankPage(idx);
  }
});

async function buildPageEl(pageIndex) {
  const page    = S.pages[pageIndex];
  const pageKey = getPageKey(pageIndex);
  // Normalize: legacy data may store page as a string (the key itself)
  const pageType = (typeof page === 'object' && page !== null) ? page.type : 'blank';
  const wrapper = document.createElement('div');
  wrapper.className = pageType === 'blank' ? 'page-wrapper blank-page' : 'page-wrapper';
  wrapper.dataset.pageIndex = pageIndex;
  wrapper.dataset.pageKey   = pageKey;
  wrapper.dataset.pageNum   = pageIndex + 1;

  const pdfCanvas  = document.createElement('canvas'); pdfCanvas.className = 'page-pdf-canvas';
  const hlCanvas   = document.createElement('canvas'); hlCanvas.className = 'page-highlight-canvas';
  const drawCanvas = document.createElement('canvas'); drawCanvas.className = 'page-draw-canvas';

  wrapper.appendChild(pdfCanvas);
  wrapper.appendChild(hlCanvas);
  wrapper.appendChild(drawCanvas);

  if (pageType === 'pdf' && S.pdfDoc) {
    await renderPdfPage(page.pdfPageNum, pdfCanvas, drawCanvas);
  } else {
    const w = EL.pageStack.clientWidth || 900;
    const h = Math.round(w * 595 / 842);
    pdfCanvas.width = w; pdfCanvas.height = h;
    pdfCanvas.style.width = '100%'; pdfCanvas.style.height = h + 'px';
    const ctx = pdfCanvas.getContext('2d');
    ctx.fillStyle = '#1E1E1E'; ctx.fillRect(0, 0, w, h);
    // subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    for (let x = 40; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for (let y = 40; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  }

  syncDrawCanvas(pdfCanvas, drawCanvas);
  syncDrawCanvas(pdfCanvas, hlCanvas);
  replayDrawings(pageKey, drawCanvas, hlCanvas);
  attachDrawEvents(drawCanvas, pageKey);
  return wrapper;
}

async function renderPdfPage(pdfPageNum, pdfCanvas, drawCanvas) {
  const page   = await S.pdfDoc.getPage(pdfPageNum);
  const contW  = EL.pageStack.clientWidth || window.innerWidth - 32;
  const vp1    = page.getViewport({ scale: 1 });
  const scale  = contW / vp1.width;
  const vp     = page.getViewport({ scale });
  const dpr    = window.devicePixelRatio || 1;
  pdfCanvas.width  = Math.floor(vp.width  * dpr);
  pdfCanvas.height = Math.floor(vp.height * dpr);
  pdfCanvas.style.width  = vp.width  + 'px';
  pdfCanvas.style.height = vp.height + 'px';
  const ctx = pdfCanvas.getContext('2d');
  ctx.scale(dpr, dpr);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
}

function syncDrawCanvas(pdfC, drawC) {
  drawC.width  = pdfC.width;  drawC.height = pdfC.height;
  drawC.style.width  = pdfC.style.width;
  drawC.style.height = pdfC.style.height;
}

function syncAllDrawCanvases() {
  document.querySelectorAll('.page-wrapper').forEach(w => {
    const pdfC  = w.querySelector('.page-pdf-canvas');
    const drawC = w.querySelector('.page-draw-canvas');
    const hlC   = w.querySelector('.page-highlight-canvas');
    if (!pdfC) return;
    if (drawC) syncDrawCanvas(pdfC, drawC);
    if (hlC)   syncDrawCanvas(pdfC, hlC);
    if (drawC) replayDrawings(w.dataset.pageKey, drawC, hlC);
  });
}

function getPageKey(idx) {
  const p = S.pages[idx];
  if (!p) return `page_${idx}`;
  // Legacy: page entry stored as a plain string key
  if (typeof p === 'string') return p;
  if (p.type === 'pdf') return `pdf_${p.pdfPageNum}`;
  // Blank page — assign id if missing
  try {
    if (!p.id) p.id = `blank_${Date.now()}_${idx}`;
  } catch { return `blank_${idx}`; }
  return p.id;
}

async function insertBlankPage(atIndex) {
  const newPage = { type: 'blank', id: `blank_${Date.now()}` };
  S.pages.splice(atIndex, 0, newPage);
  
  EL.totalPages.textContent = S.pages.length;
  EL.pageInput.max = S.pages.length;

  const wrapper = await buildPageEl(atIndex);
  const newInsertBtn = makeInsertBtn(atIndex);

  // Insert elements directly into the page-stack DOM
  const targetElement = EL.pageStack.querySelector(`.page-wrapper[data-page-index="${atIndex}"]`);
  if (targetElement) {
    EL.pageStack.insertBefore(wrapper, targetElement);
    EL.pageStack.insertBefore(newInsertBtn, targetElement);
  } else {
    // Appending at the end
    const lastInsertBtn = EL.pageStack.lastElementChild;
    if (lastInsertBtn) {
      EL.pageStack.insertBefore(wrapper, lastInsertBtn);
      const endInsertBtn = makeInsertBtn(S.pages.length);
      EL.pageStack.appendChild(endInsertBtn);
    }
  }

  updateDOMIndices();

  // Sync canvases for the new page wrapper specifically
  const newPdfCanvas  = wrapper.querySelector('.page-pdf-canvas');
  const newDrawCanvas = wrapper.querySelector('.page-draw-canvas');
  const newHlCanvas   = wrapper.querySelector('.page-highlight-canvas');
  if (newPdfCanvas && newDrawCanvas) syncDrawCanvas(newPdfCanvas, newDrawCanvas);
  if (newPdfCanvas && newHlCanvas)   syncDrawCanvas(newPdfCanvas, newHlCanvas);

  saveAnnotations();

  // Smoothly scroll to the new page
  scrollToPage(atIndex + 1);
}

function updateDOMIndices() {
  const wrappers = EL.pageStack.querySelectorAll('.page-wrapper');
  wrappers.forEach((w, idx) => {
    w.dataset.pageIndex = idx;
    w.dataset.pageNum   = idx + 1;
  });

  const btns = EL.pageStack.querySelectorAll('.insert-btn-row');
  btns.forEach((btn, idx) => {
    btn.dataset.index = idx + 1;
  });
}

// ── Page scroll tracking → update page indicator ──────────
function setupScrollPageTracking() {
  EL.pageScrollArea.removeEventListener('scroll', updateVisiblePageOnScroll);
  EL.pageScrollArea.addEventListener('scroll', updateVisiblePageOnScroll);
  // initial check
  updateVisiblePageOnScroll();
}

function updateVisiblePageOnScroll() {
  const wrappers = document.querySelectorAll('.page-wrapper');
  if (!wrappers.length) return;

  const scrollRect = EL.pageScrollArea.getBoundingClientRect();
  const scrollCenter = scrollRect.top + scrollRect.height / 2;

  let visiblePageNum = 1;
  let visiblePageKey = wrappers[0].dataset.pageKey;

  for (const w of wrappers) {
    const rect = w.getBoundingClientRect();
    if (rect.top <= scrollCenter && rect.bottom >= scrollCenter) {
      visiblePageNum = parseInt(w.dataset.pageNum, 10);
      visiblePageKey = w.dataset.pageKey;
      break;
    }
  }

  // Fallbacks for top/bottom boundaries
  if (EL.pageScrollArea.scrollTop === 0) {
    visiblePageNum = 1;
    visiblePageKey = wrappers[0].dataset.pageKey;
  } else if (EL.pageScrollArea.scrollHeight - EL.pageScrollArea.scrollTop - EL.pageScrollArea.clientHeight < 10) {
    const lastW = wrappers[wrappers.length - 1];
    visiblePageNum = parseInt(lastW.dataset.pageNum, 10);
    visiblePageKey = lastW.dataset.pageKey;
  }

  if (visiblePageNum && visiblePageNum !== S.currentVisiblePage) {
    S.currentVisiblePage = visiblePageNum;
    EL.pageInput.value = visiblePageNum;
    S.activePageKey = visiblePageKey;
  }
}

// ══════════════════════════════════════════════
//  DRAWING ENGINE
// ══════════════════════════════════════════════
function attachDrawEvents(canvas, pageKey) {
  canvas.addEventListener('pointerdown', e => startDraw(e, canvas, pageKey));
  canvas.addEventListener('pointermove', e => moveDraw(e, canvas, pageKey));
  canvas.addEventListener('pointerup',   e => endDraw(e, canvas, pageKey));
  canvas.addEventListener('pointercancel', () => { S.isDrawing = false; S.currentStroke = null; });
}

function coords(e, canvas) {
  const r = canvas.getBoundingClientRect();
  // Account for CSS zoom transform on the page-stack
  const zoom = S.zoom || 1;
  return {
    x: (e.clientX - r.left) * (canvas.width  / r.width),
    y: (e.clientY - r.top)  * (canvas.height / r.height),
    pressure: e.pressure || 0.5,
  };
}

function startDraw(e, canvas, pageKey) {
  if (S.mode !== 'draw') return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  S.isDrawing = true; S.activePageKey = pageKey;
  const { x, y, pressure } = coords(e, canvas);
  if (!S.undoStacks[pageKey]) S.undoStacks[pageKey] = [];
  if (!S.redoStacks[pageKey]) S.redoStacks[pageKey] = [];
  S.undoStacks[pageKey].push(JSON.parse(JSON.stringify(S.drawings[pageKey] || [])));
  S.redoStacks[pageKey] = [];
  if (!S.drawings[pageKey]) S.drawings[pageKey] = [];

  if (S.tool === 'object-eraser') {
    // Object eraser: immediately check for strokes to remove
    eraseObjectAt(x, y, canvas, pageKey);
    return;
  }

  const isErase = S.tool === 'eraser';
  const isFreehandLike = S.tool === 'freehand' || S.tool === 'marker' || S.tool === 'highlight' || isErase;

  let opacity = 1;
  if (S.tool === 'marker') opacity = 0.38;
  if (S.tool === 'highlight') opacity = 0.35;

  S.currentStroke = isFreehandLike
    ? { type: S.tool, color: isErase ? 'eraser' : S.color, width: S.strokeWidth, opacity, points: [{ x, y, pressure }] }
    : { type: S.tool, color: S.color, width: S.strokeWidth, opacity: 1, start: { x, y }, end: { x, y } };
}

function moveDraw(e, canvas, pageKey) {
  if (!S.isDrawing || S.tool === 'object-eraser') return;
  if (!S.currentStroke) return;
  e.preventDefault();
  const { x, y, pressure } = coords(e, canvas);
  const wrapper = canvas.closest('.page-wrapper');
  const hlCanvas = wrapper ? wrapper.querySelector('.page-highlight-canvas') : null;
  const isHighlight = S.currentStroke.type === 'highlight' || S.currentStroke.type === 'marker';
  const activeCanvas = (isHighlight && hlCanvas) ? hlCanvas : canvas;
  const ctx = activeCanvas.getContext('2d');
  const t = S.currentStroke.type;
  if (t === 'freehand' || t === 'marker' || t === 'highlight' || t === 'eraser') {
    const pts = S.currentStroke.points, last = pts[pts.length - 1];
    if (Math.hypot(x - last.x, y - last.y) > 1.5) {
      pts.push({ x, y, pressure });
      if (t === 'eraser') {
        drawSeg(canvas.getContext('2d'), last, { x, y, pressure }, S.currentStroke);
        if (hlCanvas) drawSeg(hlCanvas.getContext('2d'), last, { x, y, pressure }, S.currentStroke);
      } else {
        drawSeg(ctx, last, { x, y, pressure }, S.currentStroke);
      }
    }
  } else {
    S.currentStroke.end = { x, y };
    replayDrawings(pageKey, canvas, hlCanvas);
    drawStroke(ctx, S.currentStroke);
  }
}

function endDraw(e, canvas, pageKey) {
  if (!S.isDrawing) return;
  S.isDrawing = false; canvas.releasePointerCapture(e.pointerId);

  if (S.tool === 'object-eraser') return; // object eraser acts on pointerdown/move

  if (!S.currentStroke) return;
  if (!S.drawings[pageKey]) S.drawings[pageKey] = [];
  S.drawings[pageKey].push(S.currentStroke); S.currentStroke = null;
  const wrapper = canvas.closest('.page-wrapper');
  const hlCanvas = wrapper ? wrapper.querySelector('.page-highlight-canvas') : null;
  replayDrawings(pageKey, canvas, hlCanvas);
  saveAnnotations();
}

// ── Object Eraser ─────────────────────────────
function eraseObjectAt(x, y, canvas, pageKey) {
  if (!S.drawings[pageKey]) return;
  const HIT_RADIUS = Math.max(S.strokeWidth * 2, 18);
  const before = S.drawings[pageKey].length;
  S.drawings[pageKey] = S.drawings[pageKey].filter(stroke => !strokeHitsPoint(stroke, x, y, HIT_RADIUS));
  if (S.drawings[pageKey].length !== before) {
    const wrapper = canvas.closest('.page-wrapper');
    const hlCanvas = wrapper ? wrapper.querySelector('.page-highlight-canvas') : null;
    replayDrawings(pageKey, canvas, hlCanvas);
    saveAnnotations();
  }
}

function strokeHitsPoint(stroke, px, py, radius) {
  if (stroke.type === 'freehand' || stroke.type === 'marker' || stroke.type === 'highlight' || stroke.type === 'eraser') {
    const pts = stroke.points || [];
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i].x - px, pts[i].y - py) <= radius + stroke.width / 2) return true;
      if (i > 0) {
        // check segment
        if (pointNearSegment(px, py, pts[i-1].x, pts[i-1].y, pts[i].x, pts[i].y, radius + stroke.width / 2)) return true;
      }
    }
  } else if (stroke.type === 'line' || stroke.type === 'arrow') {
    return pointNearSegment(px, py, stroke.start.x, stroke.start.y, stroke.end.x, stroke.end.y, radius + stroke.width / 2);
  } else if (stroke.type === 'rect') {
    const x1 = Math.min(stroke.start.x, stroke.end.x), x2 = Math.max(stroke.start.x, stroke.end.x);
    const y1 = Math.min(stroke.start.y, stroke.end.y), y2 = Math.max(stroke.start.y, stroke.end.y);
    return px >= x1 - radius && px <= x2 + radius && py >= y1 - radius && py <= y2 + radius;
  } else if (stroke.type === 'ellipse') {
    const cx = (stroke.start.x + stroke.end.x) / 2, cy = (stroke.start.y + stroke.end.y) / 2;
    const rx = Math.abs(stroke.end.x - stroke.start.x) / 2, ry = Math.abs(stroke.end.y - stroke.start.y) / 2;
    const dx = (px - cx) / (rx + radius), dy = (py - cy) / (ry + radius);
    return dx*dx + dy*dy <= 1;
  }
  return false;
}

function pointNearSegment(px, py, ax, ay, bx, by, radius) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay) <= radius;
  const t = Math.max(0, Math.min(1, ((px - ax)*dx + (py - ay)*dy) / lenSq));
  const nx = ax + t*dx, ny = ay + t*dy;
  return Math.hypot(px - nx, py - ny) <= radius;
}

function drawSeg(ctx, p1, p2, stroke) {
  ctx.save();
  if (stroke.type === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; }
  else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = stroke.color; ctx.globalAlpha = stroke.opacity; }
  let lw = stroke.width;
  if (stroke.type === 'eraser') lw = stroke.width * 3;
  else if (stroke.type === 'highlight' || stroke.type === 'marker') lw = stroke.width * 4;
  else lw = stroke.width * (0.5 + (p1.pressure || .5) * 1.2);
  ctx.lineWidth = lw;
  ctx.lineCap = (stroke.type === 'highlight' || stroke.type === 'marker') ? 'square' : 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  ctx.restore();
}

function replayDrawings(pageKey, canvas, highlightCanvas) {
  if (!highlightCanvas) {
    const wrapper = canvas.closest('.page-wrapper');
    highlightCanvas = wrapper ? wrapper.querySelector('.page-highlight-canvas') : null;
  }
  const drawCtx = canvas.getContext('2d');
  drawCtx.clearRect(0, 0, canvas.width, canvas.height);
  let hlCtx = null;
  if (highlightCanvas) {
    hlCtx = highlightCanvas.getContext('2d');
    hlCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);
  }
  const strokes = S.drawings[pageKey] || [];
  strokes.forEach(s => {
    if (s.type === 'highlight' || s.type === 'marker') {
      if (hlCtx) drawStroke(hlCtx, s);
      else drawStroke(drawCtx, s);
    } else if (s.type === 'eraser') {
      drawStroke(drawCtx, s);
      if (hlCtx) drawStroke(hlCtx, s);
    } else {
      drawStroke(drawCtx, s);
    }
  });
}

function drawStroke(ctx, s) {
  ctx.save();
  ctx.globalAlpha = s.opacity || 1;
  if (s.type === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = ctx.fillStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = ctx.fillStyle = s.color;
  }
  ctx.lineWidth = s.width;
  ctx.lineCap = (s.type === 'highlight' || s.type === 'marker') ? 'square' : 'round';
  ctx.lineJoin = 'round';

  if (s.type === 'freehand' || s.type === 'marker' || s.type === 'highlight' || s.type === 'eraser') {
    const pts = s.points || [];
    if (pts.length === 0) { ctx.restore(); return; }
    if (pts.length === 1) {
      const lw = s.type === 'highlight' ? s.width * 4 : s.type === 'eraser' ? s.width * 3 : s.width;
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, lw/2, 0, Math.PI*2); ctx.fill();
    } else {
      for (let i = 0; i < pts.length-1; i++) {
        const p = pts[i], n = pts[i+1];
        let lw;
        if (s.type === 'eraser') lw = s.width * 3;
        else if (s.type === 'highlight') lw = s.width * 4;
        else lw = s.width * (0.5 + (p.pressure || .5) * 1.2);
        ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(n.x, n.y); ctx.stroke();
      }
    }
  } else if (s.type === 'line') {
    ctx.beginPath(); ctx.moveTo(s.start.x,s.start.y); ctx.lineTo(s.end.x,s.end.y); ctx.stroke();
  } else if (s.type === 'rect') {
    const x=Math.min(s.start.x,s.end.x),y=Math.min(s.start.y,s.end.y),w=Math.abs(s.end.x-s.start.x),h=Math.abs(s.end.y-s.start.y);
    ctx.beginPath(); ctx.rect(x,y,w,h); ctx.stroke();
  } else if (s.type === 'ellipse') {
    const cx=(s.start.x+s.end.x)/2,cy=(s.start.y+s.end.y)/2,rx=Math.abs(s.end.x-s.start.x)/2,ry=Math.abs(s.end.y-s.start.y)/2;
    ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); ctx.stroke();
  } else if (s.type === 'arrow') {
    const {x:x1,y:y1}=s.start,{x:x2,y:y2}=s.end,a=Math.atan2(y2-y1,x2-x1),hl=Math.max(s.width*4,14);
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2,y2); ctx.lineTo(x2-hl*Math.cos(a-Math.PI/6),y2-hl*Math.sin(a-Math.PI/6)); ctx.lineTo(x2-hl*Math.cos(a+Math.PI/6),y2-hl*Math.sin(a+Math.PI/6)); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// Object eraser also responds to move (hold and drag)
document.querySelectorAll('.page-draw-canvas').forEach(canvas => {
  canvas.addEventListener('pointermove', e => {
    if (!S.isDrawing || S.tool !== 'object-eraser') return;
    const pageKey = canvas.closest('.page-wrapper')?.dataset.pageKey;
    if (!pageKey) return;
    const { x, y } = coords(e, canvas);
    eraseObjectAt(x, y, canvas, pageKey);
  });
});

// ══════════════════════════════════════════════
//  TOOLBAR EVENTS
// ══════════════════════════════════════════════

// Mode buttons
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.mode = btn.dataset.mode;
    const inDraw = S.mode === 'draw';
    EL.toolIndicator.classList.toggle('in-draw', inDraw);
    document.querySelectorAll('.page-draw-canvas').forEach(c => c.classList.toggle('pan-mode', !inDraw));
  });
});

// Tool buttons
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active', 'tool-active'));
    btn.classList.add('active', 'tool-active');
    S.tool = tool;

    // Update canvas cursors for object eraser
    document.querySelectorAll('.page-draw-canvas').forEach(c => {
      c.classList.toggle('object-eraser-mode', tool === 'object-eraser');
    });

    // auto-switch to draw mode
    if (S.mode !== 'draw') {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      EL.toolDrawBtn.classList.add('active');
      S.mode = 'draw';
      EL.toolIndicator.classList.add('in-draw');
      document.querySelectorAll('.page-draw-canvas').forEach(c => c.classList.remove('pan-mode'));
    }
  });
});

// Colors
document.querySelectorAll('.color-btn').forEach(sw => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(s => s.classList.remove('active'));
    sw.classList.add('active'); S.color = sw.dataset.color;
    if (S.tool === 'eraser' || S.tool === 'object-eraser') {
      S.tool = 'freehand';
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active','tool-active'));
      const fb = document.querySelector('.tool-btn[data-tool="freehand"]');
      if (fb) fb.classList.add('active','tool-active');
    }
    if (S.mode !== 'draw') EL.toolDrawBtn.click();
  });
});

// Stroke slider
EL.strokeSlider.addEventListener('input', e => { S.strokeWidth = parseInt(e.target.value); });

// Undo
EL.btnUndo.addEventListener('click', () => {
  const key = S.activePageKey; if (!key || !S.undoStacks[key]?.length) return;
  if (!S.redoStacks[key]) S.redoStacks[key] = [];
  S.redoStacks[key].push(JSON.parse(JSON.stringify(S.drawings[key] || [])));
  S.drawings[key] = S.undoStacks[key].pop();
  redrawPage(key); saveAnnotations();
});

// Redo
EL.btnRedo.addEventListener('click', () => {
  const key = S.activePageKey; if (!key || !S.redoStacks[key]?.length) return;
  if (!S.undoStacks[key]) S.undoStacks[key] = [];
  S.undoStacks[key].push(JSON.parse(JSON.stringify(S.drawings[key] || [])));
  S.drawings[key] = S.redoStacks[key].pop();
  redrawPage(key); saveAnnotations();
});

// Clear
EL.btnClear.addEventListener('click', () => {
  const key = S.activePageKey;
  if (!key || !S.drawings[key]?.length) return;
  if (!confirm('Clear all drawings on this page?')) return;
  if (!S.undoStacks[key]) S.undoStacks[key] = [];
  S.undoStacks[key].push(JSON.parse(JSON.stringify(S.drawings[key])));
  if (!S.redoStacks[key]) S.redoStacks[key] = [];
  S.redoStacks[key] = [];
  S.drawings[key] = [];
  redrawPage(key); saveAnnotations();
});

function redrawPage(pageKey) {
  const w = document.querySelector(`.page-wrapper[data-page-key="${pageKey}"]`);
  if (!w) return;
  const drawC = w.querySelector('.page-draw-canvas');
  const hlC   = w.querySelector('.page-highlight-canvas');
  if (drawC) replayDrawings(pageKey, drawC, hlC);
}

// Add blank page
EL.btnAddPage.addEventListener('click', () => insertBlankPage(S.currentVisiblePage));

// Delete page
EL.btnDeletePage.addEventListener('click', () => {
  if (S.pages.length <= 1) {
    alert('Cannot delete the last remaining page.');
    return;
  }
  const pageNum = S.currentVisiblePage;
  if (!confirm(`Are you sure you want to delete Page ${pageNum}?`)) return;

  const pageIndex = pageNum - 1;
  S.pages.splice(pageIndex, 1);
  
  EL.totalPages.textContent = S.pages.length;
  EL.pageInput.max = S.pages.length;

  const wrapper = EL.pageStack.querySelector(`.page-wrapper[data-page-index="${pageIndex}"]`);
  if (wrapper) {
    const btnIndexToRemove = pageIndex > 0 ? pageIndex : 1;
    const insertBtn = EL.pageStack.querySelector(`.insert-btn-row[data-index="${btnIndexToRemove}"]`);
    
    wrapper.remove();
    if (insertBtn) insertBtn.remove();
  }

  updateDOMIndices();
  saveAnnotations();

  // Scroll to correct adjacent page smoothly
  scrollToPage(Math.min(pageNum, S.pages.length));
});

// Navigate pages (scroll-to)
EL.btnPrev.addEventListener('click', () => scrollToPage(S.currentVisiblePage - 1));
EL.btnNext.addEventListener('click', () => scrollToPage(S.currentVisiblePage + 1));

EL.pageInput.addEventListener('change', () => {
  const n = parseInt(EL.pageInput.value, 10);
  if (!isNaN(n)) scrollToPage(n);
});

function scrollToPage(num, behavior = 'smooth') {
  const n = Math.max(1, Math.min(num, S.pages.length));
  EL.pageInput.value = n;
  const wrapper = document.querySelector(`.page-wrapper[data-page-num="${n}"]`);
  if (wrapper) wrapper.scrollIntoView({ behavior, block: 'start' });
}

// Back
EL.backBtn.addEventListener('click', () => { showView('library'); loadLibrary(); });

// Fullscreen
EL.btnFullscreen.addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
  const isFs = document.body.classList.toggle('fullscreen');
  EL.btnFullscreen.innerHTML = isFs ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
  try { isFs ? document.documentElement.requestFullscreen?.() : document.exitFullscreen?.(); } catch {}
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('fullscreen')) {
    document.body.classList.remove('fullscreen');
    EL.btnFullscreen.innerHTML = '<i class="fa-solid fa-expand"></i>';
  }
});

// Track active page on pointerdown
EL.pageScrollArea.addEventListener('pointerdown', e => {
  const w = e.target.closest('.page-wrapper');
  if (w) { S.activePageKey = w.dataset.pageKey; }
}, true);

// Keyboard
document.addEventListener('keydown', e => {
  if (S.view !== 'board') return;
  if (e.target.tagName === 'INPUT') return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); EL.btnUndo.click(); }
  if ((e.ctrlKey || e.metaKey) &&  e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); EL.btnRedo.click(); }
  if (e.key === 'f' && !e.ctrlKey) toggleFullscreen();
  if (e.key === 'Escape' && document.body.classList.contains('fullscreen')) toggleFullscreen();
  if (e.key === 'd' && !e.ctrlKey) EL.toolDrawBtn.click();
  if (e.key === 'v' && !e.ctrlKey) EL.toolSelectBtn.click();
  if (e.key === 'ArrowDown') { e.preventDefault(); scrollToPage(S.currentVisiblePage + 1); }
  if (e.key === 'ArrowUp')   { e.preventDefault(); scrollToPage(S.currentVisiblePage - 1); }
  // Zoom shortcuts
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomOut(); }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); S.fitWidth = false; S.zoom = 1.0; applyZoom(); }
  // Tool shortcuts
  if (e.key.toLowerCase() === 'p' && !e.ctrlKey) {
    const penBtn = document.querySelector('.tool-btn[data-tool="freehand"]');
    if (penBtn) penBtn.click();
  }
  if (e.key.toLowerCase() === 'e' && !e.ctrlKey) {
    if (EL.toolEraserPixel) EL.toolEraserPixel.click();
  }
  if (e.key.toLowerCase() === 'o' && !e.ctrlKey) {
    if (EL.toolEraserObject) EL.toolEraserObject.click();
  }
});

// Resize: adjust zoom and align page instantly
let _rt;
window.addEventListener('resize', () => {
  clearTimeout(_rt);
  _rt = setTimeout(() => {
    if (S.view === 'board') {
      applyZoom();
      scrollToPage(S.currentVisiblePage, 'auto');
    }
  }, 50);
});

// ══════════════════════════════════════════════
//  SAVE / SYNC
// ══════════════════════════════════════════════
async function saveAnnotations() {
  const payload = { fileId: S.fileId, pages: S.pages, drawings: S.drawings };
  localStorage.setItem(`slate_ann_${S.fileId}`, JSON.stringify({ pages: S.pages, drawings: S.drawings }));
  if (S.isOnline) {
    try {
      const r = await fetch('/api/annotations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error();
    } catch { enqueue(payload); }
  } else enqueue(payload);
}

function enqueue(p) {
  S.offlineQueue = S.offlineQueue.filter(q => q.fileId !== p.fileId);
  S.offlineQueue.push(p);
  localStorage.setItem('slate_queue', JSON.stringify(S.offlineQueue));
}

async function flushQueue() {
  const q = [...S.offlineQueue]; const rem = [];
  for (const p of q) {
    try { const r = await fetch('/api/annotations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }); if (!r.ok) throw new Error(); }
    catch { rem.push(p); }
  }
  S.offlineQueue = rem; localStorage.setItem('slate_queue', JSON.stringify(rem));
}

// ══════════════════════════════════════════════
init();
