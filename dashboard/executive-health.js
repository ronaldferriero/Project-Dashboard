// Executive Summary: Reported vs. Computed Health.
//
// Reported Health (the red/yellow/green chosen by the PM/manager in Confluence) and Computed Health
// (an independent, deterministic score) are always shown side by side and never merged. Nothing here
// changes Reported Health. Scoring lives in health_model.py + health_model_config.json; classification,
// trend and alerts live in health-model.js.
(function () {
  "use strict";

  const H = window.EPLHealth;
  if (!H || !document.getElementById("chCards")) {
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
        console.warn("[Computed Health] sample data unavailable:", error.message);
      }
    }
    if (!view.sample) {
      projects = (typeof state !== "undefined" && state && state.projects) || payload.projects || [];
    }

    if (!view.config) {
      $("chNotice").textContent = "Computed Health has not been generated yet. Run the dashboard refresh to publish it.";
      $("chNotice").hidden = false;
      return;
    }

    applyStatusColors();
    view.rows = loadRows(projects, history);
    $("chSampleBanner").hidden = !view.sample;
    if (view.sample) {
      $("chSampleBanner").textContent = `SAMPLE DATA — every project in the Reported vs. Computed Health sections below is a made-up test project (reference date ${view.sampleDate}). It is not production data.`;
    }
    bindControls();
    populateFilters();
    render();

    const projectId = params.get("project");
    if (projectId) openDrawer(projectId);
  }

  function applyStatusColors() {
    Object.entries(view.config.statuses).forEach(([key, meta]) => {
      document.documentElement.style.setProperty(`--ch-${key}`, meta.color);
    });
  }

  // ---------- filtering / sorting ----------

  function activeFilters() {
    const value = (id) => ($(id) ? $(id).value : "");
    return {
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
      const tile = H.alignmentTiles().find((t) => t.id === view.tile);
      if (tile && !tile.test(row)) return false;
    }
    return true;
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
    renderNotice();
    renderCards();
    renderTiles();
    renderTable();
    renderCharts();
    renderAlerts();
  }

  function renderNotice() {
    const m = H.portfolioMeasures(view.rows);
    const complete = m.total - m.incomplete;
    const notice = $("chNotice");
    notice.hidden = false;
    notice.innerHTML =
      complete === 0
        ? `<strong>No projects have a complete Computed Health assessment yet.</strong> Computed Health needs all 12 dimension ratings on the Confluence page (see the field list in the README). Until then projects show as <em>Incomplete</em>; this does not affect Reported Health.`
        : `<strong>${complete} of ${m.total}</strong> projects have a complete Computed Health assessment. Incomplete assessments are shown as <em>Incomplete</em> and never affect Reported Health.`;
  }

  function card(title, value, detail, tone, onClick) {
    const attrs = onClick ? `role="button" tabindex="0" data-card="${esc(onClick)}"` : "";
    return `<div class="executive-card ${tone ? `executive-card-${tone}` : ""} ch-card" ${attrs}>
      <div class="executive-card-header"><span class="executive-card-title">${esc(title)}</span></div>
      <div class="executive-card-value ch-card-value">${esc(value)}</div>
      <div class="executive-card-detail">${esc(detail)}</div></div>`;
  }

  function renderCards() {
    const m = H.portfolioMeasures(view.rows);
    const of = (n, label) => `${n} of ${m.total} ${label}`;
    const cards = [
      ["Reported Green", m.reportedGreen, "Confluence status", "success", null],
      ["Reported Yellow", m.reportedYellow, "Confluence status", "warning", null],
      ["Reported Red", m.reportedRed, "Confluence status", "critical", null],
      ["Computed Green", m.computedGreen, "Score 85–100", "success", "computed:green"],
      ["Computed Yellow", m.computedYellow, "Score 70–84", "warning", "computed:yellow"],
      ["Computed Orange", m.computedOrange, "Score 55–69", "orange", "computed:orange"],
      ["Computed Red", m.computedRed, "Score below 55 or override", "critical", "computed:red"],
      ["Incomplete Assessments", m.incomplete, "Not enough data to score", "", "tile:incomplete"],
      ["Avg Computed Overall", fmt(m.avgOverall), of(m.scoredOverall, "scored — the average never hides red/orange counts"), "", null],
      ["Avg Computed Project", fmt(m.avgProject), of(m.scoredProject, "scored"), "", null],
      ["Avg Computed Client", fmt(m.avgClient), of(m.scoredClient, "scored"), "", null],
      ["Declining 10+ Points", m.declining, "Since prior assessment", m.declining ? "warning" : "", "tile:declined"],
      ["Control Point Compliance", m.controlPointCompliance === null ? "—" : `${m.controlPointCompliance}%`, m.controlPointProjects ? `Average across ${m.controlPointProjects} project(s) with data` : "No structured Control Point data yet", "", null],
      ["Overdue Sign-Offs", m.overdueSignoffs, "Across assessed projects", m.overdueSignoffs ? "warning" : "", "overdue"],
      ["Open Major Audit Findings", m.openMajorFindings, "Across assessed projects", m.openMajorFindings ? "critical" : "", "major"],
      ["Assessments Older Than 14 Days", m.stale, "Stale or undated", m.stale ? "warning" : "", "tile:stale"],
      ["Hidden Risk Projects", m.hiddenRisk, "Reported Green, Computed Orange/Red", m.hiddenRisk ? "critical" : "", "align:hidden-risk"],
    ];
    const groups = [
      ["Reported Health", "Chosen by the project team in Confluence", cards.slice(0, 3)],
      ["Computed Health", "Independent score, by status. Click a card to filter the table.", cards.slice(3, 8)],
      ["Average scores", "Averages only cover scored projects, so also check the red/orange counts above.", cards.slice(8, 12)],
      ["Controls and follow-up", "Control Points, sign-offs, audit findings and freshness", cards.slice(12)],
    ];
    $("chCards").innerHTML = groups
      .map(([title, hint, items]) => `<div class="ch-group"><h3 class="ch-group-title">${esc(title)} <span class="ch-muted ch-small">${esc(hint)}</span></h3><div class="executive-grid ch-cards-grid">${items.map((c) => card(c[0], c[1], c[2], c[3], c[4])).join("")}</div></div>`)
      .join("");
  }

  function renderTiles() {
    const tiles = H.alignmentTiles();
    $("chTiles").innerHTML = tiles
      .map((tile) => {
        const count = view.rows.filter(tile.test).length;
        const active = view.tile === tile.id;
        return `<button type="button" class="ch-tile ${active ? "is-active" : ""}" data-tile="${esc(tile.id)}" aria-pressed="${active}">
          <span class="ch-tile-count">${count}</span><span class="ch-tile-label">${esc(tile.label)}</span></button>`;
      })
      .join("");

    const cats = view.config.alignment.categories;
    const counts = {};
    view.rows.forEach((row) => (counts[row.alignment] = (counts[row.alignment] || 0) + 1));
    $("chCategories").innerHTML = Object.entries(cats)
      .map(([id, meta]) => `<li><button type="button" class="ch-cat" data-align="${esc(id)}" title="${esc(meta.description)}">${alignmentBadge(id)} <strong>${counts[id] || 0}</strong></button></li>`)
      .join("");
  }

  function renderTable() {
    const filters = activeFilters();
    const rows = sortedRows(view.rows.filter((row) => matchesFilters(row, filters)));
    view.visible = rows;
    $("chCount").textContent = `Showing ${rows.length} of ${view.rows.length} projects`;
    const tile = H.alignmentTiles().find((t) => t.id === view.tile);
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
              <th scope="row" class="ch-project"><button type="button" class="ch-link" data-open="${esc(row.pageId)}">${esc(row.title)}</button>${c.overrideActive ? ` <span class="ch-override-flag" title="A computed override rule is active. Reported Health is unchanged.">⚑ Override</span>` : ""}${row.stale ? ` <span class="ch-stale-flag" title="Assessment older than 14 days or undated">⏱ Stale</span>` : ""}</th>
              <td>${reportedBadge(row.reported.projectStatus)}</td>
              <td>${reportedBadge(row.reported.clientStatus)}</td>
              <td>${computedBadge(c.overallStatus)}</td>
              <td class="ch-num">${scoreCell(c.overallScore, "overall")}</td>
              <td class="ch-num">${scoreCell(c.projectScore, "project")}</td>
              <td class="ch-num">${scoreCell(c.clientScore, "client")}</td>
              <td>${trendText(row)}</td>
              <td>${alignmentBadge(row.alignment)}</td>
              <td class="ch-num" title="Share of the 12 dimensions that have been assessed">${c.completenessPercent}%</td>
              <td>${esc(c.assessmentDate || "—")}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="11" class="ch-empty">No projects match the current filters.</td></tr>`;
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
    if (days.length < 2) return `<p class="ch-muted">No trend available yet. A trend line appears once projects have at least two dated assessments in the last ${window90} days.</p>`;
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
    const rep = [
      { label: "Green", value: m.reportedGreen, color: cfg.statuses.green.color, icon: cfg.statuses.green.icon },
      { label: "Yellow", value: m.reportedYellow, color: cfg.statuses.yellow.color, icon: cfg.statuses.yellow.icon },
      { label: "Red", value: m.reportedRed, color: cfg.statuses.red.color, icon: cfg.statuses.red.icon },
      { label: "Other / not rated", value: total - m.reportedGreen - m.reportedYellow - m.reportedRed, color: cfg.statuses.gray.color, icon: "–" },
    ];
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
      color: { ok: "#0f7b4f", warn: "#a06a00", critical: "#c53030", info: "#1e40af", muted: "#5b6472" }[meta.tone],
    }));

    const declining = view.rows.filter((r) => isNum(r.trend.scoreChange) && r.trend.scoreChange < 0).sort((a, b) => a.trend.scoreChange - b.trend.scoreChange).slice(0, 5);
    const gaps = view.rows.filter((r) => isNum(r.clientGap) && r.clientGap !== 0).sort((a, b) => Math.abs(b.clientGap) - Math.abs(a.clientGap)).slice(0, 5);
    const overdue = view.rows
      .filter((r) => r.computed.controlPoint && ((r.computed.controlPoint.overdueSignoffs || 0) > 0 || r.computed.controlPoint.bypassed))
      .sort((a, b) => (b.computed.controlPoint.maxDaysOverdue || 0) - (a.computed.controlPoint.maxDaysOverdue || 0) || (b.computed.controlPoint.overdueSignoffs || 0) - (a.computed.controlPoint.overdueSignoffs || 0))
      .slice(0, 5);

    $("chCharts").innerHTML = `
      <div class="ch-chart"><h3>Reported Health distribution</h3>${barList(rep, total)}</div>
      <div class="ch-chart"><h3>Computed Health distribution</h3>${barList(comp, total)}</div>
      <div class="ch-chart"><h3>Reported vs. Computed alignment</h3>${barList(align, total)}</div>
      <div class="ch-chart"><h3>Computed Health trend (90 days)</h3>${trendChartSvg()}</div>
      <div class="ch-chart"><h3>Top 5 declining projects</h3>${rankedList(declining, (r) => trendText(r), "No declining projects (or no history yet).")}</div>
      <div class="ch-chart"><h3>Top 5 Project vs. Client Health gaps</h3>${rankedList(gaps, (r) => `${r.clientGap > 0 ? "Client" : "Project"} lower by ${Math.abs(r.clientGap)} pts <small>(P ${r.computed.projectScore} / C ${r.computed.clientScore})</small>`, "No scored projects to compare yet.")}</div>
      <div class="ch-chart"><h3>Top 5 overdue Control Points / sign-offs</h3>${rankedList(overdue, (r) => { const cp = r.computed.controlPoint; return cp.bypassed ? "Mandatory Control Point bypassed" : `${cp.overdueSignoffs} overdue${cp.maxDaysOverdue ? `, up to ${cp.maxDaysOverdue} business days` : ""}`; }, "No overdue Control Points or sign-offs reported.")}</div>`;
  }

  function renderAlerts() {
    const all = view.rows.flatMap((row) => row.alerts);
    const groups = [
      ["critical", "Critical", "🔴"],
      ["warning", "Warning", "⚠️"],
      ["trending", "Trending", "📈"],
    ];
    $("chAlertSummary").textContent = `${all.filter((a) => a.severity === "critical").length} critical, ${all.filter((a) => a.severity === "warning").length} warning, ${all.filter((a) => a.severity === "trending").length} trending. Alerts never change Reported Health.`;
    $("chAlerts").innerHTML = groups
      .map(([severity, label, icon]) => {
        const items = all.filter((a) => a.severity === severity);
        return `<details class="ch-alert-group" ${severity === "critical" && items.length ? "open" : ""}>
          <summary><span aria-hidden="true">${icon}</span> ${label} <span class="ch-alert-count">${items.length}</span></summary>
          ${items.length ? `<ul class="ch-alert-list">${items.map((a) => `<li class="ch-alert ch-alert-${severity}"><strong><button type="button" class="ch-link" data-open="${esc(a.pageId)}">${esc(a.projectTitle)}</button></strong> — ${esc(a.title)}<div class="ch-muted ch-small">${esc(a.evidence)}</div></li>`).join("")}</ul>` : `<p class="ch-muted">None.</p>`}
        </details>`;
      })
      .join("");
  }

  // ---------- drawer ----------

  function openDrawer(pageId) {
    const row = view.rows.find((r) => r.pageId === String(pageId));
    if (!row) return;
    view.lastFocus = document.activeElement;
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

    $("chDrawerTitle").textContent = row.title;
    $("chDrawerBody").innerHTML = `
      ${mismatch ? `<p class="ch-mismatch" role="note">${esc(mismatch)}</p>` : ""}
      <h3>Reported Health <span class="ch-small ch-muted">(from Confluence, selected by the PM/manager)</span></h3>
      <dl class="ch-stats">
        ${stat("Reported Health", reportedBadge(row.reported.status))}
        ${stat("Reported Project Health", reportedBadge(row.reported.projectStatus))}
        ${stat("Reported Client Health", reportedBadge(row.reported.clientStatus))}
      </dl>
      <p class="ch-notes"><strong>Project Health Notes:</strong> ${esc(row.reported.projectNotes) || '<span class="ch-muted">None</span>'}</p>
      <p class="ch-notes"><strong>Client Health Notes:</strong> ${esc(row.reported.clientNotes) || '<span class="ch-muted">None</span>'}</p>

      <h3>Computed Health <span class="ch-small ch-muted">(independent, calculated from structured data)</span></h3>
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
      <p class="ch-small ch-muted">Computed Health supports management judgment; it is not the official project status. Public dashboard shows scores, statuses, dates, counts and generalized drivers only.</p>
      ${row.project.url && !row.project._sample ? `<p><a href="${esc(row.project.url)}" target="_blank" rel="noopener">Open Confluence project page</a></p>` : ""}`;
    const drawer = $("chDrawer");
    drawer.hidden = false;
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

  function applyCardAction(action) {
    const [kind, value] = action.split(":");
    resetFilters(true);
    if (kind === "computed") $("chFilterComputed").value = value;
    else if (kind === "tile") view.tile = value;
    else if (kind === "align") $("chFilterAlignment").value = value;
    else if (kind === "overdue") $("chFilterOverdue").checked = true;
    else if (kind === "major") $("chFilterMajor").checked = true;
    renderTiles();
    renderTable();
    $("chTableSection").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetFilters(keepSort) {
    ["chSearch", "chFilterReported", "chFilterComputed", "chFilterAlignment", "chFilterStage", "chFilterOwner", "chFilterComplete", "chFilterFresh", "chFilterCp"].forEach((id) => ($(id).value = ""));
    $("chFilterOverdue").checked = false;
    $("chFilterMajor").checked = false;
    view.tile = "";
    if (!keepSort) {
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
      renderTiles();
      renderTable();
    });
    $("chTileClear").addEventListener("click", () => {
      view.tile = "";
      renderTiles();
      renderTable();
    });
    $("chExport").addEventListener("click", exportCsv);
    document.querySelectorAll("#chTable th[data-sort] button").forEach((button) =>
      button.addEventListener("click", () => setSort(button.closest("th").dataset.sort))
    );
    document.addEventListener("click", (event) => {
      const open = event.target.closest("[data-open]");
      if (open) return openDrawer(open.dataset.open);
      const tile = event.target.closest("[data-tile]");
      if (tile) {
        view.tile = view.tile === tile.dataset.tile ? "" : tile.dataset.tile;
        renderTiles();
        renderTable();
        return;
      }
      const align = event.target.closest("[data-align]");
      if (align) {
        resetFilters(true);
        $("chFilterAlignment").value = align.dataset.align;
        renderTiles();
        renderTable();
        return;
      }
      const cardEl = event.target.closest("[data-card]");
      if (cardEl) return applyCardAction(cardEl.dataset.card);
      if (event.target === $("chBackdrop") || event.target.closest("#chDrawerClose")) closeDrawer();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("chDrawer").hidden) closeDrawer();
      if ((event.key === "Enter" || event.key === " ") && event.target.matches && event.target.matches("[data-card]")) {
        event.preventDefault();
        applyCardAction(event.target.dataset.card);
      }
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
    init().catch((error) => console.error("[Computed Health] failed to initialize:", error));
  }
  window.addEventListener("dashboardReady", start);
  if (typeof state !== "undefined" && state && state.projects && state.projects.length) start();
})();
