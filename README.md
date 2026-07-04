# Slate — your teaching board

A website that turns a private Google Drive folder of PDFs into a portable digital board:
subject folders → PDFs → full-page viewer with page-up/down navigation and a pen layer for
writing and diagrams directly on the page — protected by a password, and configured once on
the server so it just works on every device you visit it from.

**This runs as a single Cloudflare Worker** with a `public/` folder of static assets and one
script (`src/worker.js`) that handles the password gate, Google Drive proxy, and annotation
sync. (Cloudflare's older "Pages Functions" file-based routing — a `functions/` folder — is
not used here, since Git-connected Worker projects don't read it.)

---

## 1. Prepare your Google Drive

1. In Google Drive, make sure your **root folder** (the one containing all your subject
   folders) and everything inside it is shared as **"Anyone with the link — Viewer"**.
   Right-click the root folder → Share → General access → Anyone with the link.
   Since the site itself is password-protected, this doesn't mean the public can browse
   your files — only your server-side API key can read them, and only people who know your
   site password can reach the app that uses that key.
2. Open the root folder in your browser. Copy the ID from the URL:
   `https://drive.google.com/drive/folders/`**`1AbCdEfGhIjKlMnOpQrSt`** ← this part.

## 2. Get a Google API key

1. [Google Cloud Console](https://console.cloud.google.com/) → create or pick a project.
2. **APIs & Services → Library** → search "Google Drive API" → **Enable**.
3. **APIs & Services → Credentials** → **Create Credentials → API key**.
4. Click into the new key → **Restrict key** → API restrictions → restrict to
   **Google Drive API** only. (No website/referrer restriction needed — the key is only
   ever used server-side, never sent to the browser.)
5. Save. Copy the key.

## 3. Push to GitHub

Push the whole project (including `wrangler.jsonc`, `src/`, and `public/`) to a repo, with
`index.html` etc. living inside `public/` — don't flatten the folders:

```bash
cd edu-board
git init
git add .
git commit -m "Slate teaching board"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## 4. Connect it in Cloudflare

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** (this is the
   current path for Git-connected Workers — it may just say "Connect to Git").
2. Pick your repo. Cloudflare will detect `wrangler.jsonc` and configure the build
   automatically — you shouldn't need to set a build/deploy command manually.
3. Deploy. You'll get a `*.workers.dev` URL.
4. **Check the branch:** in your Worker's **Settings → Build**, confirm your production
   branch is set to `main` (or whichever branch you pushed to). Pushes to that branch should
   deploy straight to production; pushes to other branches only create preview versions that
   won't be live until promoted.

## 5. Set your environment variables

Worker project → **Settings → Variables and Secrets** (some dashboards still label this
**Environment variables**) → add these four:

| Variable | Value | Type |
|---|---|---|
| `GOOGLE_API_KEY` | the key from step 2 | Secret |
| `ROOT_FOLDER_ID` | the folder ID from step 1 | Secret |
| `SITE_PASSWORD` | a password only you know | Secret |
| `AUTH_SECRET` | any long random string (e.g. `openssl rand -hex 32`) | Secret |

Mark all four as **Secret**. After saving, redeploy (Deployments → retry the latest, or push
a small commit) so the Worker picks them up.

There's nothing to enter in the browser — visit your site from any device and, after the
password screen, it works immediately.

## 6. Attach your domain

Worker project → **Settings → Domains & Routes → Add → Custom domain** → enter your domain.
Since it's already on Cloudflare, the DNS record is added for you automatically.

---

## The password screen

Every request is checked by `src/worker.js` before anything else runs. Without the right
password you see a plain password box — no folder names, no PDFs, nothing.

- Enter `SITE_PASSWORD` once and a session cookie is set.
- The cookie has **no expiry**, so browsers clear it when fully closed — you'll be asked
  again each time you open the site fresh, not on every click while using it.
- The lock icon in the top-right ends your session immediately (handy on a shared device).
- This is lightweight, single-user protection — enough to keep casual visitors and search
  engines out. It's not bank-grade security, so don't reuse a sensitive password.

**To change your password later:** update `SITE_PASSWORD` in Cloudflare and redeploy.
Everyone's existing session (including yours) stops working, so you'll log in again with
the new password.

---

## Optional: local testing before you deploy

```bash
cd edu-board
npm install -g wrangler
cp .dev.vars.example .dev.vars   # fill in real values
wrangler dev
```

Open the URL Wrangler prints, confirm the password screen and your folders load, before
pushing to GitHub.

## Optional: sync pen drawings across devices

By default, pen/whiteboard drawings save per-device (localStorage). To make them follow you
across devices:

1. Cloudflare dashboard → **Storage & Databases → KV → Create namespace** → name it
   anything (e.g. `slate-annotations`) and copy its ID.
2. In `wrangler.jsonc`, uncomment the `kv_namespaces` block at the bottom and paste in that
   ID.
3. Commit and push — the next deploy picks it up automatically.

Skip this and everything still works, just locally per-device.

---

## Using it day to day

- **Home** shows every folder directly inside your root Drive folder as a subject. If
  you've opened something before, a **"Continue where you left off"** card appears at the
  top, jumping straight back to that file and page.
- Open a folder → see its PDFs.
- Open a PDF → it fills the screen. Scroll or use the up/down arrows on the right (or arrow
  keys) to move between pages, like a digital board.
- The bottom toolbar: pen, eraser, four shape tools (line, rectangle, circle, arrow), four
  colors, thickness slider, **undo/redo** (also `Ctrl+Z` / `Ctrl+Shift+Z`), clear page, and
  a pause-drawing toggle.
- The **+ button** next to the page counter inserts a blank page immediately after the one
  you're viewing — handy for working through a problem right where you need it, without
  leaving the document. It stays part of that PDF (saved alongside it), unlike the
  standalone whiteboard below.
- The expand icon top-right toggles **fullscreen** (only visible once you're viewing a PDF
  or the whiteboard, not on the home screen) — hides the header, useful when projecting.
- The **"Board" button** in the header opens a separate blank whiteboard — not tied to any
  PDF, for working through something unrelated to any document. Its own **+** adds more
  pages; they're saved and stay put between visits.
- Add new PDFs to any subject folder in Drive and they appear on the site immediately — no
  redeploy needed.
- Pages render as large as your screen allows (fitting both width and height), rather than
  a small fixed box — the goal is something closer to a proper full-page reader.

## Working offline

Once you've opened a PDF while online, the app shell and that PDF are cached automatically.
A wifi drop mid-lesson won't stop you from paging through something you've already opened,
and drawings sync once you're back online (if KV sync is set up). The very first visit each
session still needs to pass the password check online — offline mode covers staying usable
*after* you're in, not skipping the password screen from a cold start.

## Notes & limits

- Folders/PDFs must stay set to "Anyone with the link" — if sharing reverts, that item
  will fail to load.
- Very large PDFs (50+ MB) may take a moment to open on slower connections.
- Drawing works with mouse, touch, and stylus/pen (with pressure on supported devices) via
  the Pointer Events API — no special drivers needed for tablets like iPad or Android
  styluses.

## If something 404s after deploying

- Confirm `index.html` sits inside `public/` in your repo (not at the repo root, and not
  nested one level too deep either).
- Confirm `wrangler.jsonc` and `src/worker.js` sit at the repo **root**, next to `public/`.
- Check your Worker's latest deployment log in the Cloudflare dashboard — it should mention
  uploading assets from `./public` and show `src/worker.js` as the entry point. If it
  mentions "autoconfig" or doesn't reference `wrangler.jsonc` at all, the config file likely
  isn't where Cloudflare expects it.
