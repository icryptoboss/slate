// worker.js
// Cloudflare Worker for Slate Digital Teaching Board

const AUTH_COOKIE_NAME = 'slate_session_token';
const AUTH_COOKIE_VALUE = 'authenticated_teaching_session';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- API ROUTES ----

    if (path.startsWith('/api/')) {
      // 1. Auth check
      if (path === '/api/auth-check') {
        const authenticated = checkAuth(request, env);
        return jsonResponse({ authenticated });
      }

      // 2. Login
      if (path === '/api/login' && request.method === 'POST') {
        try {
          const { password } = await request.json();
          if (password === env.SITE_PASSWORD) {
            const cookie = `${AUTH_COOKIE_NAME}=${AUTH_COOKIE_VALUE}; Path=/; HttpOnly; SameSite=Strict; Secure`;
            return new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': cookie
              }
            });
          }
        } catch {}
        return new Response(JSON.stringify({ success: false, error: 'Incorrect password' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 3. Logout
      if (path === '/api/logout' && request.method === 'POST') {
        const cookie = `${AUTH_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict; Secure`;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': cookie
          }
        });
      }

      // Protect all other api routes
      if (!checkAuth(request, env)) {
        return new Response(JSON.stringify({ error: 'Unauthorized. Please login.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 4. Subjects
      if (path === '/api/subjects') {
        try {
          const subjects = await fetchSubjects(env);
          return jsonResponse(subjects);
        } catch (err) {
          return errorResponse(err.message);
        }
      }

      // 5. Files in folder
      const filesMatch = path.match(/^\/api\/subjects\/([^\/]+)\/files$/);
      if (filesMatch) {
        try {
          const folderId = filesMatch[1];
          const files = await fetchFiles(folderId, env);
          return jsonResponse(files);
        } catch (err) {
          return errorResponse(err.message);
        }
      }

      // 6. Stream/Get PDF File
      const fileMatch = path.match(/^\/api\/files\/([^\/]+)$/);
      if (fileMatch) {
        try {
          const fileId = fileMatch[1];
          return await fetchPdfFile(fileId, env);
        } catch (err) {
          return errorResponse(err.message, 500);
        }
      }

      // 7. Get Annotations
      if (path === '/api/annotations' && request.method === 'GET') {
        const fileId = url.searchParams.get('fileId');
        if (!fileId) return errorResponse('fileId is required', 400);

        let data = { pages: null, drawings: {} };
        if (env.SLATE_ANNOTATIONS) {
          const cached = await env.SLATE_ANNOTATIONS.get(fileId);
          if (cached) data = JSON.parse(cached);
        }
        return jsonResponse(data);
      }

      // 8. Save Annotations
      if (path === '/api/annotations' && request.method === 'POST') {
        try {
          const { fileId, pages, drawings } = await request.json();
          if (!fileId) return errorResponse('fileId is required', 400);

          if (env.SLATE_ANNOTATIONS) {
            await env.SLATE_ANNOTATIONS.put(fileId, JSON.stringify({ pages, drawings }));
          }
          return jsonResponse({ success: true });
        } catch (err) {
          return errorResponse(err.message, 500);
        }
      }

      // 9. Client Error Logger
      if (path === '/api/log-error' && request.method === 'POST') {
        const body = await request.json();
        console.error('Browser error logged:', JSON.stringify(body));
        return jsonResponse({ success: true });
      }

      return new Response('Not Found', { status: 404 });
    }

    return new Response('Not Found', { status: 404 });
  }
};

// ---- HELPER FUNCTIONS ----

function checkAuth(request, env) {
  const cookies = request.headers.get('Cookie') || '';
  return cookies.includes(`${AUTH_COOKIE_NAME}=${AUTH_COOKIE_VALUE}`);
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function errorResponse(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function fetchSubjects(env) {
  if (env.USE_MOCK_DATA === 'true') {
    return [
      { id: 'math_mock', name: 'Subject A - Mathematics (Mock)' },
      { id: 'physics_mock', name: 'Subject B - Physics (Mock)' }
    ];
  }

  const q = `'${env.GOOGLE_DRIVE_ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&orderBy=name&key=${env.GOOGLE_API_KEY}`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch subjects from Drive API');
  const data = await res.json();
  return data.files || [];
}

async function fetchFiles(folderId, env) {
  if (env.USE_MOCK_DATA === 'true') {
    return [
      { id: 'file_mock_1', name: 'Lesson 1 - Mock Algebra.pdf' },
      { id: 'file_mock_2', name: 'Lesson 2 - Mock Geometry.pdf' }
    ];
  }

  const q = `'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&orderBy=name&key=${env.GOOGLE_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch files from Drive API');
  const data = await res.json();
  return data.files || [];
}

async function fetchPdfFile(fileId, env) {
  if (env.USE_MOCK_DATA === 'true') {
    const minimal3PagePdf = new Uint8Array([
      37,80,68,70,45,49,46,52,10,49,32,48,32,111,98,106,10,60,60,32,47,84,121,112,101,32,47,67,97,116,97,108,111,103,32,47,80,97,103,101,115,32,50,32,48,32,82,32,62,62,10,101,110,100,111,98,106,10,50,32,48,32,111,98,106,10,60,60,32,47,84,121,112,101,32,47,80,97,103,101,115,32,47,75,105,100,115,32,91,51,32,48,32,82,32,52,32,48,32,82,32,53,32,48,32,82,93,32,47,67,111,117,110,116,32,51,32,62,62,10,101,110,100,111,98,106,10,51,32,48,32,111,98,106,10,60,60,32,47,84,121,112,101,32,47,80,97,103,101,32,47,80,97,114,101,110,116,32,50,32,48,32,82,32,47,77,101,100,105,97,66,111,120,32,91,48,32,48,32,53,57,53,32,56,52,50,93,32,47,82,101,115,111,117,114,99,101,115,32,60,60,32,62,62,32,62,62,10,101,110,100,111,98,106,10,52,32,48,32,111,98,106,10,60,60,32,47,84,121,112,101,32,47,80,97,103,101,32,47,80,97,114,101,110,116,32,50,32,48,32,82,32,47,77,101,100,105,97,66,111,120,32,91,48,32,48,32,53,57,53,32,56,52,50,93,32,47,82,101,115,111,117,114,99,101,115,32,60,60,32,62,62,32,62,62,10,101,110,100,111,98,106,10,53,32,48,32,111,98,106,10,60,60,32,47,84,121,112,101,32,47,80,97,103,101,32,47,80,97,114,101,110,116,32,50,32,48,32,82,32,47,77,101,100,105,97,66,111,120,32,91,48,32,48,32,53,57,53,32,56,52,50,93,32,47,82,101,115,111,117,114,99,101,115,32,60,60,32,62,62,32,62,62,10,120,114,101,102,10,48,32,54,10,48,48,48,48,48,48,48,48,48,48,32,54,53,53,51,53,32,102,32,10,48,48,48,48,48,48,48,48,48,57,32,48,48,48,48,48,32,110,32,10,48,48,48,48,48,48,48,48,53,54,32,48,48,48,48,48,32,110,32,10,48,48,48,48,48,48,48,49,50,49,32,48,48,48,48,48,32,110,32,10,48,48,48,48,48,48,48,50,48,50,32,48,48,48,48,48,32,110,32,10,48,48,48,48,48,48,48,50,56,51,32,48,48,48,48,48,32,110,32,10,116,114,97,105,108,101,114,10,60,60,32,47,83,105,122,101,32,54,32,47,82,111,111,116,32,49,32,48,32,82,32,62,62,10,115,116,97,114,116,120,114,101,102,10,51,54,52,10,37,37,69,79,70,10
    ]);
    return new Response(minimal3PagePdf, {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' }
    });
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${env.GOOGLE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to download PDF from Drive API');
  
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline'
    }
  });
}
