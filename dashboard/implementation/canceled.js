// Canceled tab: the one-time Confluence pull (data/canceled_projects.js) plus projects marked canceled from the SharePoint list
// (data/canceled_from_list.js). Status colors reuse the dashboard's status-pill classes.
(function () {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Confluence stored health as free text ("Canceled 04/08/25: Red", "Yellow ...", "On Hold ..."). A trailing or leading Red/Yellow/Green
  // sets the color; otherwise the first words (Canceled, On Hold, Not Started...) are the label, shown gray.
  function parseStatus(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return "Unknown";
    const color = (t.match(/\b(green|yellow|red)\s*$/i) || t.match(/^(green|yellow|red)\b/i) || [])[1];
    if (color) return color[0].toUpperCase() + color.slice(1).toLowerCase();
    const word = (t.match(/^(cancell?ed|canceling|cancelling|on hold|not started|dropping|unknown)/i) || [])[1];
    return word ? word.toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unknown";
  }
  const statusClass = (s) => ({ green: "status-green", yellow: "status-yellow", red: "status-red" }[String(s || "").toLowerCase()] || "status-other");
  const pill = (s) => { const label = parseStatus(s); return `<span class="status-pill ${statusClass(label)}">${esc(label)}</span>`; };
  const fmtDate = (v) => { const d = new Date(v); return v && !isNaN(d) ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : esc(v || ""); };

  const confluence = (window.CANCELED_PROJECTS_DATA || {}).projects || [];
  const fromList = ((window.CANCELED_FROM_LIST_DATA || {}).projects || []).map((p) => ({
    page_id: p.page_id, title: p.display_name || p.title, url: p.url, region_state: p.region_state, go_live: p.go_live,
    project_manager: p.project_manager, implementation_manager: p.implementation_manager,
    project_status: p.project_status, client_status: p.client_status, last_saved: (p.canceled || {}).date || p.last_modified,
    history: [], source: "list", reason: (p.canceled || {}).reason,
  }));
  const rows = [...confluence, ...fromList];
  const sort = { key: "title", dir: 1 };

  function render() {
    const q = document.getElementById("searchInput").value.trim().toLowerCase();
    const shown = rows.filter((r) => !q || [r.title, r.region_state, r.project_manager, r.implementation_manager].join(" ").toLowerCase().includes(q))
      .sort((a, b) => String(a[sort.key] || "").localeCompare(String(b[sort.key] || "")) * sort.dir);
    document.getElementById("resultsCount").textContent = `${shown.length} project${shown.length === 1 ? "" : "s"}`;
    document.querySelector("#canceledTable tbody").innerHTML = shown.length ? shown.map((r) => `
      <tr>
        <td>${r.url ? `<a class="project-link" href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title)}</a>` : esc(r.title)}</td>
        <td>${esc(r.region_state)}</td>
        <td>${esc(r.go_live)}</td>
        <td>${esc(r.project_manager)}</td>
        <td>${esc(r.implementation_manager)}</td>
        <td>${fmtDate(r.last_saved)}</td>
        <td>${pill(r.project_status)} ${pill(r.client_status)}</td>
        <td><button type="button" class="project-history-button" data-history="${esc(r.page_id)}">History</button></td>
      </tr>`).join("") : '<tr><td colspan="8" class="empty">No canceled projects.</td></tr>';
  }

  function openHistory(pageId) {
    const row = rows.find((r) => r.page_id === pageId);
    if (!row) return;
    let modal = document.getElementById("projectHistoryModal");
    if (!modal) { modal = document.createElement("div"); modal.id = "projectHistoryModal"; document.body.appendChild(modal); }
    const entries = (row.history || []).filter((e) => ["project_status", "project_health", "client_status", "client_health"].some((k) => k in (e.values || {})));
    const state = { project_status: "", client_status: "" };
    const body = entries.map((e) => {
      const v = e.values;
      Object.keys(state).forEach((k) => { if (k in v) state[k] = v[k]; });
      const part = (label, status, notes) => `<div class="project-history-section"><div class="project-history-label">${label}</div>
        <div>${pill(notes || status)} ${esc(String(notes || "").replace(/^(green|yellow|red|cancell?ed|canceling|on hold|not started|dropping)\b[\s|:-]*/i, ""))}</div></div>`;
      return `<article class="project-history-entry"><div class="project-history-date">${fmtDate(e.saved_at)} | <span class="project-history-source">Confluence</span></div>
        <div class="project-history-grid">
          ${"project_status" in v || "project_health" in v ? part("Project Health", state.project_status, v.project_health) : ""}
          ${"client_status" in v || "client_health" in v ? part("Client Health", state.client_status, v.client_health) : ""}
        </div></article>`;
    }).reverse().join("");
    modal.className = "project-history-modal";
    modal.innerHTML = `<div class="project-history-backdrop" data-close="1"></div><div class="project-history-card">
      <div class="project-history-head"><div><h3>${esc(row.title)}</h3>
      <p>${entries.length} saved status or note change${entries.length === 1 ? "" : "s"}.${row.reason ? " " + esc(row.reason) : ""}</p></div>
      <button type="button" class="action-button action-button-secondary project-history-close" data-close="1">Close</button></div>
      <div class="project-history-body">${body || '<p class="empty">No saved note history found for this project.</p>'}</div></div>`;
  }

  document.addEventListener("click", (event) => {
    const h = event.target.closest("[data-history]");
    if (h) return openHistory(h.dataset.history);
    if (event.target.closest("[data-close]")) document.getElementById("projectHistoryModal").className = "project-history-modal project-history-hidden";
    const th = event.target.closest("th[data-sort]");
    if (th) { sort.dir = sort.key === th.dataset.sort ? -sort.dir : 1; sort.key = th.dataset.sort; render(); }
  });
  document.getElementById("searchInput").addEventListener("input", render);
  const generated = (window.CANCELED_PROJECTS_DATA || {}).generated_at;
  document.getElementById("stamp").textContent = generated ? `Confluence pull: ${fmtDate(generated)}` : "";
  render();
})();
