// ===== Shared drawing engine =====
// One instance per canvas (a PDF page, or a whiteboard page).
// Reads live tool/color/thickness from PenState so the toolbar controls whichever
// canvas is currently being drawn on.

const PenState = {
  tool: "pen", // pen | eraser | line | rect | ellipse | arrow
  color: "#E8B94D",
  thickness: 3,
};

function normPoint(x, y, canvas) {
  return [x / canvas.width, y / canvas.height];
}
function denormPoint(nx, ny, canvas) {
  return [nx * canvas.width, ny * canvas.height];
}

function storageKey(contextId, page) {
  return `slate_annot:${contextId}:${page}`;
}

function loadLocalStrokes(contextId, page) {
  try {
    const raw = localStorage.getItem(storageKey(contextId, page));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveLocalStrokes(contextId, page, strokes) {
  localStorage.setItem(storageKey(contextId, page), JSON.stringify(strokes));
}

async function syncToCloud(contextId, page, strokes) {
  const dot = document.getElementById("syncState");
  if (!navigator.onLine) {
    if (dot) dot.className = "sync-state offline";
    return;
  }
  try {
    if (dot) dot.className = "sync-state syncing";
    await fetch(`/api/annotations?fileId=${encodeURIComponent(contextId)}&page=${page}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strokes }),
    });
    if (dot) dot.className = "sync-state";
  } catch {
    if (dot) dot.className = "sync-state offline";
  }
}

async function fetchCloudStrokes(contextId, page) {
  if (!navigator.onLine) return null;
  try {
    const res = await fetch(`/api/annotations?fileId=${encodeURIComponent(contextId)}&page=${page}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.strokes || null;
  } catch {
    return null;
  }
}

function renderStroke(ctx, canvas, s) {
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";

  if (s.shapeType) {
    const [sx, sy] = denormPoint(s.start[0], s.start[1], canvas);
    const [ex, ey] = denormPoint(s.end[0], s.end[1], canvas);
    ctx.beginPath();
    if (s.shapeType === "line" || s.shapeType === "arrow") {
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      if (s.shapeType === "arrow") {
        const angle = Math.atan2(ey - sy, ex - sx);
        const headLen = Math.max(10, s.width * 3);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
      }
    } else if (s.shapeType === "rect") {
      ctx.strokeRect(sx, sy, ex - sx, ey - sy);
    } else if (s.shapeType === "ellipse") {
      const cx = (sx + ex) / 2, cy = (sy + ey) / 2;
      const rx = Math.abs(ex - sx) / 2, ry = Math.abs(ey - sy) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }

  if (s.points.length < 2) return;
  ctx.beginPath();
  const [fx, fy] = denormPoint(s.points[0][0], s.points[0][1], canvas);
  ctx.moveTo(fx, fy);
  for (let i = 1; i < s.points.length; i++) {
    const [x, y] = denormPoint(s.points[i][0], s.points[i][1], canvas);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function redrawAll(ctx, canvas, strokes) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) renderStroke(ctx, canvas, s);
  ctx.globalCompositeOperation = "source-over";
}

const SHAPE_TOOLS = new Set(["line", "rect", "ellipse", "arrow"]);

function attachDrawingEngine(drawCanvas, contextId, page) {
  const ctx = drawCanvas.getContext("2d");
  let strokes = loadLocalStrokes(contextId, page);
  let redoStack = [];
  redrawAll(ctx, drawCanvas, strokes);

  fetchCloudStrokes(contextId, page).then((cloudStrokes) => {
    if (cloudStrokes && JSON.stringify(cloudStrokes) !== JSON.stringify(strokes)) {
      strokes = cloudStrokes;
      redoStack = [];
      saveLocalStrokes(contextId, page, strokes);
      redrawAll(ctx, drawCanvas, strokes);
    }
  });

  let drawing = false;
  let currentStroke = null;
  let drawingEnabled = true;
  let startPoint = null;

  function toCanvasXY(e) {
    const rect = drawCanvas.getBoundingClientRect();
    return [
      (e.clientX - rect.left) * (drawCanvas.width / rect.width),
      (e.clientY - rect.top) * (drawCanvas.height / rect.height),
    ];
  }

  function commit() {
    saveLocalStrokes(contextId, page, strokes);
    syncToCloud(contextId, page, strokes);
  }

  function pointerDown(e) {
    if (!drawingEnabled) return;
    drawing = true;
    const [x, y] = toCanvasXY(e);
    drawCanvas.setPointerCapture(e.pointerId);

    if (SHAPE_TOOLS.has(PenState.tool)) {
      startPoint = normPoint(x, y, drawCanvas);
      currentStroke = {
        shapeType: PenState.tool,
        color: PenState.color,
        width: PenState.thickness,
        start: startPoint,
        end: startPoint,
      };
    } else {
      currentStroke = {
        color: PenState.color,
        width: PenState.tool === "eraser" ? PenState.thickness * 5 : PenState.thickness,
        erase: PenState.tool === "eraser",
        points: [normPoint(x, y, drawCanvas)],
      };
    }
  }

  function pointerMove(e) {
    if (!drawing || !currentStroke) return;
    const [x, y] = toCanvasXY(e);
    if (SHAPE_TOOLS.has(PenState.tool)) {
      currentStroke.end = normPoint(x, y, drawCanvas);
    } else {
      currentStroke.points.push(normPoint(x, y, drawCanvas));
    }
    redrawAll(ctx, drawCanvas, [...strokes, currentStroke]);
  }

  function pointerUp() {
    if (!drawing || !currentStroke) return;
    drawing = false;
    strokes.push(currentStroke);
    redoStack = [];
    currentStroke = null;
    commit();
  }

  drawCanvas.addEventListener("pointerdown", pointerDown);
  drawCanvas.addEventListener("pointermove", pointerMove);
  drawCanvas.addEventListener("pointerup", pointerUp);
  drawCanvas.addEventListener("pointercancel", pointerUp);
  drawCanvas.addEventListener("pointerleave", pointerUp);

  return {
    clear() {
      strokes = [];
      redoStack = [];
      commit();
      redrawAll(ctx, drawCanvas, strokes);
    },
    undo() {
      if (strokes.length === 0) return;
      redoStack.push(strokes.pop());
      commit();
      redrawAll(ctx, drawCanvas, strokes);
    },
    redo() {
      if (redoStack.length === 0) return;
      strokes.push(redoStack.pop());
      commit();
      redrawAll(ctx, drawCanvas, strokes);
    },
    canUndo: () => strokes.length > 0,
    canRedo: () => redoStack.length > 0,
    setDrawingEnabled(v) { drawingEnabled = v; },
    exportPNG(backgroundCanvas) {
      const out = document.createElement("canvas");
      out.width = drawCanvas.width;
      out.height = drawCanvas.height;
      const octx = out.getContext("2d");
      if (backgroundCanvas) octx.drawImage(backgroundCanvas, 0, 0);
      octx.drawImage(drawCanvas, 0, 0);
      return out.toDataURL("image/png");
    },
  };
}
