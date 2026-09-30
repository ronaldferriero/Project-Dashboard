// Tests for dashboard/health-model.js (alignment, trend, alerts, portfolio measures).
// Uses the SAMPLE fixture (tests/fixtures/computed_health_sample.json) — all test data, no production data.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const H = require("../dashboard/health-model.js");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "computed_health_sample.json"), "utf8"));
assert.strictEqual(fixture._sample, true, "fixture must be marked as sample data");
assert(fixture.projects.every((p) => /^\[SAMPLE\]/.test(p.title)), "every fixture project must be titled [SAMPLE]");

const config = fixture.health_model;
const today = new Date(`${fixture.referenceDate}T12:00:00`);
const ctx = { config, history: fixture.history.projects, today };
const rows = fixture.projects.map((p) => H.buildRow(p, ctx));
const byTitle = (needle) => rows.find((r) => r.title.includes(needle));
const alertIds = (row) => row.alerts.map((a) => a.id);

// --- Alignment (scenario 12) ---
assert.strictEqual(byTitle("Hidden Risk").alignment, "hidden-risk");
assert.strictEqual(byTitle("Aligned Green").alignment, "aligned");
assert.strictEqual(byTitle("Emerging Concern").alignment, "emerging-concern");
assert.strictEqual(byTitle("Escalating Risk").alignment, "escalating-risk");
assert.strictEqual(byTitle("Greater Reported").alignment, "greater-reported-concern");
assert.strictEqual(byTitle("Unassessed").alignment, "incomplete");
assert.strictEqual(byTitle("Partial").alignment, "incomplete");
assert.strictEqual(byTitle("On Hold").alignment, "not-comparable");
assert.strictEqual(H.classifyAlignment("Green", "red", config), "hidden-risk");
assert.strictEqual(H.classifyAlignment("Green", "orange", config), "hidden-risk");

// --- Reported Health is never altered by computation (scenario 13) ---
const before = JSON.stringify(fixture.projects.map((p) => [p.project_status, p.client_status, p.project_health, p.client_health]));
fixture.projects.forEach((p) => H.buildRow(p, ctx));
assert.strictEqual(JSON.stringify(fixture.projects.map((p) => [p.project_status, p.client_status, p.project_health, p.client_health])), before);
assert.strictEqual(byTitle("Hidden Risk").reported.status, "Green");

// --- Projects with no computedHealth still load (scenario 10) ---
const legacy = H.buildRow({ page_id: "legacy", title: "Legacy", project_status: "Green", client_status: "Green" }, ctx);
assert.strictEqual(legacy.computed.overallStatus, "gray");
assert.strictEqual(legacy.alignment, "incomplete");
assert.deepStrictEqual(legacy.alerts, []);
assert.doesNotThrow(() => H.buildRow(null, ctx));
assert.doesNotThrow(() => H.buildRow({ page_id: "x", computedHealth: "garbage" }, ctx));

// --- Trend / no history (scenario 9) ---
const fresh = byTitle("New Assessment");
assert.strictEqual(fresh.trend.available, false);
assert.strictEqual(fresh.trend.label, "No trend available");
assert.strictEqual(fresh.trend.scoreChange, null);
assert.strictEqual(H.csvRow(fresh, config)["Score Change"], "No trend available");
const hidden = byTitle("Hidden Risk");
assert.strictEqual(hidden.trend.scoreChange, -11);
assert.strictEqual(hidden.trend.consecutiveDeclines, 3);
assert.strictEqual(hidden.trend.label, "Down 11");

// Trend parity with the Python model's stored trend for every fixture project.
rows.forEach((row) => {
  const stored = row.computed.trend;
  if (row.trend.available) {
    assert.strictEqual(row.trend.scoreChange, stored.scoreChange, `trend parity: ${row.title}`);
    assert.strictEqual(row.trend.previousScore, stored.previousScore, `previous score parity: ${row.title}`);
  } else {
    assert.strictEqual(stored.scoreChange, null, `trend parity (none): ${row.title}`);
  }
});

// --- Alerts ---
// Scenario 8: drop of 10+ points => alert with evidence.
const decline = hidden.alerts.find((a) => a.id === "score-decline");
assert(decline, "score decline alert");
assert(/-11/.test(decline.evidence));
assert(alertIds(hidden).includes("three-declines"));
assert(alertIds(hidden).includes("green-vs-red"));
assert(alertIds(hidden).includes("control-point-bypassed"));
assert(alertIds(hidden).includes("dimension-zero"));
// Scenario 6 (JS side): bypassed => Computed red.
assert.strictEqual(hidden.computed.overallStatus, "red");

// Scenario 4: Client 20 points below Project => warning.
const gapRow = H.buildRow({ page_id: "gap", title: "Gap", project_status: "Green", client_status: "Green",
  computedHealth: { ...H.emptyComputed(), assessed: true, complete: true, assessmentDate: "2026-09-29", overallScore: 80, overallStatus: "yellow", projectScore: 90, clientScore: 70, projectStatus: "green", clientStatus: "orange" } }, ctx);
assert.strictEqual(gapRow.clientGap, 20);
assert(alertIds(gapRow).includes("client-gap"));
const noGap = H.buildRow({ ...gapRow.project, computedHealth: { ...gapRow.computed, clientScore: 76 } }, ctx);
assert(!alertIds(noGap).includes("client-gap"));

