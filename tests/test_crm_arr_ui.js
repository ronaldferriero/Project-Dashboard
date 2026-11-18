// Tests for the CRM ARR wiring in dashboard/app.js: sorting with n/a last, the ARR by Region chart, and
// nothing changing when no CRM data is loaded. Synthetic data only.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dashboardDir = path.join(__dirname, "..", "dashboard");
const context = { console, window: undefined, document: undefined, Intl, Date, Set, Map, RegExp };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(dashboardDir, "crm-arr.js"), "utf8"), context, { filename: "crm-arr.js" });
vm.runInContext(fs.readFileSync(path.join(dashboardDir, "app.js"), "utf8"), context, { filename: "app.js" });

const fixture = {
  last_weekly_check: "2026-11-07T14:00:00+00:00",
  last_run: { errors: 0 },
  accounts: {
    42004: { account_number: "42004", status: "ok", total_arr: 612400, epl_arr: 148900 },
    5088: { account_number: "5088", status: "ok", total_arr: 188750, epl_arr: 0 },
    5059: { account_number: "5059", status: "not_found", reason: "Account 5059 not found in CRM" },
  },
};

// Loaded with no window/document (so init() does not run); add them now, as the browser would have them.
context.document = { body: { dataset: { dashboardMode: "active" } } };
context.window = { CRM_ARR_DATA: fixture };

const rowOk = { title: "Abilene, TX City of - 42004", project_status: "Green", region_state: "TX" };
const rowSmall = { title: "Cerritos, CA City of - 5088", project_status: "Green", region_state: "CA" };
const rowNotFound = { title: "Barstow, CA City of - 5059", project_status: "Yellow", region_state: "CA" };
const rows = [rowNotFound, rowOk, rowSmall];

assert.strictEqual(context.showArrColumns(), true);
assert.ok(context.compareRowsByKey(rowOk, rowSmall, "crm_total_arr") > 0);
assert.ok(context.compareRowsByKey(rowOk, rowSmall, "crm_epl_arr") > 0);

function sortedTitles(direction) {
  vm.runInContext(`state.sorts.active = { key: "crm_total_arr", direction: "${direction}" };`, context);
  return Array.from(context.sortedRows(rows, "active"), (row) => row.title);
}
assert.deepStrictEqual(sortedTitles("desc"), [rowOk.title, rowSmall.title, rowNotFound.title]);
assert.deepStrictEqual(sortedTitles("asc"), [rowSmall.title, rowOk.title, rowNotFound.title]);

const chart = context.chartDataForMode(rows).find((c) => c.title === "ARR by Region");
assert.ok(chart, "ARR by Region chart present with CRM data");
assert.strictEqual(chart.type, "stacked");
assert.strictEqual(chart.items.reduce((sum, item) => sum + item.total, 0), 612400 + 188750);

// The static header in active.html has no ARR columns; with CRM data the header is rebuilt to include them.
const headerRow = { innerHTML: "STATIC" };
context.document.getElementById = (id) => (id === "projectsTableHeader" ? headerRow : null);
context.syncCrmTableHeaders();
assert.ok(headerRow.innerHTML.includes('data-sort-key="crm_total_arr"'), "Total ARR header added");
assert.ok(headerRow.innerHTML.indexOf("crm_epl_arr") < headerRow.innerHTML.indexOf('data-sort-key="region_state"'), "ARR before State");

// Sort clicks still work after the header row is rebuilt: one listener on <thead>, not one per <th>.
const listeners = [];
const thead = { addEventListener: (type, handler) => listeners.push({ type, handler }) };
context.bindSortHeaders({ querySelectorAll: (selector) => (selector === "table thead" ? [thead] : []) });
assert.strictEqual(listeners.length, 1);
assert.strictEqual(listeners[0].type, "click");
vm.runInContext("state.sorts.active = { key: '', direction: 'asc' };", context);
context.document.querySelector = () => null; // renderTable finds no table body in this stand-in DOM
const rebuiltTh = { dataset: { sortKey: "crm_total_arr" }, closest: (sel) => (sel === "table" ? { id: "projectsTable" } : null) };
listeners[0].handler({ target: { closest: (sel) => (sel === "th[data-sort-key]" ? rebuiltTh : null) } });
assert.strictEqual(vm.runInContext("state.sorts.active.key", context), "crm_total_arr");
listeners[0].handler({ target: { closest: () => null } }); // a click outside a sortable header does nothing
assert.strictEqual(vm.runInContext("state.sorts.active.direction", context), "asc");

// Without CRM data the page is exactly as before: no ARR columns, no chart.
context.window = {};
headerRow.innerHTML = "STATIC";
context.syncCrmTableHeaders();
assert.strictEqual(headerRow.innerHTML, "STATIC", "static header left alone without CRM data");
assert.strictEqual(context.showArrColumns(), false);
assert.strictEqual(context.chartDataForMode(rows).some((c) => c.title === "ARR by Region"), false);

// Other pages never show ARR, even with data loaded.
context.window = { CRM_ARR_DATA: fixture };
context.document.body.dataset.dashboardMode = "risk";
assert.strictEqual(context.showArrColumns(), false);

console.log("test_crm_arr_ui.js: all assertions passed");
