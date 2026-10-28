// Peer Compare Dashboard Logic
// Groups projects into like-for-like tiers (see peer-model.js) and benchmarks active timelines against
// completed projects in the same tier instead of the whole portfolio.

const PEER_AVG_DAYS_PER_MONTH = 30.4368;
const peerState = { overrides: {}, onHold: { accounts: new Set(), titles: new Set() }, actualStarts: {}, projects: [], closedLoaded: false, filters: { since: "2025-01-01", tier: "", line: "" } };

function peerParseDate(value) {
  const text = normalize(value);
  if (!text) return null;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (us) {
    const year = +us[3] < 100 ? 2000 + +us[3] : +us[3];
    return new Date(Date.UTC(year, +us[1] - 1, +us[2]));
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function peerMonthsBetween(start, end) {
  return (end.getTime() - start.getTime()) / 86400000 / PEER_AVG_DAYS_PER_MONTH;
}

function peerAddMonths(date, months) {
  return new Date(date.getTime() + months * PEER_AVG_DAYS_PER_MONTH * 86400000);
}

function peerIsPlaceholder(date) {
  return date.getUTCMonth() === 11 && date.getUTCDate() === 31;
}

function peerFormatDate(date) {
  return date
    ? new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(date)
    : "";
}

function peerFormatMonths(value, signed = false) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  const text = value.toFixed(1);
  return signed && value > 0 ? `+${text}` : text;
}

function buildPeerRow(project, today) {
  // data/actual_start_dates.json holds the more recent of the Confluence and worksheet (earliest PSA time entry) start dates;
  // it wins over the list's own start date.
  const actual = peerState.actualStarts[normalize(project.page_id) || project.title];
  let start = peerParseDate(actual?.actual_start_date) || peerParseDate(project.implementation_start_date);
  const goLive = peerParseDate(project.go_live);
  // A project that has gone live with no start date anywhere is given a 12 month timeline.
  const assumedStart = !start && !!goLive && goLive <= today && !peerIsPlaceholder(goLive);
  if (assumedStart) start = peerAddMonths(goLive, -ASSUMED_TTV_MONTHS);
  const value = contractValueForRow(project);
  const model = PeerModel.applyOverride(
    PeerModel.classify({
      products: normalizeList(project.contracted_products),
      value: value.complete ? value.total : null,
      hosting: project.hosting_type,
      title: project.title,
      ...PeerModel.extraInputs(project),
    }),
    peerState.overrides[normalize(project.page_id)]?.label,
  );
  const placeholder = !!goLive && peerIsPlaceholder(goLive);
  const completed = !!(start && goLive && goLive <= today && goLive >= start && !placeholder);
  return {
    project,
    start,
    assumedStart,
    actualStart: !!actual?.actual_start_date && actual.used !== "confluence",
    goLive,
    placeholder,
    completed,
    ttvMonths: completed ? peerMonthsBetween(start, goLive) : null,
    plannedMonths: start && goLive && !placeholder && goLive > start ? peerMonthsBetween(start, goLive) : null,
    contractValue: value.complete ? value.total : null,
    ...model,
  };
}

// Months of timeline assumed for a project that has gone live but has no start date.
const ASSUMED_TTV_MONTHS = 12;
const FIRST_TTV_YEAR = 2023;
// The on-hold comparison starts here; hold history (data/on_hold_history.json) only goes back to mid-2026.
const FIRST_ON_HOLD_YEAR = 2025;
const PEER_UNCLASSIFIED = "Unclassified";

function peerBuildAllRows(today) {
  return peerState.projects.map((project) => buildPeerRow(project, today));
}

function peerFilteredRows(rows, applySince = true) {
  const since = applySince ? peerParseDate(peerState.filters.since) : null;
  return rows.filter((row) => {
    if (since && (!row.start || row.start < since)) return false;
    if (peerState.filters.tier === PEER_UNCLASSIFIED ? !!row.label : !PeerModel.matchesLabel(row, peerState.filters.tier)) return false;
    if (peerState.filters.line && !row.lines.includes(peerState.filters.line)) return false;
    return true;
  });
}

function peerBadge(label, title = "") {
  if (!label) return '<span class="peer-badge peer-unclassified" title="No module or contract data">Unclassified</span>';
  return `<span class="peer-badge peer-${label.split(" ")[0].toLowerCase()}" title="${escapeHtml(title)}">${label}</span>`;
}

function peerTierBadge(row) {
  return peerBadge(row.label, row.label ? `${row.reasons.join(", ")} (score ${row.score.toFixed(2)}, ${row.confidence} confidence)` : "");
}

function peerEstimate(row, benchmark, today) {
  if (!row.start || benchmark.median === null) return null;
  const median = peerAddMonths(row.start, benchmark.median);
  if (median >= today) return { date: median, beyond: false };
  const pessimistic = peerAddMonths(row.start, benchmark.p75 ?? benchmark.median);
  const floor = peerAddMonths(today, 2);
  return { date: pessimistic > floor ? pessimistic : floor, beyond: true };
}

function peerPlanFlag(row, benchmark) {
  if (row.plannedMonths === null || benchmark.median === null) return "";
  if (benchmark.p25 !== null && row.plannedMonths < benchmark.p25) return '<span class="peer-flag peer-flag-aggressive">Aggressive</span>';
  if (benchmark.p75 !== null && row.plannedMonths > benchmark.p75) return '<span class="peer-flag peer-flag-padded">Padded</span>';
  return '<span class="peer-flag">In range</span>';
}

function renderPeerMetrics(completed, active, stats) {
  const container = document.getElementById("peerMetrics");
  if (!container) return;
  const cards = [
    { label: "Completed (peer sample)", value: completed.length },
    { label: "Median TTV (all)", value: `${peerFormatMonths(stats.all.median)} mo` },
    { label: "Average TTV (all)", value: `${peerFormatMonths(stats.all.mean)} mo` },
    { label: "Active in scope", value: active.length },
    { label: "Unclassified", value: active.filter((row) => !row.tier).length },
  ];
  container.innerHTML = cards.map((card) => `<article class="metric"><h3>${card.label}</h3><p>${card.value}</p></article>`).join("");
}

function renderPeerTierTable(scoped, completed, active, stats, today) {
  const tbody = document.querySelector("#peerTierTable tbody");
  if (!tbody) return;
  // One row per category (Low 1 .. High 3), plus projects with no module or contract data.
  const rows = [...PeerModel.levelLabels(), null].map((label) => {
    const inGroup = (row) => (label ? row.label === label : !row.label);
    const everyone = scoped.filter(inGroup);
    const done = completed.filter(inGroup);
    const live = active.filter(inGroup);
    const stat = label ? stats.byLabel[label] : PeerModel.summarize(done.map((row) => row.ttvMonths));
    const planned = PeerModel.summarize(everyone.map((row) => row.plannedMonths));
    const benchmark = PeerModel.benchmarkFor(label ? { label, tier: label.split(" ")[0], level: Number(label.split(" ")[1]) } : null, stats);
    const remaining = PeerModel.summarize(
      live
        .map((row) => peerEstimate(row, benchmark, today))
        .filter(Boolean)
        .map((estimate) => peerMonthsBetween(today, estimate.date)),
    );
    const basis = !label || benchmark.basis === label ? "" : `uses ${benchmark.basis}`;
    return `<tr>
      <td>${peerBadge(label)}</td>
      <td>${everyone.length}</td>
      <td>${done.length}</td>
      <td>${peerFormatMonths(stat.median)}</td>
      <td>${peerFormatMonths(stat.mean)}</td>
      <td>${stat.n ? `${peerFormatMonths(stat.p25)} – ${peerFormatMonths(stat.p75)}` : "—"}</td>
      <td>${planned.n ? `${peerFormatMonths(planned.median)} <small>(n=${planned.n})</small>` : "—"}</td>
      <td>${live.length}</td>
      <td>${peerFormatMonths(remaining.median)}</td>
      <td>${peerFormatMonths(remaining.mean)}</td>
      <td>${escapeHtml(basis)}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join("");
}

function renderPeerActiveTable(active, stats, today) {
  const tbody = document.querySelector("#peerActiveTable tbody");
  const count = document.getElementById("peerActiveCount");
  if (!tbody) return;
  const rows = active
    .map((row) => {
      const benchmark = PeerModel.benchmarkFor(row, stats);
      return { row, benchmark, estimate: peerEstimate(row, benchmark, today) };
    })
    .sort((a, b) => (a.estimate?.date.getTime() ?? Infinity) - (b.estimate?.date.getTime() ?? Infinity));
  if (count) count.textContent = `${rows.length} active project${rows.length === 1 ? "" : "s"}`;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12">No active projects match these filters.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(({ row, benchmark, estimate }) => {
      const elapsed = row.start ? Math.max(0, peerMonthsBetween(row.start, today)) : null;
      const variance = row.plannedMonths !== null && benchmark.median !== null ? row.plannedMonths - benchmark.median : null;
      const beyond = estimate?.beyond ? ' <small title="Already past the peer median; estimate uses the peer 75th percentile or 2 months from today">past peer median</small>' : "";
      return `<tr>
        <td><a href="${escapeHtml(row.project.url || "#")}" target="_blank">${escapeHtml(row.project.title || "Untitled")}</a></td>
        <td>${peerTierBadge(row)}</td>
        <td>${normalizeList(row.project.contracted_products).length || "—"}</td>
        <td>${row.lines.length ? escapeHtml(row.lines.join(", ")) : "—"}</td>
        <td>${row.contractValue !== null ? formatCurrency(row.contractValue) : "—"}</td>
        <td>${escapeHtml(peerFormatDate(row.start))}${row.actualStart ? ' <small title="Actual start: earliest PSA time entry">(actual)</small>' : ""}${row.assumedStart ? ' <small title="No start date on file: assumed 12 months before go-live">(assumed)</small>' : ""}</td>
        <td>${peerFormatMonths(elapsed)}</td>
        <td>${row.plannedMonths !== null ? peerFormatMonths(row.plannedMonths) : row.placeholder ? '<small title="Go-live pinned to Dec 31 (placeholder)">placeholder</small>' : "—"}</td>
        <td>${peerFormatMonths(benchmark.median)} <small>(${escapeHtml(benchmark.basis)}, n=${benchmark.n})</small></td>
        <td>${peerFormatMonths(variance, true)} ${peerPlanFlag(row, benchmark)}</td>
        <td>${estimate ? escapeHtml(peerFormatDate(estimate.date)) : "—"}${beyond}</td>
        <td>${escapeHtml(row.project.project_status || "")}</td>
      </tr>`;
    })
    .join("");
}

function renderPeerCompletedTable(completed, stats) {
  const tbody = document.querySelector("#peerCompletedTable tbody");
  const count = document.getElementById("peerCompletedCount");
  if (!tbody) return;
  const rows = [...completed].sort((a, b) => b.goLive - a.goLive);
  if (count) count.textContent = `${rows.length} completed project${rows.length === 1 ? "" : "s"}`;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6">No completed projects match these filters.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map((row) => {
      const benchmark = PeerModel.benchmarkFor(row, stats);
      const delta = benchmark.median !== null ? row.ttvMonths - benchmark.median : null;
      return `<tr>
        <td><a href="${escapeHtml(row.project.url || "#")}" target="_blank">${escapeHtml(row.project.title || "Untitled")}</a></td>
        <td>${peerTierBadge(row)}</td>
        <td>${escapeHtml(peerFormatDate(row.start))}${row.actualStart ? ' <small title="Actual start: earliest PSA time entry">(actual)</small>' : ""}${row.assumedStart ? ' <small title="No start date on file: assumed 12 months before go-live">(assumed)</small>' : ""}</td>
        <td>${escapeHtml(peerFormatDate(row.goLive))}</td>
        <td>${peerFormatMonths(row.ttvMonths)}</td>
        <td>${peerFormatMonths(delta, true)}</td>
      </tr>`;
    })
    .join("");
}

// One collapsible list per category (Low 1 .. High 3, then Unclassified), active and completed projects together.
function renderPeerCategoryLists(scoped) {
  const container = document.getElementById("peerCategoryLists");
  if (!container) return;
  container.innerHTML = [...PeerModel.levelLabels(), null]
    .map((label) => {
      const rows = scoped
        .filter((row) => (label ? row.label === label : !row.label))
        .sort((a, b) => (a.project.title || "").localeCompare(b.project.title || ""));
      if (!rows.length) return "";
      const items = rows
        .map((row) => {
          const note = row.completed ? `Live ${escapeHtml(peerFormatDate(row.goLive))}` : escapeHtml(row.project.project_status || "Active");
          return `<li><a href="${escapeHtml(row.project.url || "#")}" target="_blank">${escapeHtml(row.project.title || "Untitled")}</a> <small>${note}</small></li>`;
        })
        .join("");
      return `<details class="peer-category"><summary>${peerBadge(label)} <strong>${rows.length}</strong> project${rows.length === 1 ? "" : "s"}</summary><ul>${items}</ul></details>`;
    })
    .join("");
}

