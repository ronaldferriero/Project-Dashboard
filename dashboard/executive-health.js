// Executive Summary: Reported Health vs. the Computed Risk Signal.
//
// Reported Health (the red/yellow/green chosen by the PM/manager in Confluence) and the Computed Risk
// Signal (an independent, deterministic, rule-based score; not AI) are always shown side by side and never
// merged. Nothing here changes Reported Health. Scoring lives in health_model.py + health_model_config.json; classification,
// trend and alerts live in health-model.js.
(function () {
  "use strict";

  const H = window.EPLHealth;
  if (!H || !document.getElementById("chSetup")) {
    return;
  }

  const view = {
    config: null,
    rows: [],
    today: new Date(),
    sample: false,
    sampleDate: "",
    tile: "",
    sortKey: "priority",
    sortDir: "asc",
    showAll: false,
    lastFocus: null,
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const isNum = (value) => typeof value === "number" && Number.isFinite(value);
  const fmt = (value, suffix = "") => (isNum(value) ? `${value}${suffix}` : "—");

  // ---------- badges ----------

  function computedBadge(statusKey) {
    const meta = H.statusMeta(statusKey, view.config);
    return `<span class="ch-badge" style="--ch-color:${esc(meta.color)}"><span aria-hidden="true">${esc(meta.icon)}</span> ${esc(meta.label)}</span>`;
  }

  function reportedBadge(status) {
    const label = status || "Unknown";
    const key = String(label).toLowerCase();
    const cls = key === "green" ? "status-green" : key === "yellow" ? "status-yellow" : key === "red" ? "status-red" : key === "unknown" ? "status-unknown" : "status-other";
    const icon = key === "green" ? "✔" : key === "yellow" ? "▲" : key === "red" ? "✖" : "";
    return `<span class="status-pill ${cls}">${icon ? `<span aria-hidden="true">${icon}</span> ` : ""}${esc(label)}</span>`;
  }

  function alignmentBadge(id) {
    const meta = H.alignmentMeta(id, view.config);
    return `<span class="ch-align ch-align-${esc(meta.tone)}" title="${esc(meta.description)}"><span aria-hidden="true">${esc(meta.icon)}</span> ${esc(meta.label)}</span>`;
  }

  function trendText(row) {
    const change = row.trend.scoreChange;
    if (!isNum(change)) return `<span class="ch-muted">No trend available</span>`;
    if (change === 0) return `<span aria-hidden="true">►</span> No change`;
    return change < 0
      ? `<span class="ch-down"><span aria-hidden="true">▼</span> Down ${Math.abs(change)}</span>`
      : `<span class="ch-up"><span aria-hidden="true">▲</span> Up ${change}</span>`;
  }

  const SCORE_TIP = {
    overall: "Computed Overall Health: weighted sum of all 12 dimensions (each rated 0–4), normalized to 0–100. Shown only when every dimension is assessed.",
    project: "Computed Project Health: the 7 project dimensions (60% of overall), normalized to 0–100. Shown only when all 7 are assessed.",
    client: "Computed Client Health: the 5 client dimensions (40% of overall), normalized to 0–100. Shown only when all 5 are assessed.",
  };

  function scoreCell(value, kind) {
    return isNum(value)
      ? `<span title="${esc(SCORE_TIP[kind])}">${value}</span>`
      : `<span class="ch-muted" title="Not scored: the assessment is incomplete. Missing data is never treated as zero.">—</span>`;
  }

  // ---------- setup ----------

  function loadRows(projects, history) {
    const ctx = { config: view.config, history: (history && history.projects) || {}, today: view.today };
    return projects.map((project) => H.buildRow(project, ctx));
  }

  async function loadSample() {
    const response = await fetch("../tests/fixtures/computed_health_sample.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`sample fixture not found (${response.status})`);
    return response.json();
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    let projects = [];
    let history = window.COMPUTED_HEALTH_HISTORY_DATA || { projects: {} };
    const payload = window.PROJECT_DASHBOARD_DATA || {};
    view.config = payload.health_model || null;

    if (params.get("sample") === "computed-health") {
      try {
        const sample = await loadSample();
        view.sample = true;
        view.config = sample.health_model;
        view.today = new Date(`${sample.referenceDate}T12:00:00`);
        view.sampleDate = sample.referenceDate;
        projects = sample.projects;
        history = sample.history;
      } catch (error) {
        console.warn("[Computed Risk Signal] sample data unavailable:", error.message);
      }
    }
    if (!view.sample) {
      projects = (typeof state !== "undefined" && state && state.projects) || payload.projects || [];
    }

    if (!view.config) {
      // Model config missing (data not regenerated yet): hide the Computed Risk Signal panels entirely.
      $("computedHealthSection").hidden = true;
      bindDrawer();
      return;
    }

    applyStatusColors();
    view.rows = loadRows(projects, history);
    $("chSampleBanner").hidden = !view.sample;
    if (view.sample) {
      $("chSampleBanner").textContent = `SAMPLE DATA — every project in the Computed Risk Signal sections below is a made-up test project (reference date ${view.sampleDate}). It is not production data.`;
    }
    bindDrawer();
    bindControls();
    populateFilters();
    render();

    const projectId = params.get("project");
    if (projectId) {
      $("chDetail").open = true;
      openDrawer(projectId);
    }
  }

  function applyStatusColors() {
    Object.entries(view.config.statuses).forEach(([key, meta]) => {
      document.documentElement.style.setProperty(`--ch-${key}`, meta.color);
    });
  }

  // ---------- filtering / sorting ----------

  function activeFilters() {
    const value = (id) => ($(id) ? $(id).value : "");
    const filters = {
      search: value("chSearch").trim().toLowerCase(),
      reported: value("chFilterReported"),
      computed: value("chFilterComputed"),
      alignment: value("chFilterAlignment"),
      stage: value("chFilterStage"),
      owner: value("chFilterOwner"),
      completeness: value("chFilterComplete"),
      freshness: value("chFilterFresh"),
      cpBand: value("chFilterCp"),
      overdue: $("chFilterOverdue").checked,
      major: $("chFilterMajor").checked,
    };
    filters.anyActive = Boolean(filters.search || filters.reported || filters.computed || filters.alignment || filters.stage || filters.owner ||
      filters.completeness || filters.freshness || filters.cpBand || filters.overdue || filters.major);
    return filters;
  }

  function matchesFilters(row, f) {
    const c = row.computed;
    const cp = c.controlPoint || {};
    if (f.search && !row.title.toLowerCase().includes(f.search)) return false;
    if (f.reported) {
      const key = row.reported.key || "other";
      if (key !== f.reported) return false;
    }
    if (f.computed && c.overallStatus !== f.computed) return false;
    if (f.alignment && row.alignment !== f.alignment) return false;
    if (f.stage && c.currentStage !== f.stage) return false;
    if (f.owner && (c.recovery && c.recovery.owner) !== f.owner) return false;
    if (f.completeness === "complete" && !c.complete) return false;
    if (f.completeness === "incomplete" && c.complete) return false;
    if (f.freshness === "stale" && !row.stale) return false;
    if (f.freshness === "current" && (row.stale || !c.assessed)) return false;
    if (f.freshness === "none" && c.assessed) return false;
    if (f.cpBand) {
      const pct = cp.compliancePercent;
      if (f.cpBand === "none" && isNum(pct)) return false;
      if (f.cpBand !== "none" && !isNum(pct)) return false;
      if (f.cpBand === "low" && !(pct < 75)) return false;
      if (f.cpBand === "mid" && !(pct >= 75 && pct < 90)) return false;
      if (f.cpBand === "high" && !(pct >= 90)) return false;
    }
    if (f.overdue && !(isNum(cp.overdueSignoffs) && cp.overdueSignoffs > 0)) return false;
    if (f.major && !(isNum(cp.majorFindings) && cp.majorFindings > 0)) return false;
    if (view.tile) {
      const tile = findTile(view.tile);
      if (tile && !tile.test(row)) return false;
    } else if (!view.showAll && !f.anyActive && !H.isException(row, view.today)) {
      return false; // default view: exceptions only
    }
    return true;
  }

  function findTile(id) {
    return H.exceptionTiles().concat(H.alignmentTiles()).find((t) => t.id === id);
  }

  const SORT_KEYS = {
    priority: null,
    project: (r) => r.title.toLowerCase(),
    reported: (r) => ({ green: 0, yellow: 1, red: 2 })[r.reported.key] ?? 3,
    computed: (r) => (r.computed.overallStatus === "gray" ? null : ["green", "yellow", "orange", "red"].indexOf(r.computed.overallStatus)),
    overall: (r) => r.computed.overallScore,
    projectScore: (r) => r.computed.projectScore,
    clientScore: (r) => r.computed.clientScore,
    change: (r) => r.trend.scoreChange,
    date: (r) => r.computed.assessmentDate,
    completeness: (r) => r.computed.completenessPercent,
    stage: (r) => r.computed.currentStage || null,
    cp: (r) => (r.computed.controlPoint || {}).compliancePercent,
    overdue: (r) => (r.computed.controlPoint || {}).overdueSignoffs,
    major: (r) => (r.computed.controlPoint || {}).majorFindings,
    owner: (r) => (r.computed.recovery && r.computed.recovery.owner) || null,
    alignment: (r) => r.alignment,
  };

  function sortedRows(rows) {
    const list = rows.slice();
    if (view.sortKey === "priority") {
      list.sort(H.comparePriority);
      return view.sortDir === "desc" ? list.reverse() : list;
    }
    const keyFn = SORT_KEYS[view.sortKey];
    const dir = view.sortDir === "desc" ? -1 : 1;
    list.sort((a, b) => {
      const av = keyFn(a);
      const bv = keyFn(b);
      const aNull = av === null || av === undefined || av === "";
      const bNull = bv === null || bv === undefined || bv === "";
      if (aNull && bNull) return a.title.localeCompare(b.title);
      if (aNull) return 1; // blanks always last
      if (bNull) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return cmp * dir || a.title.localeCompare(b.title);
    });
    return list;
  }

  // ---------- rendering ----------

  function render() {
    const m = H.portfolioMeasures(view.rows);
    view.measures = m;
    const scored = m.total - m.incomplete;
    view.hasData = scored > 0;
    $("chSetup").hidden = view.hasData;
    $("chSummary").hidden = !view.hasData;
    $("chDetail").hidden = !view.hasData;
    if (!view.hasData) {
      renderSetup(m);
      return;
    }
    renderExceptions();
    renderCategories();
    renderCards();
    renderTable();
    renderCharts();
    renderAlerts();
  }

  // ---------- setup-in-progress (no complete assessments yet) ----------

  function renderSetup(m) {
    const scored = m.total - m.incomplete;
    const pct = m.total ? Math.round((scored / m.total) * 100) : 0;
    const started = view.rows.filter((r) => r.computed.assessed && !r.computed.complete).length;
    $("chSetup").innerHTML = `
      <div class="ch-setup">
        <h3 class="ch-setup-title">Computed Risk Signal: Setup in Progress</h3>
        <p><strong>${scored} of ${m.total} active projects</strong> have enough structured information to calculate a score. Reported Health remains the official project status. Once assessments are complete, this section will identify hidden risk, declining health, Control Point issues, overdue sign-offs, and differences between project and client health.</p>
        <dl class="ch-stats ch-setup-stats">
          <div class="ch-stat"><dt>Scored projects</dt><dd>${scored}</dd></div>
          <div class="ch-stat"><dt>Total active projects</dt><dd>${m.total}</dd></div>
          <div class="ch-stat"><dt>Readiness</dt><dd>${pct}%</dd></div>
          ${started ? `<div class="ch-stat"><dt>Partly assessed</dt><dd>${started}</dd></div>` : ""}
        </dl>
        <div class="ch-progress" role="progressbar" aria-label="Computed Risk Signal readiness: projects with a complete assessment" aria-valuemin="0" aria-valuemax="${m.total}" aria-valuenow="${scored}" aria-valuetext="${scored} of ${m.total} projects (${pct}%)">
          <span style="width:${Math.max(pct, 0)}%"></span>
        </div>
        <div class="ch-setup-actions">
          <button type="button" class="action-button action-button-secondary" id="chViewIncomplete">View Incomplete Projects</button>
          <button type="button" class="action-button action-button-secondary" id="chViewFields">View Required Confluence Fields</button>
        </div>
      </div>`;
    $("chViewIncomplete").addEventListener("click", showIncompleteList);
    $("chViewFields").addEventListener("click", showRequiredFields);
  }

  function showIncompleteList() {
    const rows = view.rows
      .filter((r) => !r.computed.complete)
      .sort((a, b) => {
        const ad = H.daysToGoLive(a, view.today);
        const bd = H.daysToGoLive(b, view.today);
        return (ad === null) - (bd === null) || (ad || 0) - (bd || 0) || a.title.localeCompare(b.title);
      });
    const missingText = (r) => {
      const missing = Object.values(r.computed.dimensions || {}).filter((d) => d.rating === null).map((d) => d.fieldLabel);
      const total = Object.keys(r.computed.dimensions || {}).length;
      if (missing.length === total) return `All ${total} ratings`;
      return `${missing.length} of ${total}: ${missing.join(", ")}`;
    };
    const fmtDate = (r) => (typeof formatGoLiveDate === "function" ? formatGoLiveDate(r.project.go_live) : r.project.go_live || "—");
    const body = `
      <p class="ch-lede">${rows.length} projects are missing required Computed Risk Signal fields. Sorted by go-live date. Reported Health is the official status.</p>
      <div class="table-wrap"><table class="ch-dim-table ch-incomplete-table"><thead><tr>
        <th scope="col">Project</th><th scope="col">Reported project</th><th scope="col">Reported client</th><th scope="col">Completeness</th><th scope="col">Missing required fields</th><th scope="col">PM</th><th scope="col">IM</th><th scope="col">Go-live</th></tr></thead><tbody>
        ${rows.map((r) => `<tr>
          <th scope="row">${r.project.url && !r.project._sample ? `<a href="${esc(r.project.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title)}</th>
          <td>${reportedBadge(r.reported.projectStatus)}</td><td>${reportedBadge(r.reported.clientStatus)}</td>
          <td class="ch-num">${r.computed.completenessPercent}%</td><td>${esc(missingText(r))}</td>
          <td>${esc(r.project.project_manager || "—")}</td><td>${esc(r.project.implementation_manager || "—")}</td><td>${esc(fmtDate(r))}</td></tr>`).join("")}
      </tbody></table></div>`;
    showDrawer(`Projects awaiting a Computed Risk Signal (${rows.length})`, body);
  }

  function showRequiredFields() {
    const f = H.requiredFields(view.config);
    const list = (items) => `<ul>${items.map((i) => `<li><strong>${esc(i.label)}</strong>${i.meaning ? ` <span class="ch-muted">— ${esc(i.meaning)}</span>` : ""}${i.alternates && i.alternates.length ? ` <span class="ch-small ch-muted">(also accepted: ${i.alternates.map(esc).join(", ")})</span>` : ""}${i.optional ? ` <span class="ch-small ch-muted">(optional${i.type === "flag" ? ", yes/no" : ""})</span>` : i.type === "flag" ? ` <span class="ch-small ch-muted">(yes/no)</span>` : ""}</li>`).join("")}</ul>`;
    const scale = Object.entries(view.config.ratingScale).sort((a, b) => b[0] - a[0]).map(([n, r]) => `<li><strong>${n}</strong> ${esc(r.label)} — ${esc(r.description)}</li>`).join("");
    const body = `
      <p class="ch-lede">Add these fields to the project page in Confluence, either as a header row with a value row beneath, or as label / value rows in any table. A project is scored when all 12 ratings are filled in.</p>
      <h4>Rating scale (0–4)</h4><ul>${scale}<li>Leave blank when not assessed. Blank is never treated as zero.</li></ul>
      <h4>Project ratings (60%)</h4>${list(f.projectRatings)}
      <h4>Client ratings (40%)</h4>${list(f.clientRatings)}
      <h4>Assessment details</h4>${list(f.assessment)}
      <h4>Control Point data (replaces the manual Control Point rating when present)</h4>${list(f.controlPoint)}
      <p class="ch-small ch-muted">Override keywords for Health Override: blocked go-live, critical issue, major audit failure, loss of confidence. Free-text reasons are not published on the public dashboard.</p>`;
    showDrawer("Required Confluence fields", body);
  }

  // ---------- exceptions summary (when scored projects exist) ----------

  function renderExceptions() {
    const tiles = H.exceptionTiles().map((t) => ({ ...t, count: view.rows.filter(t.test).length })).filter((t) => t.count > 0);
    const review = view.rows.filter((r) => H.needsReview(r)).length;
    const scored = view.measures.total - view.measures.incomplete;
    const avg = [view.measures.avgOverall, view.measures.avgProject, view.measures.avgClient];
    $("chExceptions").innerHTML = `
      <p class="ch-notice" role="status"><strong>${scored} of ${view.measures.total}</strong> projects have a complete Computed Risk Signal.${review ? ` <strong>${review}</strong> ${review === 1 ? "has" : "have"} a material difference from Reported Health: <span class="ch-review-tag">Management Review Recommended</span>` : ""}</p>
      ${tiles.length
        ? `<div class="ch-tiles">${tiles.map((t) => `<button type="button" class="ch-tile ch-tile-${esc(t.tone)}" data-tile="${esc(t.id)}" title="${esc(t.hint)}"><span class="ch-tile-count">${t.count}</span><span class="ch-tile-label">${esc(t.label)}</span></button>`).join("")}</div>`
        : `<p class="ch-lede">No exceptions: no hidden risk, declines, overdue sign-offs or stale assessments among scored projects.</p>`}
      ${isNum(avg[0]) ? `<p class="ch-small ch-muted">Average computed score ${avg[0]} (project ${fmt(avg[1])}, client ${fmt(avg[2])}) across ${view.measures.scoredOverall} scored projects. Averages never replace the exception counts above.</p>` : ""}`;
  }

  function renderCategories() {
    const cats = view.config.alignment.categories;
    const order = ["hidden-risk", "escalating-risk", "emerging-concern", "greater-reported-concern", "aligned", "incomplete", "not-comparable"];
    const counts = {};
    view.rows.forEach((row) => (counts[row.alignment] = (counts[row.alignment] || 0) + 1));
    $("chCategories").innerHTML = order
      .filter((id) => counts[id] && cats[id])
      .map((id) => `<li><button type="button" class="ch-cat" data-align="${esc(id)}" title="${esc(cats[id].description)}">${alignmentBadge(id)} <strong>${counts[id]}</strong></button></li>`)
      .join("");
  }

  // ---------- detailed analysis ----------

  function renderCards() {
    const m = view.measures;
    const items = [
      isNum(m.avgOverall) && ["Avg Computed Overall", m.avgOverall, `${m.scoredOverall} of ${m.total} scored`],
      isNum(m.avgProject) && ["Avg Computed Project", m.avgProject, `${m.scoredProject} of ${m.total} scored`],
      isNum(m.avgClient) && ["Avg Computed Client", m.avgClient, `${m.scoredClient} of ${m.total} scored`],
      m.controlPointCompliance !== null && ["Control Point Compliance", `${m.controlPointCompliance}%`, `Average across ${m.controlPointProjects} project(s)`],
      m.incomplete > 0 && ["Incomplete Assessments", m.incomplete, "Not yet scored"],
    ].filter(Boolean);
    $("chCards").innerHTML = items.length ? `<div class="executive-grid ch-cards-grid">${items.map((c) => card(c[0], c[1], c[2], "", null)).join("")}</div>` : "";
  }

  function card(title, value, detail, tone, onClick) {
    const attrs = onClick ? `role="button" tabindex="0" data-card="${esc(onClick)}"` : "";
    return `<div class="executive-card ${tone ? `executive-card-${tone}` : ""} ch-card" ${attrs}>
      <div class="executive-card-header"><span class="executive-card-title">${esc(title)}</span></div>
      <div class="executive-card-value ch-card-value">${esc(value)}</div>
      <div class="executive-card-detail">${esc(detail)}</div></div>`;
  }

  // Columns hidden when every visible value is blank/unavailable.
  const COLUMNS = [
    { idx: 3, has: (r) => r.computed.overallStatus !== "gray" },
    { idx: 4, has: (r) => isNum(r.computed.overallScore) },
    { idx: 5, has: (r) => isNum(r.computed.projectScore) },
    { idx: 6, has: (r) => isNum(r.computed.clientScore) },
    { idx: 7, has: (r) => isNum(r.trend.scoreChange) },
    { idx: 8, has: (r) => !["incomplete", "not-comparable"].includes(r.alignment) },
    { idx: 9, has: (r) => r.computed.completenessPercent > 0 },
    { idx: 10, has: (r) => Boolean(r.computed.assessmentDate) },
  ];

  function renderTable() {
    const filters = activeFilters();
    const rows = sortedRows(view.rows.filter((row) => matchesFilters(row, filters)));
    view.visible = rows;
    const exceptionsView = !view.showAll && !filters.anyActive && !view.tile;
    $("chCount").textContent = exceptionsView
      ? `Showing ${rows.length} exception${rows.length === 1 ? "" : "s"} of ${view.rows.length} projects (differences, red/orange signals, declines, stale or incomplete near go-live).`
      : `Showing ${rows.length} of ${view.rows.length} projects`;
    $("chShowAll").textContent = view.showAll ? "Show Exceptions Only" : "Show All Projects";
    $("chShowAll").setAttribute("aria-pressed", String(view.showAll));
    const tile = view.tile ? findTile(view.tile) : null;
    $("chTileNote").hidden = !tile;
    if (tile) $("chTileNote").querySelector("span").textContent = `Filtered: ${tile.label}`;

    document.querySelectorAll("#chTable th[data-sort]").forEach((th) => {
      const active = th.dataset.sort === view.sortKey;
      th.setAttribute("aria-sort", active ? (view.sortDir === "asc" ? "ascending" : "descending") : "none");
    });

    $("chTableBody").innerHTML = rows.length
      ? rows
          .map((row) => {
            const c = row.computed;
            return `<tr>
              <th scope="row" class="ch-project"><button type="button" class="ch-link" data-open="${esc(row.pageId)}" title="${esc(row.title)}">${esc(row.title)}</button>${H.needsReview(row) ? ` <span class="ch-review-tag" title="Material difference between Reported Health and the Computed Risk Signal">Review</span>` : ""}${c.overrideActive ? ` <span class="ch-override-flag" title="A computed override rule is active. Reported Health is unchanged.">⚑ Override</span>` : ""}${row.stale ? ` <span class="ch-stale-flag" title="Assessment older than 14 days or undated">⏱ Stale</span>` : ""}</th>
              <td>${reportedBadge(row.reported.projectStatus)}</td>
              <td>${reportedBadge(row.reported.clientStatus)}</td>
              <td>${computedBadge(c.overallStatus)}</td>
              <td class="ch-num">${scoreCell(c.overallScore, "overall")}</td>
              <td class="ch-num">${scoreCell(c.projectScore, "project")}</td>
              <td class="ch-num">${scoreCell(c.clientScore, "client")}</td>
              <td>${trendText(row)}</td>
              <td>${alignmentBadge(row.alignment)}</td>
              <td class="ch-num" title="Share of the 12 rated areas that have been assessed">${c.completenessPercent}%</td>
              <td>${esc(c.assessmentDate || "—")}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="11" class="ch-empty">${exceptionsView ? "No exceptions. Select Show All Projects to see every project." : "No projects match the current filters."}</td></tr>`;

    // Hide columns with no available values, so rows are not filled with dashes.
    const headers = document.querySelectorAll("#chTable thead th");
    COLUMNS.forEach((col) => {
      const show = !rows.length || rows.some(col.has);
      headers[col.idx].hidden = !show;
      document.querySelectorAll(`#chTableBody tr > :nth-child(${col.idx + 1})`).forEach((cell) => (cell.hidden = !show));
    });
  }

  // ---------- charts ----------

  function barList(items, total) {
    const max = Math.max(1, ...items.map((i) => i.value));
    return `<ul class="ch-bars">${items
      .map(
        (i) => `<li><span class="ch-bar-label"><span aria-hidden="true">${esc(i.icon || "")}</span> ${esc(i.label)}</span>
        <span class="ch-bar-track" aria-hidden="true"><span class="ch-bar-fill" style="width:${(i.value / max) * 100}%;background:${esc(i.color)}"></span></span>
        <span class="ch-bar-value">${i.value}${total ? ` <small>(${Math.round((i.value / total) * 100)}%)</small>` : ""}</span></li>`
      )
      .join("")}</ul>`;
  }

  function rankedList(rows, valueFn, emptyText) {
    if (!rows.length) return `<p class="ch-muted">${esc(emptyText)}</p>`;
    return `<ol class="ch-ranked">${rows
      .map((row) => `<li><button type="button" class="ch-link" data-open="${esc(row.pageId)}">${esc(row.title)}</button><span>${valueFn(row)}</span></li>`)
      .join("")}</ol>`;
  }

  function trendChartSvg() {
    const window90 = (view.config.alerts && view.config.alerts.trendWindowDays) || 90;
    const end = Date.UTC(view.today.getFullYear(), view.today.getMonth(), view.today.getDate());
    const start = end - window90 * 86400000;
    const dates = new Set();
    view.rows.forEach((row) =>
      row.series.forEach((entry) => {
        const stamp = H.parseIsoDate(entry.date);
        if (isNum(entry.overall) && stamp !== null && stamp >= start && stamp <= end) dates.add(entry.date);
      })
    );
    const days = [...dates].sort();
    if (days.length < 2) return "";
    const points = days.map((day) => {
      const values = [];
      view.rows.forEach((row) => {
        const scored = row.series.filter((e) => isNum(e.overall) && e.date <= day);
        if (scored.length) values.push(scored[scored.length - 1].overall);
      });
      return { day, value: H.average(values), n: values.length };
    });
    const w = 320, h = 140, pad = 28;
    const min = Math.min(...points.map((p) => p.value), 100) === 100 ? 0 : Math.max(0, Math.min(...points.map((p) => p.value)) - 10);
    const max = 100;
    const x = (i) => pad + (i * (w - pad * 2)) / (points.length - 1);
    const y = (v) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
    const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    const label = `Average Computed Overall Score by assessment date, ${points.map((p) => `${p.day}: ${p.value}`).join("; ")}`;
    return `<svg viewBox="0 0 ${w} ${h}" class="ch-line" role="img" aria-label="${esc(label)}">
      <line x1="${pad}" y1="${y(85)}" x2="${w - pad}" y2="${y(85)}" class="ch-threshold"/><text x="${w - pad}" y="${y(85) - 3}" text-anchor="end" class="ch-axis">85 green</text>
      <line x1="${pad}" y1="${y(55)}" x2="${w - pad}" y2="${y(55)}" class="ch-threshold"/><text x="${w - pad}" y="${y(55) - 3}" text-anchor="end" class="ch-axis">55 red</text>
      <path d="${path}" class="ch-line-path"/>
      ${points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" class="ch-line-dot"><title>${esc(p.day)}: average ${p.value} across ${p.n} project(s)</title></circle>`).join("")}
      <text x="${pad}" y="${h - 8}" class="ch-axis">${esc(days[0])}</text><text x="${w - pad}" y="${h - 8}" text-anchor="end" class="ch-axis">${esc(days[days.length - 1])}</text>
    </svg><p class="ch-muted ch-small">Average of each project's latest Computed Overall Score. Projects that have not been scored are excluded, not counted as zero.</p>`;
  }

  function renderCharts() {
    const cfg = view.config;
    const m = H.portfolioMeasures(view.rows);
    const total = m.total;
    const comp = [
      { label: "Green", value: m.computedGreen, ...pick("green") },
      { label: "Yellow", value: m.computedYellow, ...pick("yellow") },
      { label: "Orange", value: m.computedOrange, ...pick("orange") },
      { label: "Red", value: m.computedRed, ...pick("red") },
      { label: "Incomplete", value: total - m.computedGreen - m.computedYellow - m.computedOrange - m.computedRed, ...pick("gray") },
    ];
    function pick(key) {
      return { color: cfg.statuses[key].color, icon: cfg.statuses[key].icon };
    }
    const counts = {};
    view.rows.forEach((row) => (counts[row.alignment] = (counts[row.alignment] || 0) + 1));
    const align = Object.entries(cfg.alignment.categories).map(([id, meta]) => ({
      label: meta.label,
      value: counts[id] || 0,
      icon: meta.icon,
      color: { ok: "#0f7b4f", warn: "#a06a00", critical: "#c53030", info: "#002f5f", muted: "#5b6472" }[meta.tone],
    }));

    const declining = view.rows.filter((r) => isNum(r.trend.scoreChange) && r.trend.scoreChange < 0).sort((a, b) => a.trend.scoreChange - b.trend.scoreChange).slice(0, 5);
    const gaps = view.rows.filter((r) => isNum(r.clientGap) && r.clientGap !== 0).sort((a, b) => Math.abs(b.clientGap) - Math.abs(a.clientGap)).slice(0, 5);
    const overdue = view.rows
      .filter((r) => r.computed.controlPoint && ((r.computed.controlPoint.overdueSignoffs || 0) > 0 || r.computed.controlPoint.bypassed))
      .sort((a, b) => (b.computed.controlPoint.maxDaysOverdue || 0) - (a.computed.controlPoint.maxDaysOverdue || 0) || (b.computed.controlPoint.overdueSignoffs || 0) - (a.computed.controlPoint.overdueSignoffs || 0))
      .slice(0, 5);

    const trendSvg = trendChartSvg();
    const charts = [
      `<div class="ch-chart"><h3>Computed Risk Signal distribution</h3>${barList(comp, total)}</div>`,
      `<div class="ch-chart"><h3>Reported Status vs. Computed Signal</h3>${barList(align.filter((a) => a.value > 0), total)}</div>`,
      trendSvg && `<div class="ch-chart"><h3>Computed Risk Signal trend (90 days)</h3>${trendSvg}</div>`,
      declining.length && `<div class="ch-chart"><h3>Top 5 declining projects</h3>${rankedList(declining, (r) => trendText(r), "")}</div>`,
      gaps.length && `<div class="ch-chart"><h3>Top 5 Project vs. Client gaps</h3>${rankedList(gaps, (r) => `${r.clientGap > 0 ? "Client" : "Project"} lower by ${Math.abs(r.clientGap)} pts <small>(P ${r.computed.projectScore} / C ${r.computed.clientScore})</small>`, "")}</div>`,
      overdue.length && `<div class="ch-chart"><h3>Top 5 overdue Control Points / sign-offs</h3>${rankedList(overdue, (r) => { const cp = r.computed.controlPoint; return cp.bypassed ? "Mandatory Control Point bypassed" : `${cp.overdueSignoffs} overdue${cp.maxDaysOverdue ? `, up to ${cp.maxDaysOverdue} business days` : ""}`; }, "")}</div>`,
    ].filter(Boolean);
    $("chCharts").innerHTML = charts.join("");
  }

  function renderAlerts() {
    const all = view.rows.flatMap((row) => row.alerts);
    const groups = [
      ["critical", "Critical", "🔴"],
      ["warning", "Warning", "⚠️"],
      ["trending", "Trending", "📈"],
    ];
    $("chAlertSummary").textContent = !all.length ? "" : `${all.filter((a) => a.severity === "critical").length} critical, ${all.filter((a) => a.severity === "warning").length} warning, ${all.filter((a) => a.severity === "trending").length} trending. Alerts never change Reported Health.`;
    $("chAlerts").innerHTML = all.length
      ? groups
          .map(([severity, label, icon]) => {
            const items = all.filter((a) => a.severity === severity);
            if (!items.length) return "";
            return `<details class="ch-alert-group" ${severity === "critical" ? "open" : ""}>
          <summary><span aria-hidden="true">${icon}</span> ${label} <span class="ch-alert-count">${items.length}</span></summary>
          <ul class="ch-alert-list">${items.map((a) => `<li class="ch-alert ch-alert-${severity}"><strong><button type="button" class="ch-link" data-open="${esc(a.pageId)}">${esc(a.projectTitle)}</button></strong> — ${esc(a.title)}<div class="ch-muted ch-small">${esc(a.evidence)}</div></li>`).join("")}</ul>
        </details>`;
          })
          .join("")
      : `<p class="ch-muted">No computed alerts.</p>`;
  }

  // ---------- drawer ----------

  function openDrawer(pageId) {
    const row = view.rows.find((r) => r.pageId === String(pageId));
    if (!row) return;
    const c = row.computed;
    const cp = c.controlPoint || {};
    const cfg = view.config;
    const mismatch = H.mismatchMessage(row, cfg);
    const dimRows = Object.entries(c.dimensions || {})
      .map(([key, d]) => `<tr><th scope="row">${esc(d.label)}</th><td class="ch-num">${d.weight}%</td><td>${d.rating === null || d.rating === undefined ? "Not assessed" : `${d.rating} — ${esc(d.ratingLabel)}`}${d.source === "structured" ? ` <small class="ch-muted">(calculated from Control Point data)</small>` : ""}</td><td class="ch-num">${d.contribution === null || d.contribution === undefined ? "—" : `${d.contribution} / ${d.maxContribution}`}</td></tr>`)
      .join("");
    const overrides = (c.overrides || []).length
      ? `<ul>${c.overrides.map((o) => `<li><strong>${esc(o.label)}</strong><div class="ch-small ch-muted">${esc(o.evidence)}${o.effect === "client-red-overall-max-orange" ? " Effect: Computed Client Health Red; Overall no better than Orange." : " Effect: Computed Overall Health Red."}</div></li>`).join("")}</ul>${c.complete ? "" : `<p class="ch-small ch-muted">Status is shown as Incomplete until all dimensions are assessed.</p>`}<p class="ch-small ch-muted">Overrides never change Reported Health.</p>`
      : `<p class="ch-muted">No override rule is active.</p>`;
    const factors = (c.topFactors || []).length
      ? `<ol>${c.topFactors.map((f) => `<li>${esc(f.label)} — ${esc(f.ratingLabel)} (${f.rating} of 4), −${f.pointsLost} points</li>`).join("")}</ol>`
      : `<p class="ch-muted">No factors are reducing the score${c.assessed ? "" : " (not assessed)"}.</p>`;
    const dq = (c.dataQuality || []).length ? `<p class="ch-small ch-muted">Data-quality notes: ${c.dataQuality.map((d) => `${esc(d.field)} (${esc(d.issue)})`).join(", ")}.</p>` : "";
    const stat = (label, value) => `<div class="ch-stat"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;

    const bodyHtml = `
      ${H.needsReview(row) ? `<p><span class="ch-review-tag">Management Review Recommended</span></p>` : ""}
      ${mismatch ? `<p class="ch-mismatch" role="note">${esc(mismatch)}</p>` : ""}
      <h3>Reported Health <span class="ch-small ch-muted">(from Confluence, selected by the PM/manager)</span></h3>
      <dl class="ch-stats">
        ${stat("Reported Health", reportedBadge(row.reported.status))}
        ${stat("Reported Project Health", reportedBadge(row.reported.projectStatus))}
        ${stat("Reported Client Health", reportedBadge(row.reported.clientStatus))}
      </dl>
      <p class="ch-notes"><strong>Project Health Notes:</strong> ${esc(row.reported.projectNotes) || '<span class="ch-muted">None</span>'}</p>
      <p class="ch-notes"><strong>Client Health Notes:</strong> ${esc(row.reported.clientNotes) || '<span class="ch-muted">None</span>'}</p>

      <h3>Computed Risk Signal <span class="ch-small ch-muted">(independent, calculated from structured data)</span></h3>
      <dl class="ch-stats">
        ${stat("Computed status", computedBadge(c.overallStatus))}
        ${stat("Overall score", scoreCell(c.overallScore, "overall"))}
        ${stat("Project score", `${scoreCell(c.projectScore, "project")} ${c.projectScore !== null && c.projectScore !== undefined ? computedBadge(c.projectStatus) : ""}`)}
        ${stat("Client score", `${scoreCell(c.clientScore, "client")} ${c.clientScore !== null && c.clientScore !== undefined ? computedBadge(c.clientStatus) : ""}`)}
        ${stat("Change since prior assessment", trendText(row))}
        ${stat("Alignment (overall)", alignmentBadge(row.alignment))}
        ${stat("Alignment (client)", alignmentBadge(row.clientAlignment))}
        ${stat("Assessment date", esc(c.assessmentDate || "Not dated") + (row.daysSinceAssessment !== null ? ` <small class="ch-muted">(${row.daysSinceAssessment} days ago${row.stale ? ", stale" : ""})</small>` : ""))}
        ${stat("Completeness", `${c.completenessPercent}% (${c.assessedDimensions || 0} of ${Object.keys(c.dimensions || {}).length || 12})`)}
        ${stat("Confidence", esc({ high: "High", medium: "Medium — data-quality notes", low: "Low — incomplete or undated", none: "None — not assessed" }[c.confidence] || "None — not assessed"))}
        ${stat("Current implementation stage", esc(c.currentStage || "Not provided"))}
      </dl>
      ${(c.missingDimensions || []).length ? `<p><strong>Missing dimensions:</strong> ${c.missingDimensions.map((k) => esc((c.dimensions[k] && c.dimensions[k].label) || k)).join("; ")}.</p>` : ""}
      ${dq}
      <h4>Top factors affecting the computed score</h4>${factors}
      <h4>Active override</h4>${overrides}
      <h4>Dimensions</h4>
      <div class="table-wrap"><table class="ch-dim-table"><thead><tr><th scope="col">Dimension</th><th scope="col">Weight</th><th scope="col">Rating (0–4)</th><th scope="col">Contribution</th></tr></thead><tbody>${dimRows || `<tr><td colspan="4" class="ch-muted">No dimensions assessed.</td></tr>`}</tbody></table></div>

      <h4>Control Points, sign-offs, and audit</h4>
      <dl class="ch-stats">
        ${stat("Control Point compliance", fmt(cp.compliancePercent, "%"))}
        ${stat("Artifact completion", fmt(cp.artifactCompletionPercent, "%"))}
        ${stat("Sign-off compliance", fmt(cp.signOffCompliancePercent, "%"))}
        ${stat("Audit compliance", fmt(cp.auditCompliancePercent, "%"))}
        ${stat("Corrective-action closure", fmt(cp.correctiveActionClosurePercent, "%"))}
        ${stat("Overdue sign-offs", cp.overdueSignoffs === null || cp.overdueSignoffs === undefined ? "—" : `${cp.overdueSignoffs}${cp.maxDaysOverdue ? ` (up to ${cp.maxDaysOverdue} business days)` : ""}`)}
        ${stat("Audit findings", `Major: ${fmt(cp.majorFindings)} · Minor: ${fmt(cp.minorFindings)}`)}
        ${stat("Rating source", esc(cp.ratingSource === "structured" ? "Calculated from structured data" : cp.ratingSource === "manual" ? "Manual rating" : "Not assessed"))}
      </dl>

      <h4>Recovery</h4>
      <dl class="ch-stats">
        ${stat("Recovery owner", esc((c.recovery && c.recovery.owner) || "Not assigned"))}
        ${stat("Recovery target date", esc((c.recovery && c.recovery.targetDate) || "Not set"))}
      </dl>
      ${row.alerts.length ? `<h4>Alerts</h4><ul>${row.alerts.map((a) => `<li><strong>${esc(a.title)}</strong><div class="ch-small ch-muted">${esc(a.evidence)}</div></li>`).join("")}</ul>` : ""}
      <p class="ch-small ch-muted">Computed Risk Signal supports management judgment; it is not the official project status. Public dashboard shows scores, statuses, dates, counts and generalized drivers only.</p>
      ${row.project.url && !row.project._sample ? `<p><a href="${esc(row.project.url)}" target="_blank" rel="noopener">Open Confluence project page</a></p>` : ""}`;
    showDrawer(row.title, bodyHtml);
  }

  function showDrawer(title, html) {
    view.lastFocus = document.activeElement;
    $("chDrawerTitle").textContent = title;
    $("chDrawerBody").innerHTML = html;
    $("chDrawerBody").scrollTop = 0;
    $("chDrawer").hidden = false;
    $("chBackdrop").hidden = false;
    document.body.classList.add("ch-drawer-open");
    $("chDrawerClose").focus();
  }

  function closeDrawer() {
    $("chDrawer").hidden = true;
    $("chBackdrop").hidden = true;
    document.body.classList.remove("ch-drawer-open");
    if (view.lastFocus && view.lastFocus.focus) view.lastFocus.focus();
  }

  // ---------- controls ----------

  function optionList(values) {
    return values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  }

  function populateFilters() {
    const stages = [...new Set(view.rows.map((r) => r.computed.currentStage).filter(Boolean))].sort();
    const owners = [...new Set(view.rows.map((r) => r.computed.recovery && r.computed.recovery.owner).filter(Boolean))].sort();
    $("chFilterStage").insertAdjacentHTML("beforeend", optionList(stages));
    $("chFilterOwner").insertAdjacentHTML("beforeend", optionList(owners));
    $("chFilterAlignment").insertAdjacentHTML(
      "beforeend",
      Object.entries(view.config.alignment.categories).map(([id, meta]) => `<option value="${esc(id)}">${esc(meta.label)}</option>`).join("")
    );
  }

  function setSort(key) {
    if (view.sortKey === key) {
      view.sortDir = view.sortDir === "asc" ? "desc" : "asc";
    } else {
      view.sortKey = key;
      view.sortDir = ["overall", "projectScore", "clientScore", "change", "cp", "completeness"].includes(key) ? "asc" : "asc";
    }
    $("chSort").value = view.sortKey;
    $("chSortDir").textContent = view.sortDir === "asc" ? "Ascending" : "Descending";
    renderTable();
  }

  function toCsv(rows) {
    if (!rows.length) return "";
    const data = rows.map((r) => H.csvRow(r, view.config));
    const headers = Object.keys(data[0]);
    const cell = (value) => {
      let s = String(value === null || value === undefined ? "" : value);
      if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // avoid spreadsheet formula injection
      return `"${s.replace(/"/g, '""')}"`;
    };
    return [headers.join(",")].concat(data.map((row) => headers.map((h) => cell(row[h])).join(","))).join("\n");
  }

  function exportCsv() {
    const csv = toCsv(view.visible || []);
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = view.sample ? "sample-reported-vs-computed-health.csv" : "reported-vs-computed-health.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function openDetail(scroll) {
    const detail = $("chDetail");
    detail.hidden = false;
    detail.open = true;
    if (scroll) $("chTableSection").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetFilters(keepSort) {
    ["chSearch", "chFilterReported", "chFilterComputed", "chFilterAlignment", "chFilterStage", "chFilterOwner", "chFilterComplete", "chFilterFresh", "chFilterCp"].forEach((id) => ($(id).value = ""));
    $("chFilterOverdue").checked = false;
    $("chFilterMajor").checked = false;
    view.tile = "";
    if (!keepSort) {
      view.showAll = false;
      view.sortKey = "priority";
      view.sortDir = "asc";
      $("chSort").value = "priority";
      $("chSortDir").textContent = "Ascending";
    }
  }

  function bindControls() {
    ["chSearch", "chFilterReported", "chFilterComputed", "chFilterAlignment", "chFilterStage", "chFilterOwner", "chFilterComplete", "chFilterFresh", "chFilterCp", "chFilterOverdue", "chFilterMajor"].forEach((id) => {
      $(id).addEventListener(id === "chSearch" ? "input" : "change", renderTable);
    });
    $("chSort").addEventListener("change", (event) => {
      view.sortKey = event.target.value;
      renderTable();
    });
    $("chSortDir").addEventListener("click", () => {
      view.sortDir = view.sortDir === "asc" ? "desc" : "asc";
      $("chSortDir").textContent = view.sortDir === "asc" ? "Ascending" : "Descending";
      renderTable();
    });
    $("chReset").addEventListener("click", () => {
      resetFilters(false);
            renderTable();
    });
    $("chTileClear").addEventListener("click", () => {
      view.tile = "";
            renderTable();
    });
    $("chExport").addEventListener("click", exportCsv);
    document.querySelectorAll("#chTable th[data-sort] button").forEach((button) =>
      button.addEventListener("click", () => setSort(button.closest("th").dataset.sort))
    );
    $("chShowAll").addEventListener("click", () => {
      view.showAll = !view.showAll;
      renderTable();
    });
    $("chOpenDetail").addEventListener("click", () => openDetail(true));
    $("computedHealthSection").addEventListener("click", (event) => {
      const tile = event.target.closest("[data-tile]");
      if (tile) {
        resetFilters(true);
        view.tile = tile.dataset.tile;
        openDetail(true);
        renderTable();
        return;
      }
      const align = event.target.closest("[data-align]");
      if (align) {
        resetFilters(true);
        $("chFilterAlignment").value = align.dataset.align;
        view.showAll = true;
        openDetail(true);
        renderTable();
      }
    });
  }

  function bindDrawer() {
    window.EPLExecDrawer = { show: showDrawer, close: closeDrawer };
    document.addEventListener("click", (event) => {
      const open = event.target.closest("[data-open]");
      if (open) {
        if (open.closest("#chTable")) return openDrawer(open.dataset.open);
        openDetail(false);
        return openDrawer(open.dataset.open);
      }
      const clearTile = event.target.closest("#chTileClear");
      if (clearTile) return;
      if (event.target === $("chBackdrop") || event.target.closest("#chDrawerClose")) closeDrawer();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("chDrawer").hidden) closeDrawer();
      if (event.key === "Tab" && !$("chDrawer").hidden) {
        const focusable = $("chDrawer").querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])");
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  }

  // Wait for app.js to load dashboard data, exactly like executive.js does.
  let started = false;
  function start() {
    if (started) return;
    started = true;
    init().catch((error) => console.error("[Computed Risk Signal] failed to initialize:", error));
  }
  window.addEventListener("dashboardReady", start);
  if (typeof state !== "undefined" && state && state.projects && state.projects.length) start();
})();
