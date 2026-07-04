/* ===== Tokens ===== */
:root{
  --bg: #1B2320;
  --bg-raised: #232E29;
  --panel: #263129;
  --panel-2: #2C3831;
  --line: #3A473F;
  --chalk: #F1EFE7;
  --chalk-dim: #C9D1C9;
  --muted: #8FA096;
  --amber: #E8B94D;
  --amber-dim: #B79242;
  --teal: #5FB3A3;
  --rust: #E36B5C;
  --font-display: 'Space Grotesk', sans-serif;
  --font-hand: 'Caveat', cursive;
  --font-body: 'Inter', sans-serif;
  --radius: 14px;
  --shadow: 0 8px 24px rgba(0,0,0,0.35);
}

*{ box-sizing:border-box; }
html,body{ height:100%; }
body{
  margin:0;
  background:
    radial-gradient(circle at 15% 8%, rgba(232,185,77,0.05), transparent 40%),
    radial-gradient(circle at 90% 85%, rgba(95,179,163,0.05), transparent 45%),
    var(--bg);
  color:var(--chalk);
  font-family:var(--font-body);
  -webkit-font-smoothing:antialiased;
  overflow-x:hidden;
}
h1,h2,h3{ font-family:var(--font-display); margin:0; letter-spacing:-0.01em; }
.handwritten{ font-family:var(--font-hand); font-weight:600; font-size:2.4rem; color:var(--amber); }
.muted{ color:var(--muted); }
.muted-more{ color:var(--line); font-size:0.8rem; }
.hidden{ display:none !important; }
button{ font-family:inherit; cursor:pointer; }

/* ===== Topbar ===== */
.topbar{
  display:flex; align-items:center; gap:12px;
  padding:14px 20px;
  border-bottom:1px solid var(--line);
  position:sticky; top:0; z-index:40;
  background:rgba(27,35,32,0.9);
  backdrop-filter:blur(10px);
}
.icon-btn{
  background:var(--panel); border:1px solid var(--line); color:var(--chalk);
  width:36px; height:36px; border-radius:10px;
  display:flex; align-items:center; justify-content:center;
  transition:background .15s, transform .1s;
}
.icon-btn:hover{ background:var(--panel-2); }
.icon-btn:active{ transform:scale(0.94); }
.brand{ display:flex; align-items:baseline; gap:10px; }
.brand-mark{ font-family:var(--font-display); font-weight:700; font-size:1.15rem; letter-spacing:-0.02em; }
.crumb{ color:var(--muted); font-size:0.85rem; }
.topbar-right{ margin-left:auto; display:flex; align-items:center; gap:12px; }
.sync-state{ color:var(--teal); font-size:0.7rem; }
.sync-state.offline{ color:var(--rust); }
.sync-state.syncing{ color:var(--amber); animation:pulse 1s infinite; }
@keyframes pulse{ 50%{ opacity:0.3; } }
.pill-btn{
  display:flex; align-items:center; gap:6px;
  background:var(--panel); border:1px solid var(--line); color:var(--chalk);
  padding:7px 12px; border-radius:999px; font-size:0.82rem; font-weight:500;
  transition:background .15s, border-color .15s;
}
.pill-btn:hover{ background:var(--panel-2); border-color:var(--amber-dim); }

/* ===== Continue card ===== */
.continue-card{
  display:flex; flex-direction:column; gap:4px;
  background:var(--panel); border:1px solid var(--amber-dim); border-radius:var(--radius);
  padding:14px 18px; margin-bottom:22px; text-decoration:none; color:var(--chalk);
  transition:background .15s, transform .15s;
}
.continue-card:hover{ background:var(--panel-2); transform:translateY(-2px); }
.continue-label{ font-size:0.72rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--amber); font-weight:600; }
.continue-title{ font-size:0.95rem; font-weight:500; }

/* ===== App / Views ===== */
.app{ max-width:1100px; margin:0 auto; padding:28px 20px 60px; min-height:calc(100% - 64px); }
.view-head{ margin-bottom:24px; }
.view-head p{ margin-top:6px; }

/* ===== Folder / File grid ===== */
.grid{
  display:grid; grid-template-columns:repeat(auto-fill, minmax(190px,1fr)); gap:16px;
}
.folder-card, .file-card{
  background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
  padding:20px 18px; text-align:left; color:var(--chalk);
  display:flex; flex-direction:column; gap:14px; min-height:130px;
  transition:transform .15s, border-color .15s, background .15s;
  position:relative; overflow:hidden;
}
.folder-card::before{
  content:""; position:absolute; top:0; left:0; right:0; height:4px;
  background:linear-gradient(90deg, var(--amber), var(--teal));
  opacity:0; transition:opacity .15s;
}
.folder-card:hover, .file-card:hover{
  transform:translateY(-3px); border-color:var(--amber-dim); background:var(--panel-2);
}
.folder-card:hover::before{ opacity:1; }
.card-icon{ color:var(--amber); }
.card-title{ font-weight:600; font-size:1rem; line-height:1.3; }
.card-sub{ font-size:0.78rem; color:var(--muted); margin-top:auto; }
.files-grid .file-card{ min-height:150px; }
.file-card .card-icon{ color:var(--rust); }