// Completed projects grouped by the calendar year (1/1 - 12/31) they went live, starting with FIRST_TTV_YEAR.
// Ignores the "Implementation started" filter so every year shows; the category and product line filters still apply.
// True when the project's client (matched on account number, else exact title) was On Hold in any history snapshot.
function peerWasOnHold(row) {
  const matches = (row.project.title || "").match(/\b\d{5}\b/g);
  const account = matches ? matches[matches.length - 1] : null;
  return account ? peerState.onHold.accounts.has(account) : peerState.onHold.titles.has(row.project.title);
}

function renderPeerYearTable(all) {
  const tbody = document.querySelector("#peerYearTable tbody");
  const details = document.getElementById("peerYearDetails");
  if (!tbody) return;
  const done = peerFilteredRows(all, false).filter((row) => row.completed);
  const years = [...new Set(done.map((row) => row.goLive.getUTCFullYear()))].filter((year) => year >= FIRST_TTV_YEAR).sort((a, b) => a - b);
  if (!years.length) {
    tbody.innerHTML = '<tr><td colspan="9">No completed projects match these filters.</td></tr>';
    if (details) details.innerHTML = "";
    return;
  }
  const avgCell = (rows) => {
    const stat = PeerModel.summarize(rows.map((row) => row.ttvMonths));
    return stat.n ? `${peerFormatMonths(stat.mean)} <small>(${stat.n})</small>` : "&mdash;";
  };
  const inYear = (year) => done.filter((row) => row.goLive.getUTCFullYear() === year);
  // Outliers are judged within each year (1.5 x IQR). Median and the middle half barely move; the average is what a long tail drags.
  const outliersOf = (rows) => {
    const fences = PeerModel.outlierFences(rows.map((row) => row.ttvMonths));
    return { fences, outliers: rows.filter((row) => PeerModel.isOutlier(row.ttvMonths, fences)), kept: rows.filter((row) => !PeerModel.isOutlier(row.ttvMonths, fences)) };
  };
  let previous = null;
  tbody.innerHTML = years
    .map((year) => {
      const rows = inYear(year);
      const stat = PeerModel.summarize(rows.map((row) => row.ttvMonths));
      const change = previous && previous.median !== null && stat.median !== null ? stat.median - previous.median : null;
      previous = stat;
      const { outliers, kept } = outliersOf(rows);
      return `<tr>
        <td><strong>${year}</strong></td>
        <td>${stat.n}</td>
        <td>${peerFormatMonths(stat.mean)}</td>
        <td>${peerFormatMonths(stat.median)}</td>
        <td>${peerFormatMonths(stat.p25)} &ndash; ${peerFormatMonths(stat.p75)}</td>
        <td>${change === null ? "&mdash;" : peerFormatMonths(change, true)}</td>
        <td>${outliers.length}</td>
        <td>${outliers.length ? avgCell(kept) : "same"}</td>
        <td>${year < FIRST_ON_HOLD_YEAR ? "&mdash;" : avgCell(rows.filter((row) => !peerWasOnHold(row)))}</td>
      </tr>`;
    })
    .join("");
  if (!details) return;
  // One collapsible block per year: outliers, then TTV for each category, plus the clients dropped from the on-hold comparison.
  details.innerHTML = [...years]
    .reverse()
    .map((year) => {
      const rows = inYear(year);
      const { fences, outliers, kept } = outliersOf(rows);
      const outlierList = !outliers.length
        ? `<p class="peer-note">No outliers this year${fences.high === null ? " (too few projects to tell)" : ""}.</p>`
        : `<p class="peer-note">Outliers are more than 1.5&times; the middle half (IQR) beyond it: below ${peerFormatMonths(Math.max(0, fences.low))} or above ${peerFormatMonths(fences.high)} months.</p>
           <div class="table-wrap"><table>
             <thead><tr><th>Project</th><th>Category</th><th>Start</th><th>Go-live</th><th>TTV (mo)</th><th></th></tr></thead>
             <tbody>${outliers
               .sort((a, b) => b.ttvMonths - a.ttvMonths)
               .map((row) => `<tr><td><a href="${escapeHtml(row.project.url || "#")}" target="_blank">${escapeHtml(row.project.title || "Untitled")}</a></td><td>${peerTierBadge(row)}</td><td>${escapeHtml(peerFormatDate(row.start))}${row.actualStart ? ' <small>(actual)</small>' : ""}${row.assumedStart ? ' <small>(assumed)</small>' : ""}</td><td>${escapeHtml(peerFormatDate(row.goLive))}</td><td>${peerFormatMonths(row.ttvMonths)}</td><td>${row.ttvMonths > fences.high ? "long" : "short"}</td></tr>`)
               .join("")}</tbody>
           </table></div>`;
      const categoryRows = [...PeerModel.levelLabels(), null]
        .map((label) => {
          const group = rows.filter((row) => (label ? row.label === label : !row.label));
          if (!group.length) return "";
          const stat = PeerModel.summarize(group.map((row) => row.ttvMonths));
          const keptGroup = group.filter((row) => kept.includes(row));
          return `<tr><td>${peerBadge(label)}</td><td>${stat.n}</td><td>${peerFormatMonths(stat.mean)}</td><td>${peerFormatMonths(stat.median)}</td><td>${outliers.length ? avgCell(keptGroup) : "same"}</td></tr>`;
        })
        .join("");
      const dropped = year < FIRST_ON_HOLD_YEAR ? [] : rows.filter(peerWasOnHold);
      const holdNote =
        year < FIRST_ON_HOLD_YEAR
          ? ""
          : `<p class="peer-note">${dropped.length
              ? `Excluded from the on-hold comparison: ${dropped.map((row) => `${escapeHtml(row.project.title)} (${peerFormatMonths(row.ttvMonths)} mo)`).join("; ")}.`
              : "No projects excluded: none of this year's go-lives belong to a client that was on hold."}</p>`;
      return `<details class="peer-category"><summary><strong>${year}</strong> &ndash; ${rows.length} go-live${rows.length === 1 ? "" : "s"}, ${outliers.length} outlier${outliers.length === 1 ? "" : "s"}</summary>
        <h4>Outliers</h4>${outlierList}
        <h4>By category</h4>
        <div class="table-wrap"><table>
          <thead><tr><th>Category</th><th>Completed</th><th>Avg TTV (mo)</th><th>Median TTV (mo)</th><th>Avg excl. outliers (mo)</th></tr></thead>
          <tbody>${categoryRows}</tbody>
        </table></div>${holdNote}</details>`;
    })
    .join("");
}

function renderPeerCompare() {
  const today = new Date();
  const all = peerBuildAllRows(today);
  const scoped = peerFilteredRows(all);
  const completed = scoped.filter((row) => row.completed);
  const active = scoped.filter((row) => !row.completed);
  const stats = PeerModel.peerStats(completed);
  renderPeerMetrics(completed, active, stats);
  renderPeerTierTable(scoped, completed, active, stats, today);
  renderPeerYearTable(all);
  renderPeerCategoryLists(scoped);
  renderPeerActiveTable(active, stats, today);
  renderPeerCompletedTable(completed, stats);
}

function populatePeerFilters() {
  const tierSelect = document.getElementById("peerTierFilter");
  if (tierSelect) {
    [...PeerModel.allLabels(), PEER_UNCLASSIFIED].forEach((label) => {
      tierSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`);
    });
  }
  const lineSelect = document.getElementById("peerLineFilter");
  if (lineSelect) {
    PeerModel.PRODUCT_LINES.forEach(([name]) => {
      lineSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
    });
  }
  [
    ["peerSinceFilter", "since"],
    ["peerTierFilter", "tier"],
    ["peerLineFilter", "line"],
  ].forEach(([id, key]) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.value = peerState.filters[key];
    element.addEventListener("change", () => {
      peerState.filters[key] = element.value;
      renderPeerCompare();
    });
  });
}

