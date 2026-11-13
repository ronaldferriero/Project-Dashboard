// Tests for dashboard/collapsible-list.js (first-10 lists with Show all / Show first 10). Synthetic data only.
const assert = require("assert");
const C = require("../dashboard/collapsible-list.js");

const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }));

// visibleRows: short lists are untouched; long lists show the first `limit` until expanded.
C.reset();
assert.strictEqual(C.visibleRows(rows.slice(0, 10), "projects").length, 10);
assert.strictEqual(C.visibleRows(rows.slice(0, 4), "projects", 6).length, 4);
const collapsed = C.visibleRows(rows, "projects");
assert.strictEqual(collapsed.length, 10);
assert.strictEqual(collapsed[0].id, 0);
assert.strictEqual(C.visibleRows(rows, "cards", 6).length, 6);
assert.strictEqual(rows.length, 25, "input is not changed");
C.setExpanded("projects", true);
assert.strictEqual(C.visibleRows(rows, "projects").length, 25);
assert.strictEqual(C.visibleRows(rows, "other").length, 10, "state is per key");

// toggleHtml: nothing when everything fits; otherwise status text plus an accessible button.
C.reset();
assert.strictEqual(C.toggleHtml({ key: "projects", total: 10, noun: "projects", controls: "projectsTable" }), "");
const html = C.toggleHtml({ key: "projects", total: 167, noun: "projects", controls: "projectsTable" });
assert.ok(html.includes("Showing 10 of 167 projects"), html);
assert.ok(html.includes("Show all 167 projects"), html);
assert.ok(html.includes('data-collapse-key="projects"'), html);
assert.ok(html.includes('aria-expanded="false"'), html);
assert.ok(html.includes('aria-controls="projectsTable"'), html);
assert.ok(html.includes('type="button"'), html);
C.setExpanded("projects", true);
const open = C.toggleHtml({ key: "projects", total: 167, noun: "projects", controls: "projectsTable" });
assert.ok(open.includes("Showing all 167 projects"), open);
assert.ok(open.includes("Show first 10"), open);
assert.ok(open.includes('aria-expanded="true"'), open);
const cards = C.toggleHtml({ key: "criticalAlerts", total: 8, limit: C.CARD_LIMIT, noun: "alerts", controls: "criticalAlerts" });
assert.ok(cards.includes("Showing 6 of 8 alerts") && cards.includes("Show all 8 alerts"), cards);
C.setExpanded("criticalAlerts", true);
assert.ok(C.toggleHtml({ key: "criticalAlerts", total: 8, limit: C.CARD_LIMIT, noun: "alerts", controls: "criticalAlerts" }).includes("Show first 6"));

// handleClick: flips only the clicked key and calls only that key's renderer, once.
C.reset();
const calls = [];
C.register("a", () => calls.push("a"));
C.register("b", () => calls.push("b"));
C.register("a", () => calls.push("a2")); // re-registering replaces, never stacks
const click = (key) => ({ target: { closest: (sel) => (sel === "[data-collapse-key]" ? { dataset: { collapseKey: key } } : null) } });
assert.strictEqual(C.handleClick(click("a")), true);
assert.deepStrictEqual(calls, ["a2"]);
assert.strictEqual(C.isExpanded("a"), true);
assert.strictEqual(C.isExpanded("b"), false);
C.handleClick(click("a"));
assert.strictEqual(C.isExpanded("a"), false);
assert.strictEqual(C.handleClick({ target: { closest: () => null } }), false, "clicks elsewhere are ignored");
assert.deepStrictEqual(calls, ["a2", "a2"]);

console.log("test_collapsible_list.js: all assertions passed");
