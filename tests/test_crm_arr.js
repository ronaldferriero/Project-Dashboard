// Tests for dashboard/crm-arr.js (CRM ARR cells, roll-ups, chart rows, stamp). Synthetic data only.
const assert = require("assert");
const C = require("../dashboard/crm-arr.js");

// Title parsing matches crm_arr_store.account_number_from_title.
const titles = {
  "Abilene, TX City of - 42004": "42004",
  "Yuba County - CA 48397": "48397",
  "Hennepin County Health - MN 48979": "48979",
  "Albany County, NY - 1007 ": "1007",
  "Phase 2 Rollout 2026": null,
  "Something - Phase 2": null,
  "Something - 12": null,
  "": null,
};
for (const [title, expected] of Object.entries(titles)) {
  assert.strictEqual(C.accountNumberFromTitle(title), expected, title);
}
assert.strictEqual(C.accountNumberFromTitle(undefined), null);

const data = {
  generated_at: "2026-11-07T14:00:00+00:00",
  last_weekly_check: "2026-11-07T14:00:00+00:00",
  last_run: { errors: 0 },
  accounts: {
    48838: { account_number: "48838", status: "ok", total_arr: 1000000, epl_arr: 200000 },
    42004: { account_number: "42004", status: "ok", total_arr: 612400, epl_arr: 148900 },
    5059: { account_number: "5059", status: "not_found", reason: "Account 5059 not found in CRM" },
    5088: { account_number: "5088", status: "ok", total_arr: 188750, epl_arr: 0 },
    1007: { account_number: "1007", status: "error", reason: "Agent returned 3 of 4 item rows", total_arr: 50000, epl_arr: 1000 },
    5252: { account_number: "5252", status: "ambiguous", reason: "Account Number 5252 has 2 separate top-level CRM accounts" },
  },
};

assert.strictEqual(C.hasData(data), true);
assert.strictEqual(C.hasData({ accounts: {} }), false);
assert.strictEqual(C.hasData(undefined), false);

// entryForRow
assert.deepStrictEqual(C.entryForRow({ title: "Abilene, TX City of - 42004" }, data), {
  number: "42004", status: "ok", total: 612400, epl: 148900, reason: "",
});
assert.deepStrictEqual(C.entryForRow({ title: "Barstow, CA City of - 5059" }, data), {
  number: "5059", status: "not_found", total: null, epl: null, reason: "Account 5059 not found in CRM",
});
assert.deepStrictEqual(C.entryForRow({ title: "No number" }, data), {
  number: null, status: "no_number", total: null, epl: null, reason: "No account number in project title",
});
assert.deepStrictEqual(C.entryForRow({ title: "New Client - 77777" }, data), {
  number: "77777", status: "not_fetched", total: null, epl: null, reason: "Account 77777 not yet fetched from CRM",
});
assert.strictEqual(C.entryForRow({ title: "Cerritos, CA City of - 5088" }, data).epl, 0);
// A failed refresh keeps showing the last good values.
const stale = C.entryForRow({ title: "Albany County, NY - 1007" }, data);
assert.strictEqual(stale.status, "error");
assert.strictEqual(stale.total, 50000);
assert.strictEqual(C.entryForRow({ title: "Petaluma - 5252" }, data).total, null);

// sortValue
assert.strictEqual(C.sortValue({ title: "Abilene, TX City of - 42004" }, data, "crm_total_arr"), 612400);
assert.strictEqual(C.sortValue({ title: "Abilene, TX City of - 42004" }, data, "crm_epl_arr"), 148900);
assert.strictEqual(C.sortValue({ title: "Barstow, CA City of - 5059" }, data, "crm_total_arr"), null);

// rollup: the two LA County projects share one client, counted once.
const rows = [
  { title: "Los Angeles County, CA - 48838", region: "West" },
  { title: "Los Angeles County, CA Phase 2 - 48838", region: "Central" },
  { title: "Abilene, TX City of - 42004", region: "Central" },
  { title: "Barstow, CA City of - 5059", region: "West" },
];
assert.deepStrictEqual(C.rollup(rows, data), { total: 1612400, epl: 348900, matched: 3, projects: 4, eplShare: 348900 / 1612400 });
assert.deepStrictEqual(C.rollup([], data), { total: 0, epl: 0, matched: 0, projects: 0, eplShare: null });

// byRegion: 48838 counted once, in the region of its first project.
assert.deepStrictEqual(C.byRegion(rows, data, (row) => row.region), [
  { label: "West", epl: 200000, other: 800000, total: 1000000 },
  { label: "Central", epl: 148900, other: 463500, total: 612400 },
]);
assert.deepStrictEqual(C.byRegion([{ title: "X - 5088", region: "" }], data, (row) => row.region), [
  { label: "Unassigned", epl: 0, other: 188750, total: 188750 },
]);

// formatCompact
assert.strictEqual(C.formatCompact(41800000), "$41.8M");
assert.strictEqual(C.formatCompact(612400), "$612.4K");
assert.strictEqual(C.formatCompact(950), "$950");
assert.strictEqual(C.formatCompact(0), "$0");

// stampText
assert.deepStrictEqual(C.stampText(data, new Date("2026-11-10T15:00:00Z")), { text: "CRM ARR checked Nov 7, 2026", warning: "" });
assert.deepStrictEqual(C.stampText(data, new Date("2026-11-20T15:00:00Z")), { text: "CRM ARR checked Nov 7, 2026", warning: "weekly CRM check overdue" });
assert.deepStrictEqual(
  C.stampText({ ...data, last_run: { errors: 2 } }, new Date("2026-11-10T15:00:00Z")),
  { text: "CRM ARR checked Nov 7, 2026", warning: "some accounts could not be refreshed" },
);
assert.deepStrictEqual(
  C.stampText({ ...data, last_weekly_check: null }, new Date("2026-11-10T15:00:00Z")).text,
  "CRM ARR checked Nov 7, 2026",
);

console.log("test_crm_arr.js: all assertions passed");