// Scenario 5: assessment older than 14 days => stale warning; exactly 14 is not stale.
const stale = byTitle("Stale Assessment");
assert.strictEqual(stale.stale, true);
assert(alertIds(stale).includes("stale-assessment"));
const staleAt = (date) => H.buildRow({ page_id: "s", title: "S", project_status: "Green", computedHealth: { ...stale.computed, assessmentDate: date } }, ctx);
assert.strictEqual(staleAt("2026-09-16").stale, false); // 14 days
assert.strictEqual(staleAt("2026-09-15").stale, true); // 15 days
assert.strictEqual(H.buildRow({ page_id: "n", title: "N", project_status: "Green" }, ctx).stale, false, "unassessed projects are not 'stale'");

// Scenario 7: missing ratings => gray/incomplete with completeness + missing dims and a warning.
const partial = byTitle("Partial");
assert.strictEqual(partial.computed.overallStatus, "gray");
assert(partial.computed.completenessPercent < 100 && partial.computed.missingDimensions.length > 0);
assert(alertIds(partial).includes("dimensions-missing"));
assert.strictEqual(alertIds(byTitle("Unassessed")).length, 0, "fully unassessed projects do not flood alerts");

// Other alert kinds
assert(alertIds(byTitle("Blocked Go-Live")).includes("blocked-go-live"));
assert(alertIds(byTitle("Blocked Go-Live")).includes("recovery-overdue"));
assert(alertIds(byTitle("Overdue Sign-Off")).includes("signoff-overdue"));
assert(alertIds(byTitle("Emerging Concern")).includes("green-vs-softer"));
assert(alertIds(byTitle("Escalating Risk")).includes("yellow-vs-red"));
assert(!alertIds(byTitle("Aligned Green")).some((id) => ["green-vs-red", "green-vs-softer", "score-below-55"].includes(id)));
rows.forEach((row) => row.alerts.forEach((alert) => {
  assert(alert.evidence && alert.evidence.length > 0, `alert ${alert.id} needs evidence`);
  assert.strictEqual(alert.pageId, row.pageId);
}));

// Trending alert kinds from synthetic series
const series = (values) => values.map((v, i) => ({ date: `2026-09-${String(1 + i * 5).padStart(2, "0")}`, overall: v.o, client: v.c, testing: v.t, controlPoint: v.cp, status: v.s || "yellow", reported: "green" }));
const trendRow = H.buildRow({ page_id: "t", title: "T", project_status: "Green", go_live: "2026-11-01", computedHealth: { ...H.emptyComputed(), assessed: true, complete: true, assessmentDate: "2026-09-29", overallScore: 60, overallStatus: "orange" } },
  { ...ctx, history: { t: series([{ o: 80, c: 80, t: 3, cp: 95, s: "green" }, { o: 75, c: 75, t: 3, cp: 92 }, { o: 70, c: 70, t: 3, cp: 90 }, { o: 60, c: 60, t: 3, cp: 88, s: "orange" }]) } });
["three-declines", "client-declining", "control-point-declining", "testing-not-improving", "gap-increasing"].forEach((id) => assert(alertIds(trendRow).includes(id), `trending alert ${id}`));
assert.strictEqual(trendRow.trend.consecutiveDeclines, 3);

// --- Portfolio measures ---
const m = H.portfolioMeasures(rows);
assert.strictEqual(m.total, rows.length);
assert.strictEqual(m.reportedGreen + m.reportedYellow + m.reportedRed + rows.filter((r) => !r.reported.key).length, rows.length);
assert.strictEqual(m.computedRed, rows.filter((r) => r.computed.overallStatus === "red").length);
assert.strictEqual(m.incomplete, rows.filter((r) => !r.computed.complete).length);
assert(m.hiddenRisk >= 3);
assert.strictEqual(m.avgOverall, H.average(rows.map((r) => r.computed.overallScore)));
assert(m.scoredOverall < m.total, "average must be reported with the count of scored projects");
assert(m.declining >= 1);

// --- Sorting priority ---
const ordered = rows.slice().sort(H.comparePriority);
assert.strictEqual(ordered[0].reported.key, "green");
assert.strictEqual(ordered[0].computed.overallStatus, "red");
const firstNonRedIndex = ordered.findIndex((r) => !(r.reported.key === "green" && r.computed.overallStatus === "red"));
const nextRank = H.priorityRank(ordered[firstNonRedIndex]);
assert(nextRank >= 2);
const greenOrange = ordered.filter((r) => r.reported.key === "green" && r.computed.overallStatus === "orange");
greenOrange.forEach((r) => assert.strictEqual(H.priorityRank(r), 2));

// --- Alignment tiles & export ---
const tiles = Object.fromEntries(H.alignmentTiles().map((t) => [t.id, rows.filter(t.test).length]));
assert(tiles["green-red"] >= 2);
assert.strictEqual(tiles.incomplete, m.incomplete);
const csv = H.csvRow(hidden, config);
["Reported Health (Project)", "Computed Health", "Computed Overall Score", "Computed Project Score", "Computed Client Score", "Alignment", "Primary Drivers"].forEach((k) => assert(k in csv, `export column ${k}`));
assert.strictEqual(csv["Alignment"], "Hidden Risk");
assert(/Management review is recommended/.test(H.mismatchMessage(hidden, config)));
assert.strictEqual(H.mismatchMessage(byTitle("Aligned Green"), config), "");

// --- Public-data safety: nothing narrative in computed output ---
const publicText = JSON.stringify(fixture.projects.map((p) => p.computedHealth));
assert(!/sentiment narrative|escalation|dispute|vulnerab/i.test(publicText));

console.log("Computed Health JS tests passed.");