async function initPeerCompareDashboard() {
  if (typeof dashboardMode !== "function" || dashboardMode() !== "peer-compare") return;
  if (!state || !state.projects || peerState.closedLoaded) return;
  peerState.closedLoaded = true;
  try {
    const closed = await loadJson("./data/closed_projects.json");
    peerState.overrides = await loadJson(`./data/category_overrides.json?t=${Date.now()}`).catch(() => ({}));
    const actualStarts = await loadJson(`./data/actual_start_dates.json?t=${Date.now()}`).catch(() => ({ projects: {} }));
    peerState.actualStarts = actualStarts.projects || {};
    const onHold = await loadJson(`./data/on_hold_history.json?t=${Date.now()}`).catch(() => ({ clients: [] }));
    (onHold.clients || []).forEach((client) => {
      if (client.account) peerState.onHold.accounts.add(client.account);
      (client.titles || []).forEach((title) => peerState.onHold.titles.add(title));
    });
    const seen = new Set(state.projects.map((row) => row.page_id || row.title));
    const closedRows = (closed.projects || [])
      .map((row) => normalizeProjectRow(row))
      .filter((row) => !isTemplateTitle(row.title) && !seen.has(row.page_id || row.title));
    peerState.projects = [...state.projects, ...closedRows];
    populatePeerFilters();
    renderPeerCompare();
  } catch (error) {
    document.getElementById("stamp").textContent = `Peer data not loaded: ${error.message}`;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("dashboardReady", () => {
    initPeerCompareDashboard();
  });
  if (typeof state !== "undefined" && state && state.projects && state.projects.length) {
    initPeerCompareDashboard();
  }
}
