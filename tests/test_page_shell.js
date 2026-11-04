// Page-level wiring checks: every page with long lists loads collapsible-list.js before app.js, every
// collapsible list has its toggle placeholder, and the left drawer sticks while the app bar scrolls away.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const dashboardDir = path.join(__dirname, "..", "dashboard");
const read = (file) => fs.readFileSync(path.join(dashboardDir, file), "utf8");

const listsByPage = {
  "active.html": ["projectsTable"],
  "risk.html": ["projectsTable", "attentionList", "criticalAlerts", "warningAlerts", "computedAlerts", "scheduleAlerts", "resourceAlerts", "trendingAlerts"],
  "go-lives.html": ["projectsTable", "remainingGoLivesTable"],
  "changes.html": ["changesTable", "historyTable"],
  "contract-value.html": ["missingTable", "contractTable", "servicesConsumptionTable"],
  "peer-compare.html": ["peerActiveTable", "peerCompletedTable"],
};

for (const [page, lists] of Object.entries(listsByPage)) {
  const html = read(page);
  const moduleAt = html.indexOf('src="./collapsible-list.js');
  const appAt = html.indexOf('src="./app.js');
  assert.ok(moduleAt > 0, `${page} loads collapsible-list.js`);
  assert.ok(moduleAt < appAt, `${page} loads collapsible-list.js before app.js`);
  for (const id of lists) {
    assert.ok(html.includes(`id="${id}"`), `${page} has #${id}`);
    assert.ok(html.includes(`<div class="list-toggle" id="${id}Toggle"></div>`), `${page} has a toggle placeholder for #${id}`);
  }
}

// Every page with a drawer lists the same views in Ron's order (Home first) and marks itself selected.
const NAV = ["index.html", "executive.html", "active.html", "go-lives.html", "risk.html", "contract-value.html",
  "peer-compare.html", "map.html", "pos.html", "pending-sales.html", "changes.html"];
const drawerPages = fs.readdirSync(dashboardDir).filter((f) => f.endsWith(".html") && read(f).includes("<forge-mini-drawer"));
for (const page of ["map.html", "pos.html", "pending-sales.html", "risk.html", "peer-compare.html"]) {
  assert.ok(drawerPages.includes(page), `${page} has the Forge drawer`);
}
for (const page of drawerPages) {
  const drawer = read(page).match(/<forge-mini-drawer[\s\S]*?<\/forge-mini-drawer>/)[0];
  const hrefs = Array.from(drawer.matchAll(/href="\.\/([^"]+)"/g), (m) => m[1]);
  assert.deepStrictEqual(hrefs, NAV, `${page} drawer order`);
  const selected = drawer.match(/<forge-list-item selected>\s*<forge-icon[^>]*><\/forge-icon>\s*<a href="\.\/([^"]+)"/);
  if (NAV.includes(page)) assert.strictEqual(selected && selected[1], page, `${page} marks itself selected`);
  assert.ok(!drawer.includes("alerts.html"), `${page} drawer has no separate Alerts entry`);
}
assert.ok(/url=\.\/risk\.html#alerts/.test(read("alerts.html")), "alerts.html redirects to At Risk & Alerts");
assert.ok(read("risk.html").includes('id="alerts"'), "risk.html has the #alerts anchor");

// Sticky drawer: screen only (print hides it), capped height (no extra scroll on short pages), above panels.
const css = read("styles.css");
const rule = css.match(/@media screen \{\s*forge-mini-drawer\[slot="body-left"\] \{([^}]*)\}\s*\}/);
assert.ok(rule, "sticky drawer rule inside @media screen");
assert.ok(/position:\s*sticky/.test(rule[1]) && /top:\s*0/.test(rule[1]) && /align-self:\s*start/.test(rule[1]), rule[1]);
assert.ok(/max-height:\s*100vh/.test(rule[1]) && !/(^|[^-])height:\s*100vh/.test(rule[1]), "max-height, not height");
assert.ok(/z-index:\s*10/.test(rule[1]), "drawer draws above panels when expanded on hover");
assert.ok(!/overflow/.test(rule[1]), "no overflow on the drawer (would clip the hover overlay)");

console.log("test_page_shell.js: all assertions passed");
