// Tests for dashboard/alerts.js card colors and markup: a card is colored by status (client status for
// client-health alerts), never by the section it sits in, and the page uses Forge icons instead of emoji.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dashboardDir = path.join(__dirname, "..", "dashboard");
const context = { console, window: undefined, document: undefined, Intl, Date, Set, Map, RegExp };
vm.createContext(context);
for (const file of ["collapsible-list.js", "app.js", "alerts.js"]) {
  vm.runInContext(fs.readFileSync(path.join(dashboardDir, file), "utf8"), context, { filename: file });
}

const day = 24 * 60 * 60 * 1000;
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);
const project = (title, status, extra = {}) => ({
  title, project_status: status, client_status: "Green", project_manager: "Pat PM", implementation_manager: "Ida IM",
  go_live: isoDay(120), url: `https://example.test/${encodeURIComponent(title)}`, ...extra,
});

context.projectsFixture = [
  project("Green Past Due - 1001", "Green", { go_live: isoDay(-10) }),
  project("Red Past Due - 1002", "Red", { go_live: isoDay(-5) }),
  project("Green With Red Client - 1003", "Green", { client_status: "Red" }),
  project("Red With Yellow Client - 1004", "Red", { client_status: "Yellow" }),
  project("Not Started Due Soon - 1005", "Not Started", { go_live: isoDay(10) }),
  project("On Hold No PM - 1006", "On Hold", { project_manager: "" }),
];
vm.runInContext("state.projects = projectsFixture;", context);

const alerts = context.categorizeAlerts();
const toneOf = (group, title, type) => alerts[group].find((a) => a.title === title && (!type || a.type === type))?.tone;

// Past-due alerts sit in Critical but take the project's own color.
assert.strictEqual(toneOf("critical", "Green Past Due - 1001", "past-due"), "green");
assert.strictEqual(toneOf("critical", "Red Past Due - 1002", "past-due"), "red");
// Client-health alerts take the client's color.
assert.strictEqual(toneOf("warning", "Green With Red Client - 1003", "client-risk"), "red");
assert.strictEqual(toneOf("warning", "Red With Yellow Client - 1004", "client-risk"), "yellow");
// Other sections follow the project status, including Not Started and On Hold.
assert.strictEqual(toneOf("schedule", "Not Started Due Soon - 1005"), "slate");
assert.strictEqual(toneOf("resource", "On Hold No PM - 1006"), "blue");

// Rendering: the card class comes from the tone, not from the section.
const containers = {};
const node = (id) => (containers[id] = containers[id] || { innerHTML: "", textContent: "" });
context.document = { getElementById: (id) => node(id), body: { dataset: { dashboardMode: "alerts" } } };
context.window = {};
context.renderAlertSection("criticalAlerts", "criticalCount", alerts.critical);
const html = containers.criticalAlerts.innerHTML;
assert.ok(/class="alert-card alert-card-green"/.test(html), "green project card is green");
assert.ok(/class="alert-card alert-card-red"/.test(html), "red project card is red");
assert.ok(!/alert-card-critical|alert-card-warning/.test(html), "no section-based card colors");
// Time badges are neutral; only status badges carry a status color.
assert.ok(/alert-badge alert-badge-neutral">\d+d OVERDUE/.test(html), "overdue badge is neutral");

context.renderAlertSection("emptyAlerts", "emptyCount", []);
assert.ok(containers.emptyAlerts.innerHTML.includes('<forge-icon name="check_circle_outline">'), "empty state uses a Forge icon");

// No emoji left on the page or in the cards it renders.
const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
// Alerts live on the At Risk & Alerts page (risk.html); alerts.html only redirects there.
const pageHtml = fs.readFileSync(path.join(dashboardDir, "risk.html"), "utf8");
assert.ok(!emoji.test(pageHtml.replace(/<style>[\s\S]*?<\/style>/, "")), "risk.html has no emoji");
assert.ok(!emoji.test(html + containers.emptyAlerts.innerHTML), "rendered alerts have no emoji");

// Card sections show the first 6 cards; the badge keeps the full count; the toggle expands to all.
const eight = Array.from({ length: 8 }, (_, i) => ({ ...alerts.critical[0], title: `Card ${i + 1}` }));
context.renderAlertSection("warningAlerts", "warningCount", eight);
assert.strictEqual((containers.warningAlerts.innerHTML.match(/class="alert-card(?: alert-card-[a-z]+)?"/g) || []).length, 6);
assert.strictEqual(String(containers.warningCount.textContent), "8");
assert.ok(containers.warningAlertsToggle.innerHTML.includes("Show all 8 alerts"), containers.warningAlertsToggle.innerHTML);
context.CollapsibleList.handleClick({ target: { closest: () => ({ dataset: { collapseKey: "warningAlerts" } }) } });
assert.strictEqual((containers.warningAlerts.innerHTML.match(/class="alert-card(?: alert-card-[a-z]+)?"/g) || []).length, 8);
context.renderAlertSection("warningAlerts", "warningCount", []);
assert.strictEqual(containers.warningAlertsToggle.innerHTML, "", "empty section clears its toggle");

// Summary tiles: page order, Total = the 5 rule-based categories (same as the app-bar bell), Computed separate.
const tiles = context.alertSummaryTiles(alerts, null);
assert.deepStrictEqual(Array.from(tiles, (t) => t.label),
  ["Total Alerts", "Critical", "Warning", "Computed Risk Signal", "Schedule", "Resource", "Trending"]);
const ruleTotal = ["critical", "warning", "schedule", "resource", "trending"].reduce((sum, k) => sum + alerts[k].length, 0);
assert.strictEqual(tiles[0].value, ruleTotal);
assert.strictEqual(tiles[0].target, null);
assert.strictEqual(tiles[3].value, "—");
assert.strictEqual(context.alertSummaryTiles(alerts, [{}, {}, {}])[3].value, 3);

context.renderAlertSummary(alerts, null);
const summary = containers.alertSummary.innerHTML;
assert.ok(!/metric-(red|yellow|green|blue|slate)/.test(summary), "summary tiles are neutral");
for (const id of ["criticalAlertsSection", "warningAlertsSection", "computedAlertsSection", "scheduleAlertsSection", "resourceAlertsSection", "trendingAlertsSection"]) {
  assert.ok(summary.includes(`href="#${id}"`), `tile links to ${id}`);
  assert.ok(pageHtml.includes(`id="${id}"`), `risk.html has section ${id}`);
}
assert.ok(summary.includes('<forge-icon name="bell"'), "total tile has a Forge icon");
assert.ok(!pageHtml.includes("summary-banner"), "old banner removed");
assert.ok(pageHtml.includes("Alert Summary"), "summary panel has a heading");

// The computed model runs once per project, shared by the summary tile and the section.
let buildRowCalls = 0;
context.window = {
  EPLHealth: { buildRow: () => { buildRowCalls += 1; return { alerts: [] }; } },
  PROJECT_DASHBOARD_DATA: { health_model: {} },
};
context.initAlertsDashboard();
assert.strictEqual(buildRowCalls, context.projectsFixture.length);
assert.ok(containers.alertSummary.innerHTML.includes("Computed Risk Signal"));

console.log("test_alerts_ui.js: all assertions passed");
