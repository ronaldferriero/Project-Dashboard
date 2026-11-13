// Frozen Confluence page history for the History button (data/confluence_history.json, written once by pull_confluence_history.py).
// Everything saved before `sharepoint_history_starts` comes from this archive; from then on the dashboard's own snapshots
// (built from the Microsoft list) are used. The archive never changes after the one-time pull.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ConfluenceHistory = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const FIELDS = ["project_status", "project_health", "client_status", "client_health"];

  // The archive page for a dashboard project: matched by the dashboard page id, or by the Confluence page id itself.
  function findPage(archive, pageId) {
    const id = String(pageId || "");
    if (!archive || !archive.pages || !id) return null;
    if (archive.pages[id]) return archive.pages[id];
    return Object.values(archive.pages).find((page) => String(page.dashboard_page_id) === id) || null;
  }

  // Archive entries are stored as "what changed"; replay them into full project/client health at each save, oldest first.
  // Only saves before the SharePoint history starts are returned.
  function entriesFor(archive, pageId) {
    const page = findPage(archive, pageId);
    if (!page) return { found: false, entries: [], cutoff: "" };
    const cutoff = archive.sharepoint_history_starts || "";
    const state = { project_status: "", project_health: "", client_status: "", client_health: "" };
    const entries = [];
    (page.history || []).forEach((entry) => {
      if (cutoff && Date.parse(entry.saved_at) >= Date.parse(cutoff)) return;
      FIELDS.forEach((field) => { if (field in (entry.values || {})) state[field] = entry.values[field]; });
      entries.push({ generated_at: entry.saved_at, source: "Confluence", ...state });
    });
    return { found: true, entries, cutoff };
  }

  return { entriesFor, findPage };
});
