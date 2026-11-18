// Tests for collapsible lists wired into dashboard/app.js: the projects table, the attention list and the
// changes table show their first 10 rows, expand on toggle, keep sorting, and never leave a stale toggle.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dashboardDir = path.join(__dirname, "..", "dashboard");
const context = { console, window: undefined, document: undefined, Intl, Date, Set, Map, RegExp };
vm.createContext(context);
for (const file of ["collapsible-list.js", "app.js"]) {
  vm.runInContext(fs.readFileSync(path.join(dashboardDir, file), "utf8"), context, { filename: file });
}

// Minimal stand-in DOM: tbodies collect appended rows; innerHTML = "" clears them.
function container() {
  const node = { rows: [], textContent: "", classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll: () => [] };
  let html = "";
  Object.defineProperty(node, "innerHTML", {
    get: () => html,
    set: (value) => { html = value; if (value === "") node.rows = []; },
  });
  node.appendChild = (child) => node.rows.push(child);
  return node;
}
const elements = {};
const byId = (id) => (elements[id] = elements[id] || container());
const tbodies = { "#projectsTable tbody": container(), "#changesTable tbody": container() };
context.document = {
  body: { dataset: { dashboardMode: "risk" } },
  querySelector: (selector) => tbodies[selector] || null,
  querySelectorAll: () => [],
  getElementById: (id) => (id === "projectsTable" || id === "changesTable" || id === "groupChangesToggle" || id === "clearAttentionFilterButton" ? null : byId(id)),
  createElement: () => {
    const node = container();
    node.dataset = {};
    node.style = {};
    return node;
  },
};
context.window = {};

const project = (n) => ({
  title: `Client ${String(n).padStart(2, "0")} - ${1000 + n}`,
  project_status: "Red",
  client_status: "Green",
  project_manager: "Pat PM",
  implementation_manager: "Ida IM",
  go_live: "2027-01-15",
  region_state: "Central - TX",
});
const rows25 = Array.from({ length: 25 }, (_, i) => project(i + 1));
const click = (key) => ({ target: { closest: (sel) => (sel === "[data-collapse-key]" ? { dataset: { collapseKey: key } } : null) } });
const projectTbody = tbodies["#projectsTable tbody"];

// Projects table: 10 of 25 rendered, in the current sort order; the header count stays the full total.
vm.runInContext('state.sorts.risk = { key: "title", direction: "desc" };', context);
context.renderTable(rows25);
assert.strictEqual(projectTbody.rows.length, 10);
assert.ok(projectTbody.rows[0].innerHTML.includes("Client 25"), "first row follows the sort");
assert.strictEqual(byId("resultsCount").textContent, "25 projects");
assert.ok(byId("projectsTableToggle").innerHTML.includes("Show all 25 projects"));

// Toggle re-renders only this list with every row; a sort change keeps it expanded.
context.CollapsibleList.handleClick(click("projects"));
assert.strictEqual(projectTbody.rows.length, 25);
assert.ok(byId("projectsTableToggle").innerHTML.includes("Show first 10"));
vm.runInContext('state.sorts.risk = { key: "title", direction: "asc" };', context);
context.renderTable(rows25);
assert.strictEqual(projectTbody.rows.length, 25);
assert.ok(projectTbody.rows[0].innerHTML.includes("Client 01"));
context.CollapsibleList.handleClick(click("projects"));
assert.strictEqual(projectTbody.rows.length, 10);

// Short or empty results clear the toggle (no stale "Show all").
context.renderTable(rows25.slice(0, 8));
assert.strictEqual(projectTbody.rows.length, 8);
assert.strictEqual(byId("projectsTableToggle").innerHTML, "");
context.renderTable(rows25);
context.renderTable([]);
assert.strictEqual(byId("projectsTableToggle").innerHTML, "");

// Attention list: capped by the toggle instead of a fixed 10, meta states the total.
context.renderNeedsAttention(rows25);
assert.strictEqual(byId("attentionList").rows.length, 10);
assert.ok(byId("attentionMeta").innerHTML.includes("25 projects with proactive risk signals"), byId("attentionMeta").innerHTML);
assert.ok(byId("attentionListToggle").innerHTML.includes("Show all 25 projects"));
context.CollapsibleList.handleClick(click("attention"));
assert.strictEqual(byId("attentionList").rows.length, 25);

// Changes table: 15 changes -> 10 rows plus a toggle.
const change = (n) => ({
  title: `Client ${n} - ${2000 + n}`, type: "Updated", changed_at: "2026-11-01T00:00:00Z", changedFields: ["project_status"],
  changes: [{ field: "project_status", before: "Green", after: "Yellow" }], detailText: "", project_status: "Yellow",
});
context.renderChangesTable(Array.from({ length: 15 }, (_, i) => change(i + 1)));
assert.strictEqual(tbodies["#changesTable tbody"].rows.length, 10);
assert.ok(byId("changesTableToggle").innerHTML.includes("Show all 15 changes"));

console.log("test_collapsible_ui.js: all assertions passed");
