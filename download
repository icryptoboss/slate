// ===== Drive access, proxied through our own Cloudflare Functions =====
// No API key or folder ID ever touches the browser — the server holds those,
// so visiting the site on any device just works with no setup.
const Drive = {
  async listChildren(parentId, { foldersOnly = false, pdfsOnly = false } = {}) {
    const params = new URLSearchParams();
    if (parentId) params.set("parent", parentId);
    if (foldersOnly) params.set("type", "folder");
    if (pdfsOnly) params.set("type", "pdf");

    const res = await fetch(`/api/drive-list?${params.toString()}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Drive proxy error (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.files || [];
  },

  fileContentUrl(fileId) {
    return `/api/drive-file?fileId=${encodeURIComponent(fileId)}`;
  },
};
