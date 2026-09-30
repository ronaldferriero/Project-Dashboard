// Computed Health: pure helper functions shared by the Executive Summary (and any future page).
//
// Scores, statuses, overrides and Control Point ratings are calculated at data-generation time by
// health_model.py from health_model_config.json, and embedded in projects.json (`computedHealth`).
// This file only classifies, trends and alerts on that data. It never alters Reported Health.
// Every function is pure: pass `config` (payload.health_model) and, where relevant, `today`.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.EPLHealth = api;
  }
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function isNum(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function emptyComputed() {
    return {
      assessed: false,
      complete: false,
      confidence: "none",
      overallStatus: "gray",
      overallScore: null,
      projectScore: null,
      projectStatus: "gray",
      clientScore: null,
      clientStatus: "gray",
      completenessPercent: 0,
      missingDimensions: [],
      dimensions: {},
      overrides: [],
      overrideActive: false,
      primaryDrivers: [],
      topFactors: [],
      currentStage: "",
      assessmentDate: null,
      controlPoint: {},
      recovery: { owner: "", targetDate: null },
      dataQuality: [],
      trend: { previousScore: null, scoreChange: null, previousAssessmentDate: null },
    };
  }

  function computedOf(project) {
    const value = project && project.computedHealth;
    return value && typeof value === "object" ? { ...emptyComputed(), ...value } : emptyComputed();
  }

  // Rebuild presentation data (labels, weights, rating names) that the data file omits to stay small.
  function withDimensions(computed, config) {
    const dimensionConfig = (config && config.dimensions) || [];
    if (!dimensionConfig.length) return computed;
    const stored = computed.dimensions && typeof computed.dimensions === "object" ? computed.dimensions : {};
    const scale = (config && config.ratingScale) || {};
    const dimensions = {};
    const missing = [];
    dimensionConfig.forEach((dim) => {
      const item = stored[dim.key] || {};
      const rating = isNum(item.rating) ? item.rating : null;
      if (rating === null) missing.push(dim.key);
      dimensions[dim.key] = {
        label: dim.label,
        group: dim.group,
        weight: dim.weight,
        maxContribution: dim.weight,
        tooltip: dim.tooltip || "",
        rating,
        ratingLabel: rating === null ? "Not assessed" : (scale[String(rating)] || {}).label || String(rating),
        source: item.source || null,
        contribution: isNum(item.contribution) ? item.contribution : null,
      };
    });
    return { ...computed, dimensions, missingDimensions: missing, assessedDimensions: dimensionConfig.length - missing.length };
  }

  // ---- Reported Health (read-only view of what the PM/manager selected in Confluence) ----

  function reportedKey(status) {
    const value = text(status).toLowerCase();
    return value === "green" || value === "yellow" || value === "red" ? value : "";
  }

  function reportedHealth(project) {
    const p = project || {};
    return {
      status: text(p.project_status) || "Unknown",
      key: reportedKey(p.project_status),
      projectStatus: text(p.project_status) || "Unknown",
      clientStatus: text(p.client_status) || "Unknown",
      clientKey: reportedKey(p.client_status),
      projectNotes: text(p.project_health),
      clientNotes: text(p.client_health),
    };
  }

  // ---- Alignment ----

  function classifyAlignment(reportedStatus, computedStatus, config) {
    const order = (config && config.statusOrder) || [];
    if (!order.includes(computedStatus)) return "incomplete";
    const reported = reportedKey(reportedStatus);
    if (!reported) return "not-comparable";
    return config.alignment.matrix[reported][computedStatus];
  }

  function alignmentMeta(id, config) {
    const cats = (config && config.alignment && config.alignment.categories) || {};
    return cats[id] || { label: id, icon: "", tone: "muted", description: "" };
  }

  function statusMeta(key, config) {
    const all = (config && config.statuses) || {};
    return all[key] || { label: text(key) || "Incomplete", icon: "○", color: "#5b6472" };
  }

  // ---- Dates ----

  function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
    if (!match) return null;
    const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isFinite(stamp) ? stamp : null;
  }

  function startOfDayUtc(today) {
    const d = today instanceof Date ? today : new Date(today || Date.now());
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function daysSince(dateValue, today) {
    const stamp = parseIsoDate(dateValue);
    if (stamp === null) return null;
    return Math.floor((startOfDayUtc(today) - stamp) / DAY_MS);
  }

  function isStale(computed, today, config) {
    if (!computed || !computed.assessed) return false;
    const limit = (config && config.alerts && config.alerts.staleDays) || 14;
    const age = daysSince(computed.assessmentDate, today);
    return age === null || age > limit;
  }

  // ---- Trend (from the per-project history series written at each refresh) ----

  function consecutiveDeclines(values) {
    let count = 0;
    for (let i = values.length - 1; i > 0; i--) {
      if (values[i] < values[i - 1]) count++;
      else break;
    }
    return count;
  }

  function lastTwo(series, field) {
    const values = (series || []).map((entry) => entry && entry[field]).filter(isNum);
    return values.length >= 2 ? [values[values.length - 2], values[values.length - 1]] : null;
  }

  function computeTrend(series, config) {
    const list = Array.isArray(series) ? series.filter((entry) => entry && typeof entry === "object") : [];
    const scored = list.filter((entry) => isNum(entry.overall));
    if (scored.length < 2) {
      return { available: false, label: "No trend available", scoreChange: null, previousScore: null, consecutiveDeclines: 0,
        clientConsecutiveDeclines: 0, controlPointChange: null, testingNotImproving: false, gapChange: null,
        lastAssessmentDate: scored.length ? scored[scored.length - 1].date : null };
    }
    const current = scored[scored.length - 1];
    const previous = scored[scored.length - 2];
    const change = current.overall - previous.overall;
    const clients = list.map((entry) => entry.client).filter(isNum);
    const testing = lastTwo(list, "testing");
    const cp = lastTwo(list, "controlPoint");
    const sev = (config && config.alignment && config.alignment.severity) || { reported: {}, computed: {} };
    const gapOf = (entry) => {
      const c = sev.computed[entry.status];
      const r = sev.reported[text(entry.reported).toLowerCase()];
      return c === undefined || r === undefined ? null : c - r;
    };
    const gapNow = gapOf(current);
    const gapPrev = gapOf(previous);
    return {
      available: true,
      label: change === 0 ? "No change" : `${change < 0 ? "Down" : "Up"} ${Math.abs(change)}`,
      scoreChange: change,
      previousScore: previous.overall,
      consecutiveDeclines: consecutiveDeclines(scored.map((entry) => entry.overall)),
      clientConsecutiveDeclines: consecutiveDeclines(clients),
      controlPointChange: cp ? Math.round((cp[1] - cp[0]) * 10) / 10 : null,
      testingNotImproving: testing ? testing[1] <= testing[0] && testing[1] < 4 : false,
      gapChange: gapNow !== null && gapPrev !== null ? gapNow - gapPrev : null,
      lastAssessmentDate: current.date || null,
    };
  }

  // ---- Derived per-project facts ----

  function clientProjectGap(computed) {
    return isNum(computed.projectScore) && isNum(computed.clientScore) ? computed.projectScore - computed.clientScore : null;
  }

  function buildRow(rawProject, ctx) {
    const project = rawProject && typeof rawProject === "object" ? rawProject : {};
    const config = ctx.config;
    const computed = withDimensions(computedOf(project), config);
    const reported = reportedHealth(project);
    const series = (ctx.history && ctx.history[String(project.page_id)]) || [];
    const trend = computeTrend(series, config);
    // Prefer the trend derived from history; fall back to the value stored at generation time.
    const scoreChange = trend.available ? trend.scoreChange : isNum(computed.trend && computed.trend.scoreChange) ? computed.trend.scoreChange : null;
    const alignment = classifyAlignment(reported.status, computed.overallStatus, config);
    const clientAlignment = classifyAlignment(reported.clientStatus, computed.clientStatus, config);
    const row = {
      project,
      pageId: String(project.page_id || ""),
      title: project.title || "",
      reported,
      computed,
      trend: { ...trend, scoreChange },
      alignment,
      clientAlignment,
      clientGap: clientProjectGap(computed),
      daysSinceAssessment: daysSince(computed.assessmentDate, ctx.today),
      stale: isStale(computed, ctx.today, config),
      series,
    };
    row.alerts = generateAlerts(row, ctx);
    return row;
  }

  // ---- Alerts ----

  function alertFor(row, severity, id, title, evidence) {
    return { severity, id, title, evidence, pageId: row.pageId, projectTitle: row.title };
  }

  function generateAlerts(row, ctx) {
    const cfg = (ctx.config && ctx.config.alerts) || {};
    const c = row.computed;
    const cp = c.controlPoint || {};
    const alerts = [];
    const add = (severity, id, title, evidence) => alerts.push(alertFor(row, severity, id, title, evidence));
    const dims = c.dimensions || {};
    const overrideIds = (c.overrides || []).map((o) => o.id);
    const hasOverride = (id) => overrideIds.includes(id);
    const today = ctx.today;

    // Critical
    if (c.complete && isNum(c.overallScore) && c.overallScore < 55) add("critical", "score-below-55", "Computed Overall Score below 55", `Computed Overall Score is ${c.overallScore}.`);
    const zeros = Object.values(dims).filter((d) => d.rating === 0).map((d) => d.label);
    if (zeros.length) add("critical", "dimension-zero", "Dimension rated 0 (failed or blocked)", `Rated 0: ${zeros.join("; ")}.`);
    if (cp.bypassed) add("critical", "control-point-bypassed", "Mandatory Control Point bypassed", "A mandatory Control Point was bypassed.");
    if (cp.auditFailed) add("critical", "audit-failed", "Audit failed", "The audit is recorded as failed.");
    if (isNum(cp.majorFindings) && cp.majorFindings > 0) add("critical", "major-audit-finding", "Unresolved major audit finding", `${cp.majorFindings} open major audit finding(s).`);
    if (hasOverride("blocked-go-live")) add("critical", "blocked-go-live", "Blocked go-live", "Go-live is recorded as blocked.");
    if (hasOverride("critical-issue")) add("critical", "critical-issue", "Critical security, regulatory, production, or data-integrity issue", "A critical issue is recorded (details withheld from the public dashboard).");
    if (row.reported.key === "green" && c.overallStatus === "red") add("critical", "green-vs-red", "Reported Green but Computed Red", `Reported Health is Green; Computed Health is Red (${c.overallScore === null ? "override" : `score ${c.overallScore}`}).`);

    // Warning
    if (c.complete && isNum(c.overallScore) && c.overallScore >= 55 && c.overallScore < 85) add("warning", "score-55-84", "Computed Overall Score between 55 and 84", `Computed Overall Score is ${c.overallScore} (${statusMeta(c.overallStatus, ctx.config).label}).`);
    const declineLimit = cfg.declineWarningPoints || 10;
    if (isNum(row.trend.scoreChange) && row.trend.scoreChange <= -declineLimit) add("warning", "score-decline", "Computed score declined by 10 or more points", `Score changed by ${row.trend.scoreChange} (from ${row.trend.previousScore === null || row.trend.previousScore === undefined ? "prior" : row.trend.previousScore} to ${c.overallScore}).`);
    const overdueLimit = cfg.overdueSignOffWarningDays || 10;
    if (isNum(cp.maxDaysOverdue) && cp.maxDaysOverdue > overdueLimit) add("warning", "signoff-overdue", "Sign-off more than 10 business days overdue", `Longest overdue sign-off is ${cp.maxDaysOverdue} business days.`);
    if (row.stale) add("warning", "stale-assessment", "Computed assessment older than 14 days", row.daysSinceAssessment === null ? "Assessment has no date." : `Last assessed ${row.daysSinceAssessment} days ago.`);
    const target = parseIsoDate(c.recovery && c.recovery.targetDate);
    if (target !== null && target < startOfDayUtc(today) && c.overallStatus !== "green") add("warning", "recovery-overdue", "Recovery target date overdue", `Recovery target was ${c.recovery.targetDate}.`);
    const gapLimit = cfg.clientGapPoints || 15;
    if (isNum(row.clientGap) && row.clientGap >= gapLimit) add("warning", "client-gap", "Client Health well below Project Health", `Computed Client Health is ${row.clientGap} points below Computed Project Health (${c.clientScore} vs ${c.projectScore}).`);
    if (c.assessed && !c.complete) add("warning", "dimensions-missing", "Required computed-health dimensions missing", `${(c.missingDimensions || []).length} of ${Object.keys(dims).length || 12} dimensions not assessed (${c.completenessPercent}% complete).`);
    if (row.reported.key === "green" && (c.overallStatus === "yellow" || c.overallStatus === "orange")) add("warning", "green-vs-softer", `Reported Green but Computed ${statusMeta(c.overallStatus, ctx.config).label}`, `Reported Health is Green; Computed Health is ${statusMeta(c.overallStatus, ctx.config).label} (score ${c.overallScore}).`);
    if (row.reported.key === "yellow" && c.overallStatus === "red") add("warning", "yellow-vs-red", "Reported Yellow but Computed Red", `Reported Health is Yellow; Computed Health is Red.`);

    // Trending
    const t = row.trend;
    if (t.available && t.consecutiveDeclines >= (cfg.consecutiveDeclines || 3)) add("trending", "three-declines", "Three consecutive computed-score declines", `${t.consecutiveDeclines} consecutive declines in Computed Overall Score.`);
    if (t.available && t.clientConsecutiveDeclines >= (cfg.clientConsecutiveDeclines || 2)) add("trending", "client-declining", "Computed Client Health declining", `Client score declined in ${t.clientConsecutiveDeclines} consecutive assessments.`);
    if (t.available && isNum(t.controlPointChange) && t.controlPointChange <= -(cfg.controlPointDeclinePoints || 1)) add("trending", "control-point-declining", "Control Point compliance decreasing", `Compliance changed by ${t.controlPointChange} points.`);
    if (t.available && t.testingNotImproving) {
      const goLive = row.project && row.project.go_live ? Date.parse(String(row.project.go_live).slice(0, 10)) : NaN;
      const window = cfg.testingGoLiveWindowDays || 60;
      if (Number.isFinite(goLive)) {
        const daysToGoLive = Math.floor((goLive - startOfDayUtc(today)) / DAY_MS);
        if (daysToGoLive >= 0 && daysToGoLive <= window) add("trending", "testing-not-improving", "Testing readiness not improving as go-live approaches", `Testing and quality rating has not improved; go-live is in ${daysToGoLive} days.`);
      }
    }
    if (t.available && isNum(t.gapChange) && t.gapChange > 0) add("trending", "gap-increasing", "Difference between Reported and Computed Health increasing", "Computed Health has moved further from the reported status since the prior assessment.");

    return alerts;
  }

  // ---- Portfolio measures ----

  function average(values) {
    const nums = values.filter(isNum);
    return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
  }

  function portfolioMeasures(rows) {
    const count = (fn) => rows.filter(fn).length;
    const rep = (key) => count((r) => r.reported.key === key);
    const comp = (key) => count((r) => r.computed.overallStatus === key);
    const cpValues = rows.map((r) => r.computed.controlPoint && r.computed.controlPoint.compliancePercent).filter(isNum);
    const sum = (fn) => rows.reduce((total, r) => total + (fn(r) || 0), 0);
    return {
      total: rows.length,
      reportedGreen: rep("green"),
      reportedYellow: rep("yellow"),
      reportedRed: rep("red"),
      computedGreen: comp("green"),
      computedYellow: comp("yellow"),
      computedOrange: comp("orange"),
      computedRed: comp("red"),
      incomplete: count((r) => !r.computed.complete),
      avgOverall: average(rows.map((r) => r.computed.overallScore)),
      avgProject: average(rows.map((r) => r.computed.projectScore)),
      avgClient: average(rows.map((r) => r.computed.clientScore)),
      scoredOverall: count((r) => isNum(r.computed.overallScore)),
      scoredProject: count((r) => isNum(r.computed.projectScore)),
      scoredClient: count((r) => isNum(r.computed.clientScore)),
      declining: count((r) => isNum(r.trend.scoreChange) && r.trend.scoreChange <= -10),
      controlPointCompliance: cpValues.length ? Math.round((cpValues.reduce((a, b) => a + b, 0) / cpValues.length) * 10) / 10 : null,
      controlPointProjects: cpValues.length,
      overdueSignoffs: sum((r) => r.computed.controlPoint && r.computed.controlPoint.overdueSignoffs),
      openMajorFindings: sum((r) => r.computed.controlPoint && r.computed.controlPoint.majorFindings),
      stale: count((r) => r.stale),
      hiddenRisk: count((r) => r.alignment === "hidden-risk"),
    };
  }

  // Counts for the Alignment Review tiles. Each entry has a predicate reused to filter the table.
  function alignmentTiles() {
    return [
      { id: "green-red", label: "Reported Green, Computed Red", test: (r) => r.reported.key === "green" && r.computed.overallStatus === "red" },
      { id: "green-orange", label: "Reported Green, Computed Orange", test: (r) => r.reported.key === "green" && r.computed.overallStatus === "orange" },
      { id: "green-yellow", label: "Reported Green, Computed Yellow", test: (r) => r.reported.key === "green" && r.computed.overallStatus === "yellow" },
      { id: "yellow-red", label: "Reported Yellow, Computed Red", test: (r) => r.reported.key === "yellow" && r.computed.overallStatus === "red" },
      { id: "client-gap", label: "Client Health 15+ points below Project Health", test: (r) => isNum(r.clientGap) && r.clientGap >= 15 },
      { id: "declined", label: "Computed score declined 10+ points", test: (r) => isNum(r.trend.scoreChange) && r.trend.scoreChange <= -10 },
      { id: "incomplete", label: "Computed assessment incomplete", test: (r) => !r.computed.complete },
      { id: "stale", label: "Computed assessment older than 14 days", test: (r) => r.stale },
    ];
  }

  // Default executive priority: lower rank sorts first.
  function priorityRank(row) {
    const r = row.reported.key;
    const c = row.computed.overallStatus;
    if (r === "green" && c === "red") return 1;
    if (r === "green" && c === "orange") return 2;
    if (r === "yellow" && c === "red") return 3;
    if (isNum(row.trend.scoreChange) && row.trend.scoreChange < 0) return 4;
    if (row.stale || !row.computed.complete) return row.computed.assessed ? 5 : 6;
    return 7;
  }

  function comparePriority(a, b) {
    const diff = priorityRank(a) - priorityRank(b);
    if (diff) return diff;
    if (priorityRank(a) === 4) return (a.trend.scoreChange || 0) - (b.trend.scoreChange || 0);
    return a.title.localeCompare(b.title);
  }

  function csvRow(row, config) {
    const c = row.computed;
    const cp = c.controlPoint || {};
    const meta = (key) => statusMeta(key, config).label;
    return {
      Project: row.title,
      "Reported Health (Project)": row.reported.projectStatus,
      "Reported Health (Client)": row.reported.clientStatus,
      "Computed Health": meta(c.overallStatus),
      "Computed Overall Score": isNum(c.overallScore) ? c.overallScore : "",
      "Computed Project Score": isNum(c.projectScore) ? c.projectScore : "",
      "Computed Client Score": isNum(c.clientScore) ? c.clientScore : "",
      "Score Change": row.trend.available || isNum(row.trend.scoreChange) ? row.trend.scoreChange : "No trend available",
      Alignment: alignmentMeta(row.alignment, config).label,
      "Assessment Date": c.assessmentDate || "",
      "Assessment Completeness %": c.completenessPercent,
      "Missing Dimensions": (c.missingDimensions || []).map((k) => (c.dimensions[k] && c.dimensions[k].label) || k).join(" | "),
      "Current Stage": c.currentStage || "",
      "Control Point Compliance %": isNum(cp.compliancePercent) ? cp.compliancePercent : "",
      "Overdue Sign-Offs": isNum(cp.overdueSignoffs) ? cp.overdueSignoffs : "",
      "Open Major Findings": isNum(cp.majorFindings) ? cp.majorFindings : "",
      "Active Overrides": (c.overrides || []).map((o) => o.label).join(" | "),
      "Primary Drivers": (c.primaryDrivers || []).join(" | "),
      "Recovery Owner": (c.recovery && c.recovery.owner) || "",
      "Recovery Target Date": (c.recovery && c.recovery.targetDate) || "",
      "Stale Assessment": row.stale ? "Yes" : "No",
    };
  }

  function mismatchMessage(row, config) {
    const c = row.computed;
    if (row.alignment === "aligned" || row.alignment === "incomplete" || row.alignment === "not-comparable") return "";
    const drivers = (c.primaryDrivers || []).slice(0, 3);
    const reason = drivers.length ? ` due to ${drivers.join("; ")}` : "";
    return `Reported Health is ${row.reported.status}. Computed Health is ${statusMeta(c.overallStatus, config).label}${reason}. Management review is recommended.`;
  }

  return {
    emptyComputed, computedOf, withDimensions, reportedHealth, reportedKey, classifyAlignment, alignmentMeta, statusMeta,
    daysSince, isStale, computeTrend, clientProjectGap, buildRow, generateAlerts, portfolioMeasures,
    alignmentTiles, priorityRank, comparePriority, csvRow, mismatchMessage, average, parseIsoDate,
  };
});
