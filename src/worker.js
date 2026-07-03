// ===== Slate Worker =====
// One script now handles everything: password gate, Google Drive proxy,
// annotation sync, and falls through to static assets in /public for
// everything else. This replaces the old functions/ (Pages Functions)
// folder, which is ignored by Workers-with-static-assets deployments.

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });
  return out;
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slate — Sign in</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{ --bg:#1B2320; --panel:#263129; --line:#3A473F; --chalk:#F1EFE7; --amber:#E8B94D; --muted:#8FA096; --rust:#E36B5C; }
  *{ box-sizing:border-box; }
  body{ margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:var(--bg); color:var(--chalk); font-family:'Inter',sans-serif; }
  .card{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:34px;
    width:100%; max-width:340px; box-shadow:0 8px 24px rgba(0,0,0,0.35); }
  h1{ font-family:'Space Grotesk',sans-serif; font-size:1.3rem; margin:0 0 6px; }
  p{ color:var(--muted); font-size:0.85rem; margin:0 0 20px; }
  input{ width:100%; padding:11px 12px; background:var(--bg); border:1px solid var(--line);
    border-radius:10px; color:var(--chalk); font-size:0.95rem; }
  input:focus{ outline:none; border-color:var(--amber); }
  button{ margin-top:14px; width:100%; padding:12px; border:none; border-radius:10px;
    background:var(--amber); color:#22271A; font-weight:600; font-size:0.95rem; cursor:pointer; }
  .error{ color:var(--rust); font-size:0.8rem; margin-top:12px; }
</style></head>
<body>
  <form class="card" method="POST" action="/api/login">
    <h1>Slate</h1>
    <p>Enter the password to open your board.</p>
    <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
    <button type="submit">Enter</button>
    ${error ? `<div class="error">Wrong password — try again.</div>` : ""}
  </form>
</body></html>`;
}

async function isAuthed(request, env) {
  if (!env.SITE_PASSWORD) return true; // fail open only if not configured yet
  const cookies = parseCookies(request.headers.get("Cookie"));
  const expected = await sha256Hex(env.SITE_PASSWORD + (env.AUTH_SECRET || ""));
  return cookies.slate_session === expected;
}

async function handleLogin(request, env) {
  if (!env.SITE_PASSWORD) {
    return new Response("Site password not configured", { status: 500 });
  }
  const form = await request.formData();
  const password = (form.get("password") || "").toString();

  if (password !== env.SITE_PASSWORD) {
    return Response.redirect(new URL("/?error=1", request.url), 302);
  }

  const token = await sha256Hex(env.SITE_PASSWORD + (env.AUTH_SECRET || ""));
  const headers = new Headers();
  headers.append("Set-Cookie", `slate_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
  headers.append("Location", "/");
  return new Response(null, { status: 302, headers });
}

function handleLogout() {
  const headers = new Headers();
  headers.append("Set-Cookie", `slate_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  headers.append("Location", "/");
  return new Response(null, { status: 302, headers });
}

async function handleDriveList(request, env) {
  if (!env.GOOGLE_API_KEY || !env.ROOT_FOLDER_ID) {
    return new Response(JSON.stringify({ error: "Server not configured — missing GOOGLE_API_KEY or ROOT_FOLDER_ID" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  const url = new URL(request.url);
  const parent = url.searchParams.get("parent") || env.ROOT_FOLDER_ID;
  const type = url.searchParams.get("type");

  let q = `'${parent}' in parents and trashed = false`;
  if (type === "folder") q += ` and mimeType = 'application/vnd.google-apps.folder'`;
  if (type === "pdf") q += ` and mimeType = 'application/pdf'`;

  const params = new URLSearchParams({
    q, key: env.GOOGLE_API_KEY,
    fields: "files(id,name,mimeType,modifiedTime,size)",
    orderBy: "name_natural", pageSize: "200",
  });

  const upstream = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=20" },
  });
}

async function handleDriveFile(request, env) {
  if (!env.GOOGLE_API_KEY) {
    return new Response("Server not configured — missing GOOGLE_API_KEY", { status: 500 });
  }
  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");
  if (!fileId) return new Response("Missing fileId", { status: 400 });

  const upstream = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${env.GOOGLE_API_KEY}`;
  const res = await fetch(upstream);
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "application/pdf",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

function annotationKey(fileId, page) {
  return `annot:${fileId}:${page}`;
}

async function handleAnnotationsGet(request, env) {
  if (!env.SLATE_KV) {
    return new Response(JSON.stringify({ error: "KV not configured" }), { status: 501 });
  }
  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");
  const page = url.searchParams.get("page");
  if (!fileId || !page) {
    return new Response(JSON.stringify({ error: "Missing fileId or page" }), { status: 400 });
  }
  const value = await env.SLATE_KV.get(annotationKey(fileId, page));
  return new Response(value || JSON.stringify({ strokes: [] }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleAnnotationsPost(request, env) {
  if (!env.SLATE_KV) {
    return new Response(JSON.stringify({ error: "KV not configured" }), { status: 501 });
  }
  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");
  const page = url.searchParams.get("page");
  if (!fileId || !page) {
    return new Response(JSON.stringify({ error: "Missing fileId or page" }), { status: 400 });
  }
  const body = await request.json();
  await env.SLATE_KV.put(annotationKey(fileId, page), JSON.stringify(body));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Login submission is always reachable, auth or not
    if (url.pathname === "/api/login" && request.method === "POST") {
      return handleLogin(request, env);
    }

    const authed = await isAuthed(request, env);
    if (!authed) {
      const showError = url.searchParams.get("error") === "1";
      return new Response(loginPage(showError), {
        status: 401,
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      });
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      return handleLogout();
    }
    if (url.pathname === "/api/drive-list" && request.method === "GET") {
      return handleDriveList(request, env);
    }
    if (url.pathname === "/api/drive-file" && request.method === "GET") {
      return handleDriveFile(request, env);
    }
    if (url.pathname === "/api/annotations" && request.method === "GET") {
      return handleAnnotationsGet(request, env);
    }
    if (url.pathname === "/api/annotations" && request.method === "POST") {
      return handleAnnotationsPost(request, env);
    }

    // Everything else: serve the static app from /public
    return env.ASSETS.fetch(request);
  },
};
