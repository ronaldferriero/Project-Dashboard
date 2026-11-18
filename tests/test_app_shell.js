const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appShellPath = path.join(__dirname, "..", "dashboard", "app-shell.js");
const appShellSource = fs.readFileSync(appShellPath, "utf8");

const context = {
  console,
  window: undefined,
  document: undefined,
};

vm.createContext(context);
vm.runInContext(appShellSource, context, { filename: "app-shell.js" });

assert.equal(typeof context.totalAlertCount, "function");
assert.equal(typeof context.redStatusCount, "function");

assert.equal(
  context.totalAlertCount({
    critical: [1, 2],
    warning: [1],
    schedule: [],
    resource: [1, 1, 1],
    trending: []
  }),
  6
);

assert.equal(
  context.totalAlertCount({ critical: [], warning: [], schedule: [], resource: [], trending: [] }),
  0
);

assert.equal(
  context.redStatusCount([
    { project_status: "Red" },
    { project_status: "Green" },
    { project_status: "Red" },
    { project_status: "Yellow" }
  ]),
  2
);

assert.equal(context.redStatusCount([]), 0);

console.log("app-shell tests passed");
