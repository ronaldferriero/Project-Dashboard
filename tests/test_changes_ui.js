const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appPath = path.join(__dirname, "..", "dashboard", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

const context = {
  console,
  window: undefined,
  document: undefined,
  Intl,
  Date,
  Set,
  Map,
  RegExp,
};

vm.createContext(context);
vm.runInContext(appSource, context, { filename: "app.js" });

assert.equal(typeof context.buildChangesDataNote, "function");
assert.equal(typeof context.flattenChanges, "function");
assert.equal(typeof context.buildSnapshotChangeReport, "function");
assert.equal(typeof context.buildMonthlyChangeHistory, "function");
assert.equal(typeof context.latestMonthlyStatusComparison, "function");
assert.equal(typeof context.groupChangesByProject, "function");
assert.equal(typeof context.latestStatusMovementSummary, "function");
assert.equal(typeof context.missingDataSummary, "function");
assert.equal(typeof context.goLiveYear, "function");
assert.equal(typeof context.goLivesAvailableYears, "function");
assert.equal(typeof context.goLivesCompanionSummary, "function");
assert.equal(typeof context.goLivesRemainingRows, "function");
assert.equal(typeof context.withManualChangeMetadata, "function");

const summaryNote = context.buildChangesDataNote(
  {
    detail_level: "summary",
    summary: { added: 0, updated: 0, removed: 0 },
    added: [],
    removed: [],
    updated: [],
  },
  [{ generated_at: "2026-06-01T12:00:00+00:00" }],
);
assert.equal(summaryNote.tone, "warning");

const detailedNoChangeNote = context.buildChangesDataNote(
  {
    detail_level: "full",
    summary: { added: 0, updated: 0, removed: 0 },
    added: [],
    removed: [],
    updated: [],
  },
  [],
);
assert.equal(detailedNoChangeNote.tone, "success");

const flattened = context.flattenChanges({
  detail_level: "full",
  added: [
    {
      title: "Added Project",
      url: "https://example.com/added",
      project_manager: "Alice",
      implementation_manager: "Bob",
      region_state: "TX",
      epl_version: "2025.1",
      go_live: "2026-07-01",
      project_status: "Green",
    },
  ],
  removed: [],
  updated: [
    {
      title: "Updated Project",
      url: "https://example.com/updated",
      project_manager: "Carla",
      implementation_manager: "Dan",
      region_state: "MN",
      epl_version: "2025.2",
      go_live: "2026-08-15",
      project_status: "Yellow",
      previous: {
        project_status: "Red",
      },
      changes: {
        project_status: { before: "Red", after: "Yellow" },
      },
    },
  ],
});

assert.equal(flattened.length, 2);
assert.equal(flattened[0].type, "Updated");
assert.equal(flattened[0].url, "https://example.com/updated");
assert.equal(flattened[0].project_manager, "Carla");
assert.equal(flattened[0].changes[0].before, "Red");
assert.equal(flattened[1].type, "Added");
assert.equal(flattened[1].implementation_manager, "Bob");

const historicalReport = context.buildSnapshotChangeReport(
  {
    generated_at: "2026-06-01T12:00:00+00:00",
    projects: [
      {
        page_id: "1",
        title: "Project One",
        project_status: "Green",
        project_health: "Green",
        client_status: "Green",
        client_health: "Green",
        go_live: "2026-07-01",
        project_manager: "Alice",
        implementation_manager: "Bob",
        region_state: "TX",
        epl_version: "2025.1",
      },
    ],
  },
  {
    generated_at: "2026-06-02T12:00:00+00:00",
    projects: [
      {
        page_id: "1",
        title: "Project One",
        project_status: "Yellow",
        project_health: "Yellow Timing risk",
        client_status: "Green",
        client_health: "Green",
        go_live: "2026-07-01",
        project_manager: "Alice",
        implementation_manager: "Bob",
        region_state: "TX",
        epl_version: "2025.1",
      },
      {
        page_id: "2",
        title: "Project Two",
        project_status: "Green",
        project_health: "Green",
        client_status: "Green",
        client_health: "Green",
        go_live: "2026-08-01",
        project_manager: "Cara",
        implementation_manager: "Dan",
        region_state: "MN",
        epl_version: "2025.2",
      },
    ],
  },
);

assert.equal(historicalReport.summary.updated, 1);
assert.equal(historicalReport.summary.added, 1);
assert.equal(historicalReport.updated[0].changes.project_status.after, "Yellow");

const monthlyHistory = context.buildMonthlyChangeHistory([
  { generated_at: "2026-05-02T12:00:00+00:00", snapshot_file: "2026-05-02.json" },
  { generated_at: "2026-05-28T12:00:00+00:00", snapshot_file: "2026-05-28.json" },
  { generated_at: "2026-06-10T12:00:00+00:00", snapshot_file: "2026-06-10.json" },
]);
assert.equal(monthlyHistory.length, 2);
assert.equal(monthlyHistory[0].month_key, "2026-06");
assert.equal(monthlyHistory[0].previous_snapshot_file, "2026-05-28.json");
assert.equal(monthlyHistory[1].current_snapshot_file, "2026-05-28.json");

const monthlyComparison = context.latestMonthlyStatusComparison([
  { generated_at: "2026-04-15T12:00:00+00:00", project_count: 10, status_summary: { Green: 8 } },
  { generated_at: "2026-05-20T12:00:00+00:00", project_count: 11, status_summary: { Green: 9 } },
  { generated_at: "2026-06-10T12:00:00+00:00", project_count: 12, status_summary: { Green: 10 } },
]);
assert.equal(monthlyComparison.previous.generated_at, "2026-05-20T12:00:00+00:00");
assert.equal(monthlyComparison.current.generated_at, "2026-06-10T12:00:00+00:00");

const gapComparison = context.latestMonthlyStatusComparison([
  { generated_at: "2026-04-15T12:00:00+00:00", project_count: 10, status_summary: { Green: 8 } },
  { generated_at: "2026-06-10T12:00:00+00:00", project_count: 12, status_summary: { Green: 10 } },
]);
assert.equal(gapComparison, null);

const grouped = context.groupChangesByProject(flattened);
assert.equal(grouped.length, 2);
assert.equal(grouped[0].projectChangeCount, 1);

const movement = context.latestStatusMovementSummary({
  updated: [
    { changes: { project_status: { before: "Green", after: "Yellow" } } },
    { changes: { project_status: { before: "Red", after: "Yellow" } } },
  ],
});
assert.equal(movement.changed, 2);
assert.equal(movement.riskUp, 1);
assert.equal(movement.riskDown, 1);

const missing = context.missingDataSummary([
  { go_live: "", project_manager: "", implementation_manager: "IM", project_status: "Unknown" },
  { go_live: "2026-09-01", project_manager: "PM", implementation_manager: "IM", project_status: "Green" },
]);
assert.equal(missing.total, 1);
assert.equal(missing.go_live, 1);
assert.equal(missing.project_manager, 1);
assert.equal(missing.project_status, 1);

assert.equal(context.goLiveYear("2026-12-31"), "2027");
assert.equal(context.goLiveYear("2026-06-15"), "2026");

vm.runInContext(`
  state.projects = [
    { title: "Closed 2026", go_live: "2026-06-10", region_state: "TX" }
  ];
  state.activeProjects = [
    { title: "Active 2027", go_live: "2027-03-01", project_manager: "PM One", implementation_manager: "IM One", region_state: "CA", contracted_products: [] },
    { title: "Active 2026", go_live: "2026-09-15", project_manager: "PM One", implementation_manager: "IM One", region_state: "CA", contracted_products: [] }
  ];
`, context);

assert.deepEqual(Array.from(context.goLivesAvailableYears()), ["2026", "2027"]);

const companion = context.goLivesCompanionSummary({
  search: "",
  status: "",
  im: "",
  pm: "",
  year: "2027",
  stateCode: "",
  startYear: "",
  selectedModules: [],
  chartStatus: "",
  chartPm: "",
});
assert.equal(companion.year, "2027");
assert.equal(companion.remaining, 1);

const remainingRows = context.goLivesRemainingRows({
  search: "",
  status: "",
  im: "",
  pm: "",
  year: "2026",
  stateCode: "",
  startYear: "",
  selectedModules: [],
  chartStatus: "",
  chartPm: "",
});
assert.equal(remainingRows.length, 1);
assert.equal(remainingRows[0].title, "Active 2026");

const manualRows = context.withManualChangeMetadata([
  {
    type: "Updated",
    title: "Manual Project",
    detailText: "1 field changed",
    changed_at: "2026-06-04T10:00:00+00:00",
    changedFields: ["project_status"],
    changes: [],
  },
], "2026-06-04T11:15:00+00:00");
assert.equal(manualRows[0].change_source, "dashboard");
assert.equal(manualRows[0].sourceLabel, "Manual");
assert.equal(manualRows[0].changed_at, "2026-06-04T11:15:00+00:00");
assert.ok(manualRows[0].detailText.includes("Manual dashboard change"));

console.log("Changes UI smoke tests passed.");