/* ===== Empty state ===== */
#emptyState{ display:flex; align-items:center; justify-content:center; min-height:50vh; }
.empty-card{ text-align:center; }
.empty-card .handwritten{ font-size:1.8rem; }

/* ===== Loading skeletons ===== */
.skeleton{
  background:linear-gradient(90deg, var(--panel) 25%, var(--panel-2) 37%, var(--panel) 63%);
  background-size:400% 100%; animation:shimmer 1.4s ease infinite; border-radius:var(--radius);
  min-height:130px; border:1px solid var(--line);
}
@keyframes shimmer{ 0%{ background-position:100% 0; } 100%{ background-position:0 0; } }

/* ===== Viewer ===== */
.viewer-view{ padding:0; max-width:none; }
.pdf-stage{
  height:calc(100vh - 65px); overflow-y:auto; scroll-snap-type:y mandatory;
  display:flex; flex-direction:column; align-items:center;
  scrollbar-width:none; background:#12100E;
}
.pdf-stage::-webkit-scrollbar{ display:none; }
.pdf-page{
  scroll-snap-align:start; position:relative;
  display:flex; align-items:center; justify-content:center;
  min-height:calc(100vh - 65px); width:100%; padding:16px 0;
}
.pdf-page .render-canvas{ box-shadow:var(--shadow); border-radius:4px; background:#fff; position:relative; }
.pdf-page .draw-canvas{
  position:absolute; top:0; left:0;
  touch-action:none; border-radius:4px; background:transparent;
}

.viewer-nav{
  position:fixed; right:18px; top:50%; transform:translateY(-50%);
  display:flex; flex-direction:column; align-items:center; gap:10px; z-index:30;
}
.nav-btn{
  width:44px; height:44px; border-radius:50%; border:1px solid var(--line);
  background:rgba(38,49,41,0.85); backdrop-filter:blur(6px); color:var(--chalk);
  display:flex; align-items:center; justify-content:center; transition:background .15s;
}
.nav-btn:hover{ background:var(--panel-2); }
.page-indicator{ font-size:0.75rem; color:var(--chalk-dim); background:rgba(38,49,41,0.85); padding:4px 8px; border-radius:8px; }

.pen-toolbar{
  position:fixed; bottom:22px; left:50%; transform:translateX(-50%);
  display:flex; align-items:center; gap:10px;
  background:rgba(38,49,41,0.92); border:1px solid var(--line); backdrop-filter:blur(10px);
  padding:10px 14px; border-radius:999px; box-shadow:var(--shadow); z-index:30;
}
.tool-btn{
  width:36px; height:36px; border-radius:50%; border:1px solid transparent;
  background:transparent; color:var(--chalk-dim); display:flex; align-items:center; justify-content:center;
  transition:background .15s, color .15s;
}
.tool-btn:hover{ background:var(--panel-2); color:var(--chalk); }
.tool-btn.active{ background:var(--amber); color:#22271A; }
.tool-btn:disabled{ opacity:0.3; pointer-events:none; }
.swatches{ display:flex; gap:6px; padding:0 4px; }
.swatch{
  width:22px; height:22px; border-radius:50%; border:2px solid transparent; padding:0;
}
.swatch.active{ border-color:var(--chalk); }
#thicknessRange{ width:70px; accent-color:var(--amber); }

/* ===== Fullscreen toggle ===== */
.fs-btn{
  position:fixed; top:14px; right:14px; z-index:35;
}
body.fullscreen-active .topbar{ display:none; }
body.fullscreen-active .pdf-stage{ height:100vh; }
body.fullscreen-active .pdf-page{ min-height:100vh; }

/* ===== Whiteboard ===== */
.whiteboard-bg{ border-radius:4px; }

@media (max-width:640px){
  .app{ padding:20px 14px 50px; }
  .handwritten{ font-size:2rem; }
  .pen-toolbar{ gap:5px; padding:8px 8px; bottom:14px; max-width:94vw; overflow-x:auto; }
  #thicknessRange{ width:38px; }
  .viewer-nav{ right:10px; }
  .fs-btn{ top:10px; right:10px; }
}
