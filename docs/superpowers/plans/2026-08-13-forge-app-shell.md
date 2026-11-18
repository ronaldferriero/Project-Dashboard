# Forge App Shell (App Bar + Mini-Drawer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the dashboard's `.hero` banner + pill tab-nav on all 8 pages with a real Tyler Forge `forge-scaffold` / `forge-app-bar` / `forge-mini-drawer` shell, matching the reference Tyler product screenshot, while keeping every existing JS behavior (search/filter, sort, export, status editing, go-lives refresh, alerts computation) working unmodified.

**Architecture:** A small esbuild bundle (`dashboard/dist/forge-bundle.js`) defines the Forge custom elements this pass needs and is loaded via one `<script type="module">` tag per page — no browser import map, no bare-specifier resolution risk. A new shared `dashboard/app-shell.js` (plain global-scope script, matching the codebase's existing convention) wires the menu button, help button, and notification badge identically on all 8 pages. Per-page HTML changes are structural-only: the `.hero`/`<nav class="tabs-nav">` markup is replaced by the scaffold/app-bar/drawer shell; every existing `id`, class, and JS-relevant element inside the content area is left untouched.

**Tech Stack:** `@tylertech/forge` (already installed), `esbuild` (new devDependency), plain vanilla JS (no framework), Python `http.server` (unchanged), Node's built-in `assert`/`vm` modules for the one piece of genuinely unit-testable logic (matches this repo's existing `tests/test_changes_ui.js` convention — there is no browser/DOM test runner in this repo, so HTML/CSS/custom-element wiring tasks are verified via Playwright against the running dashboard server instead of synthetic unit tests).

**Spec:** `docs/superpowers/specs/2026-08-13-forge-app-shell-design.md`

## Global Constraints

- No changes to `app.js`, `alerts.js`, `executive.js`, `new-project.js`, `sales-handoff.js`, or any data file — this pass only adds new files and changes HTML structure/CSS.
- Dark mode is out of scope; no theme-toggle icon anywhere.
- The mini-drawer holds exactly 6 items (Executive Summary, Active Projects, Go-Lives, At Risk, Alerts, Changes) on every page, including `new-project.html`/`sales-handoff.html` where none of the 6 is marked selected (those two pages stay out of the nav itself, matching today's commented-out state).
- App bar is one uniform brand color on every page (no per-page hue variants like today's `.hero-go-live`/`.hero-changes`/`.hero-risk`).
- Notification badge methodology differs by page group, and that's intentional (see Task 2):
  - **Group A** (index, risk, alerts, executive): real count from `categorizeAlerts()` (sum of all 5 categories) — the exact same number the Alerts page itself shows.
  - **Group B** (go-lives, changes, new-project, sales-handoff): independent count of active projects with `project_status === "Red"`, fetched directly from `data/projects.json`. **Correction found during Task 4 execution:** `changes.html` was originally planned as Group A, but `app.js`'s `init()` has an early `return` for `dashboardMode() === "changes"` that skips populating `state.projects` and skips dispatching `dashboardReady` entirely — so `categorizeAlerts()` would exist but never actually run, permanently stuck at a badge of 0. `changes.html` does not load `data/projects.js` or `alerts.js`; it uses the same fallback fetch as `go-lives.html`.

---

## Task 1: Forge component bundle (esbuild)

**Status:** Already implemented and validated during planning — this task documents what's on disk so it's reviewable and reproducible; running it again should be a no-op.

**Files:**
- Modify: `package.json` (add `esbuild` devDependency, add `build:forge` script)
- Create: `dashboard/forge-entry.js`
- Create (generated, committed): `dashboard/dist/forge-bundle.js`
- Modify: `.gitignore` (the pre-existing generic `dist/` rule, meant for Python builds, was also matching `dashboard/dist/` — added a negation so the committed bundle isn't accidentally excluded)

**Interfaces:**
- Produces: a global custom-element registry (via `customElements.define`) for `forge-scaffold`, `forge-app-bar`, `forge-app-bar-menu-button`, `forge-app-bar-search`, `forge-app-bar-help-button`, `forge-app-bar-notification-button`, `forge-app-bar-profile-button`, `forge-mini-drawer`, `forge-list`, `forge-list-item`, `forge-icon`, `forge-badge` (registered internally by the notification button) — plus `IconRegistry` entries for `dashboard`, `bar_chart`, `list`, `rocket`, `warning`, `bell`, `history`, `account`. Every later task's markup uses these tag names and icon names verbatim.

- [x] **Step 1: Confirm `package.json` has the devDependency**

`package.json` should contain (exact version may differ slightly if `npm install` re-resolves):

```json
  "devDependencies": {
    "esbuild": "^0.27.2"
  }
```

If missing, run:

```bash
npm install --save-dev esbuild
```

- [x] **Step 2: Confirm `dashboard/forge-entry.js` has this exact content**

```javascript
import {
  defineAppBarComponent,
  defineAppBarHelpButtonComponent,
  defineAppBarMenuButtonComponent,
  defineAppBarNotificationButtonComponent,
  defineAppBarProfileButtonComponent,
  defineAppBarSearchComponent,
  defineIconComponent,
  defineListComponent,
  defineListItemComponent,
  defineMiniDrawerComponent,
  defineScaffoldComponent,
  IconRegistry
} from '@tylertech/forge';
import {
  tylIconDashboard,
  tylIconBarChart,
  tylIconList,
  tylIconRocket,
  tylIconWarning,
  tylIconBell,
  tylIconHistory,
  tylIconAccount
} from '@tylertech/tyler-icons';

defineIconComponent();
defineListComponent();
defineListItemComponent();
defineMiniDrawerComponent();
defineScaffoldComponent();
defineAppBarComponent();
defineAppBarMenuButtonComponent();
defineAppBarSearchComponent();
defineAppBarHelpButtonComponent();
defineAppBarNotificationButtonComponent();
defineAppBarProfileButtonComponent();

IconRegistry.define([
  tylIconDashboard,
  tylIconBarChart,
  tylIconList,
  tylIconRocket,
  tylIconWarning,
  tylIconBell,
  tylIconHistory,
  tylIconAccount
]);
```

(The menu/search/help/notification buttons each self-register their own default built-in icon internally — confirmed by reading `node_modules/@tylertech/forge/esm/app-bar/*/app-bar-*.js`, each calls `IconRegistry.define(tylIcon...)` for its own icon. Only the icons *we* choose for the logo and drawer items need registering here.)

- [x] **Step 3: Confirm `package.json` has the build script**

```json
  "scripts": {
    "build:forge": "esbuild dashboard/forge-entry.js --bundle --format=esm --minify --outfile=dashboard/dist/forge-bundle.js"
  }
```

- [x] **Step 4: Run the build and verify**

```bash
npm run build:forge
node --check dashboard/dist/forge-bundle.js && echo "syntax OK"
```

Expected: esbuild reports success (a "bundle size >1MB" warning is expected and fine — this is a one-time load for a local internal tool), `node --check` prints `syntax OK`.

- [x] **Step 5: Confirm `.gitignore` has the negation**

```
# Node / npm (Tyler Forge packages)
node_modules/

# The Forge component bundle is committed (no build step to run day-to-day)
!dashboard/dist/
!dashboard/dist/forge-bundle.js
```

- [x] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore dashboard/forge-entry.js dashboard/dist/forge-bundle.js
git commit -m "Add esbuild bundle for Tyler Forge app-bar/drawer components"
```

---

## Task 2: `app-shell.js` (menu/help/notification wiring) + unit test

**Files:**
- Create: `dashboard/app-shell.js`
- Create: `tests/test_app_shell.js`

**Interfaces:**
- Produces: global functions `totalAlertCount(alerts)` and `redStatusCount(projects)` (plain top-level functions, no IIFE — matches `app.js`/`alerts.js` convention), plus a `DOMContentLoaded`-triggered `initAppShell()` that wires `#appBarMenuButton`, `#appDrawer`, `#appBarHelpButton`, and `#alertsNotificationButton`. Later tasks' markup must use exactly these 4 ids.
- Consumes (only inside `initAppShell`, at runtime in the browser — not at load time): the global `categorizeAlerts()` function from `alerts.js` when present, and `window.fetch` otherwise.

- [x] **Step 1: Write the failing test**

Create `tests/test_app_shell.js`:

```javascript
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `node tests/test_app_shell.js`
Expected: FAIL — `dashboard/app-shell.js` does not exist yet (ENOENT), or once a placeholder file exists, FAIL with `totalAlertCount is not a function`.

- [x] **Step 3: Write the implementation**

Create `dashboard/app-shell.js`:

```javascript
// Shared Tyler Forge app-bar/drawer wiring for every dashboard page.
// Loaded as a plain script (not a module) on all 8 pages, after
// dashboard/dist/forge-bundle.js and (where present) app.js/alerts.js.

function totalAlertCount(alerts) {
  return (
    alerts.critical.length +
    alerts.warning.length +
    alerts.schedule.length +
    alerts.resource.length +
    alerts.trending.length
  );
}

function redStatusCount(projects) {
  return projects.filter(function (project) {
    return project.project_status === "Red";
  }).length;
}

function setNotificationBadge(notificationButton, count) {
  notificationButton.count = count;
  notificationButton.showBadge = count > 0;
}

function wireMenuButton() {
  var menuButton = document.getElementById("appBarMenuButton");
  var drawer = document.getElementById("appDrawer");
  if (!menuButton || !drawer) return;
  menuButton.addEventListener("click", function () {
    drawer.open = !drawer.open;
  });
}

function wireHelpButton() {
  var helpButton = document.getElementById("appBarHelpButton");
  if (!helpButton) return;
  helpButton.options = [{ label: "About This Dashboard", value: "about" }];
}

function wireNotificationButton() {
  var notificationButton = document.getElementById("alertsNotificationButton");
  if (!notificationButton) return;

  notificationButton.addEventListener("click", function () {
    window.location.href = "./alerts.html";
  });

  if (typeof categorizeAlerts === "function") {
    window.addEventListener("dashboardReady", function () {
      setNotificationBadge(notificationButton, totalAlertCount(categorizeAlerts()));
    });
  } else {
    fetch("./data/projects.json")
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        var projects = (data && data.projects) || [];
        setNotificationBadge(notificationButton, redStatusCount(projects));
      })
      .catch(function () {
        /* Leave the badge unset if the fetch fails. */
      });
  }
}

function initAppShell() {
  wireMenuButton();
  wireHelpButton();
  wireNotificationButton();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initAppShell);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node tests/test_app_shell.js`
Expected: PASS, prints `app-shell tests passed`.

- [x] **Step 5: Commit**

```bash
git add dashboard/app-shell.js tests/test_app_shell.js
git commit -m "Add app-shell.js for Forge app-bar/drawer wiring, with unit tests"
```

---

## Task 3: Convert `index.html` to the app-shell (reference implementation)

**Files:**
- Modify: `dashboard/index.html`

**Interfaces:**
- Consumes: `forge-bundle.js` (Task 1), `app-shell.js` (Task 2, requires `#appBarMenuButton`/`#appDrawer`/`#appBarHelpButton`/`#alertsNotificationButton` ids exactly).
- No changes to anything inside the existing `<section class="controls panel forge-card">` onward — those ids/classes are untouched.

- [x] **Step 1: Add the bundle script tag to `<head>`**

In `dashboard/index.html`, add this line immediately after the existing `forge-card.css` link (before the `styles.css` link):

```html
    <script type="module" src="./dist/forge-bundle.js"></script>
```

- [x] **Step 2: Replace the hero + nav block with the app-shell**

Replace this block:

```html
  <body>
    <main class="page">
      <header class="hero forge-card">
        <p class="eyebrow">EPL Professional Services</p>
        <h1>Project Dashboard</h1>
        <p class="lede">
          Active project data pulled from Confluence page properties in the EPLPS space.
        </p>
        <p class="stamp" id="stamp">No dataset loaded yet.</p>
      </header>

      <nav class="tabs-nav" aria-label="Dashboard Views">
        <a class="tab-link" href="./executive.html">Executive Summary</a>
        <a class="tab-link is-active" href="./index.html">Active Projects</a>
        <a class="tab-link" href="./go-lives.html">Projects That Went Live</a>
        <a class="tab-link" href="./risk.html">At Risk</a>
        <a class="tab-link" href="./alerts.html">Alerts</a>
        <a class="tab-link" href="./changes.html">Changes</a>
        <!-- <a class="tab-link" href="./sales-handoff.html">Sales Handoff</a> -->
        <!-- <a class="tab-link" href="./new-project.html">New Project</a> -->
      </nav>

      <section class="controls panel forge-card">
```

with:

```html
  <body>
    <forge-scaffold style="min-height: 100vh;">
      <forge-app-bar slot="header" title-text="Project Dashboard">
        <forge-icon slot="logo" name="dashboard"></forge-icon>
        <forge-app-bar-menu-button slot="start" id="appBarMenuButton"></forge-app-bar-menu-button>
        <forge-app-bar-search slot="center">
          <input id="searchInput" type="search" placeholder="Project, PM, IM, state...">
        </forge-app-bar-search>
        <forge-app-bar-help-button slot="end" id="appBarHelpButton"></forge-app-bar-help-button>
        <forge-app-bar-notification-button slot="end" id="alertsNotificationButton"></forge-app-bar-notification-button>
        <forge-app-bar-profile-button slot="end" avatar-icon="account" sign-out-button="false"></forge-app-bar-profile-button>
      </forge-app-bar>

      <forge-mini-drawer slot="body-left" hover open id="appDrawer">
        <forge-list>
          <forge-list-item>
            <forge-icon slot="start" name="bar_chart"></forge-icon>
            <a href="./executive.html">Executive Summary</a>
          </forge-list-item>
          <forge-list-item selected>
            <forge-icon slot="start" name="list"></forge-icon>
            <a href="./index.html">Active Projects</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="rocket"></forge-icon>
            <a href="./go-lives.html">Projects That Went Live</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="warning"></forge-icon>
            <a href="./risk.html">At Risk</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="bell"></forge-icon>
            <a href="./alerts.html">Alerts</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="history"></forge-icon>
            <a href="./changes.html">Changes</a>
          </forge-list-item>
        </forge-list>
      </forge-mini-drawer>

      <main slot="body" class="page">
        <h1>Active Projects</h1>
        <p class="stamp forge-typography--label2" id="stamp">No dataset loaded yet.</p>

        <section class="controls panel forge-card">
```

- [x] **Step 3: Close the new wrapper elements**

Find the end of `<main class="page">` (currently `</main>` right before the `<script>` tags) and change it to close `forge-scaffold` too:

```html
      </section>
    </main>

    <script src="./data/projects.js?v=20260810T1900403284760000"></script>
```

becomes:

```html
      </section>
      </main>
    </forge-scaffold>

    <script src="./data/projects.js?v=20260810T1900403284760000"></script>
```

- [x] **Step 4: Add `alerts.js` and `app-shell.js` script includes**

Replace:

```html
    <script src="./data/projects.js?v=20260810T1900403284760000"></script>
    <script src="./data/project_changes.js?v=20260810T1900403284760000"></script>
    <script src="./data/history/change_log.js?v=20260810T1900403284760000"></script>
    <script src="./app.js?v=20260810T1900403284760000"></script>
  </body>
```

with:

```html
    <script src="./data/projects.js?v=20260810T1900403284760000"></script>
    <script src="./data/project_changes.js?v=20260810T1900403284760000"></script>
    <script src="./data/history/change_log.js?v=20260810T1900403284760000"></script>
    <script src="./app.js?v=20260810T1900403284760000"></script>
    <script src="./alerts.js?v=20260810T1900403284760000"></script>
    <script src="./app-shell.js?v=20260810T1900403284760000"></script>
  </body>
```

- [x] **Step 5: Verify with Playwright**

Start the dashboard server (`./start_dashboard_server.sh`), then:

1. Navigate to `http://127.0.0.1:8765/dashboard/index.html`.
2. Check console messages at `error` level — expect 0 (aside from the pre-existing unrelated `favicon.ico` 404).
3. Take a snapshot/screenshot — confirm the dark app bar, icon-rail drawer with "Active Projects" highlighted, and plain "Active Projects" heading (no gradient hero) render correctly.
4. Type into the search box inside `forge-app-bar-search` and confirm the projects table still filters (same behavior verified in the prior pass: typing "test" narrows 155 rows down).
5. Evaluate `document.getElementById('alertsNotificationButton').count` after waiting for the `dashboardReady` event — expect it to equal the real alert count (cross-check against `alerts.html`'s own "Total Alerts" stat).
6. Click the menu button; confirm the drawer's `open` property toggles.

- [x] **Step 6: Commit**

```bash
git add dashboard/index.html
git commit -m "Convert index.html to the Forge app-bar/drawer shell"
```

---

## Task 4: Convert `go-lives.html`, `risk.html`, `changes.html`

**Files:**
- Modify: `dashboard/go-lives.html` (Group B — fallback badge, no `alerts.js`/extra data scripts added)
- Modify: `dashboard/risk.html` (Group A — add `alerts.js`)
- Modify: `dashboard/changes.html` (Group B — fallback badge; `app.js`'s "changes" mode never populates `state.projects` or dispatches `dashboardReady`, so Group A isn't reachable here — see Global Constraints correction)

**Interfaces:** same as Task 3.

- [x] **Step 1: `go-lives.html` — add bundle script tag**

After the `forge-card.css` link, add:

```html
    <script type="module" src="./dist/forge-bundle.js"></script>
```

- [x] **Step 2: `go-lives.html` — replace hero + nav**

Replace:

```html
  <body data-dashboard-mode="go-lives">
    <main class="page">
      <header class="hero hero-go-live forge-card">
        <p class="eyebrow">Confluence Live Data</p>
        <h1>Projects That Went Live</h1>
        <p class="lede">
          Closed projects from the EPLPS Confluence report, focused on project name, go-live date, PM, and IM.
        </p>
        <p class="stamp" id="stamp">No dataset loaded yet.</p>
      </header>

      <nav class="tabs-nav" aria-label="Dashboard Views">
        <a class="tab-link" href="./executive.html">Executive Summary</a>
        <a class="tab-link" href="./index.html">Active Projects</a>
        <a class="tab-link is-active" href="./go-lives.html">Projects That Went Live</a>
        <a class="tab-link" href="./risk.html">At Risk</a>
        <a class="tab-link" href="./alerts.html">Alerts</a>
        <a class="tab-link" href="./changes.html">Changes</a>
        <!-- <a class="tab-link" href="./sales-handoff.html">Sales Handoff</a> -->
        <!-- <a class="tab-link" href="./new-project.html">New Project</a> -->
      </nav>

      <section class="controls panel controls-go-live forge-card">
```

with:

```html
  <body data-dashboard-mode="go-lives">
    <forge-scaffold style="min-height: 100vh;">
      <forge-app-bar slot="header" title-text="Project Dashboard">
        <forge-icon slot="logo" name="dashboard"></forge-icon>
        <forge-app-bar-menu-button slot="start" id="appBarMenuButton"></forge-app-bar-menu-button>
        <forge-app-bar-search slot="center">
          <input id="searchInput" type="search" placeholder="Project, PM, IM...">
        </forge-app-bar-search>
        <forge-app-bar-help-button slot="end" id="appBarHelpButton"></forge-app-bar-help-button>
        <forge-app-bar-notification-button slot="end" id="alertsNotificationButton"></forge-app-bar-notification-button>
        <forge-app-bar-profile-button slot="end" avatar-icon="account" sign-out-button="false"></forge-app-bar-profile-button>
      </forge-app-bar>

      <forge-mini-drawer slot="body-left" hover open id="appDrawer">
        <forge-list>
          <forge-list-item>
            <forge-icon slot="start" name="bar_chart"></forge-icon>
            <a href="./executive.html">Executive Summary</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="list"></forge-icon>
            <a href="./index.html">Active Projects</a>
          </forge-list-item>
          <forge-list-item selected>
            <forge-icon slot="start" name="rocket"></forge-icon>
            <a href="./go-lives.html">Projects That Went Live</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="warning"></forge-icon>
            <a href="./risk.html">At Risk</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="bell"></forge-icon>
            <a href="./alerts.html">Alerts</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="history"></forge-icon>
            <a href="./changes.html">Changes</a>
          </forge-list-item>
        </forge-list>
      </forge-mini-drawer>

      <main slot="body" class="page">
        <h1>Projects That Went Live</h1>
        <p class="stamp forge-typography--label2" id="stamp">No dataset loaded yet.</p>

        <section class="controls panel controls-go-live forge-card">
```

- [x] **Step 3: `go-lives.html` — close wrapper elements**

Replace:

```html
    </main>

    <script src="./data/closed_projects.js?v=20260810T1900403284760000"></script>
    <script src="./app.js?v=20260810T1900403284760000"></script>
  </body>
```

with:

```html
      </main>
    </forge-scaffold>

    <script src="./data/closed_projects.js?v=20260810T1900403284760000"></script>
    <script src="./app.js?v=20260810T1900403284760000"></script>
    <script src="./app-shell.js?v=20260810T1900403284760000"></script>
  </body>
```

(No `alerts.js` here — `go-lives.html` is Group B; `app-shell.js` will detect `categorizeAlerts` is undefined and use the independent `data/projects.json` fetch instead.)

- [x] **Step 4: `risk.html` — add bundle script tag**

After the `forge-card.css` link, add:

```html
    <script type="module" src="./dist/forge-bundle.js"></script>
```

- [x] **Step 5: `risk.html` — replace hero + nav**

Replace:

```html
  <body data-dashboard-mode="risk">
    <main class="page">
      <header class="hero hero-risk forge-card">
        <p class="eyebrow">Confluence Live Data</p>
        <h1>Projects At Risk</h1>
        <p class="lede">
          Active projects with proactive risk signals such as red or yellow status, past-due go-lives, missing ownership, recent risk movement, or concerning notes.
        </p>
        <p class="stamp" id="stamp">No dataset loaded yet.</p>
      </header>

      <nav class="tabs-nav" aria-label="Dashboard Views">
        <a class="tab-link" href="./executive.html">Executive Summary</a>
        <a class="tab-link" href="./index.html">Active Projects</a>
        <a class="tab-link" href="./go-lives.html">Projects That Went Live</a>
        <a class="tab-link is-active" href="./risk.html">At Risk</a>
        <a class="tab-link" href="./alerts.html">Alerts</a>
        <a class="tab-link" href="./changes.html">Changes</a>
        <!-- <a class="tab-link" href="./sales-handoff.html">Sales Handoff</a> -->
        <!-- <a class="tab-link" href="./new-project.html">New Project</a> -->
      </nav>

      <section class="controls panel forge-card">
```

with:

```html
  <body data-dashboard-mode="risk">
    <forge-scaffold style="min-height: 100vh;">
      <forge-app-bar slot="header" title-text="Project Dashboard">
        <forge-icon slot="logo" name="dashboard"></forge-icon>
        <forge-app-bar-menu-button slot="start" id="appBarMenuButton"></forge-app-bar-menu-button>
        <forge-app-bar-search slot="center">
          <input id="searchInput" type="search" placeholder="Project, PM, IM, state...">
        </forge-app-bar-search>
        <forge-app-bar-help-button slot="end" id="appBarHelpButton"></forge-app-bar-help-button>
        <forge-app-bar-notification-button slot="end" id="alertsNotificationButton"></forge-app-bar-notification-button>
        <forge-app-bar-profile-button slot="end" avatar-icon="account" sign-out-button="false"></forge-app-bar-profile-button>
      </forge-app-bar>

      <forge-mini-drawer slot="body-left" hover open id="appDrawer">
        <forge-list>
          <forge-list-item>
            <forge-icon slot="start" name="bar_chart"></forge-icon>
            <a href="./executive.html">Executive Summary</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="list"></forge-icon>
            <a href="./index.html">Active Projects</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="rocket"></forge-icon>
            <a href="./go-lives.html">Projects That Went Live</a>
          </forge-list-item>
          <forge-list-item selected>
            <forge-icon slot="start" name="warning"></forge-icon>
            <a href="./risk.html">At Risk</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="bell"></forge-icon>
            <a href="./alerts.html">Alerts</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="history"></forge-icon>
            <a href="./changes.html">Changes</a>
          </forge-list-item>
        </forge-list>
      </forge-mini-drawer>

      <main slot="body" class="page">
        <h1>Projects At Risk</h1>
        <p class="stamp forge-typography--label2" id="stamp">No dataset loaded yet.</p>

        <section class="controls panel forge-card">
```

- [x] **Step 6: `risk.html` — close wrapper elements**

Replace:

```html
    </main>

    <script src="./data/projects.js?v=20260615110832"></script>
    <script src="./data/project_changes.js?v=20260615110832"></script>
    <script src="./data/history/change_log.js?v=20260615110832"></script>
    <script src="./app.js?v=20260615110832"></script>
  </body>
```

with:

```html
      </main>
    </forge-scaffold>

    <script src="./data/projects.js?v=20260615110832"></script>
    <script src="./data/project_changes.js?v=20260615110832"></script>
    <script src="./data/history/change_log.js?v=20260615110832"></script>
    <script src="./app.js?v=20260615110832"></script>
    <script src="./alerts.js?v=20260615110832"></script>
    <script src="./app-shell.js?v=20260615110832"></script>
  </body>
```

- [x] **Step 7: `changes.html` — add bundle script tag**

After the `forge-card.css` link, add:

```html
    <script type="module" src="./dist/forge-bundle.js"></script>
```

- [x] **Step 8: `changes.html` — replace hero + nav**

Replace:

```html
  <body data-dashboard-mode="changes">
    <main class="page">
      <header class="hero hero-changes forge-card">
        <p class="eyebrow">Confluence Live Data</p>
        <h1>Project Changes</h1>
        <p class="lede">
          Monthly rolled-up add, remove, and update activity from the dashboard refresh history, with prior months below.
        </p>
        <p class="stamp" id="stamp">No change dataset loaded yet.</p>
      </header>

      <nav class="tabs-nav" aria-label="Dashboard Views">
        <a class="tab-link" href="./executive.html">Executive Summary</a>
        <a class="tab-link" href="./index.html">Active Projects</a>
        <a class="tab-link" href="./go-lives.html">Projects That Went Live</a>
        <a class="tab-link" href="./risk.html">At Risk</a>
        <a class="tab-link" href="./alerts.html">Alerts</a>
        <a class="tab-link is-active" href="./changes.html">Changes</a>
      </nav>

      <section class="controls panel controls-changes forge-card">
```

with:

```html
  <body data-dashboard-mode="changes">
    <forge-scaffold style="min-height: 100vh;">
      <forge-app-bar slot="header" title-text="Project Dashboard">
        <forge-icon slot="logo" name="dashboard"></forge-icon>
        <forge-app-bar-menu-button slot="start" id="appBarMenuButton"></forge-app-bar-menu-button>
        <forge-app-bar-search slot="center">
          <input id="searchInput" type="search" placeholder="Project, field, before, after...">
        </forge-app-bar-search>
        <forge-app-bar-help-button slot="end" id="appBarHelpButton"></forge-app-bar-help-button>
        <forge-app-bar-notification-button slot="end" id="alertsNotificationButton"></forge-app-bar-notification-button>
        <forge-app-bar-profile-button slot="end" avatar-icon="account" sign-out-button="false"></forge-app-bar-profile-button>
      </forge-app-bar>

      <forge-mini-drawer slot="body-left" hover open id="appDrawer">
        <forge-list>
          <forge-list-item>
            <forge-icon slot="start" name="bar_chart"></forge-icon>
            <a href="./executive.html">Executive Summary</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="list"></forge-icon>
            <a href="./index.html">Active Projects</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="rocket"></forge-icon>
            <a href="./go-lives.html">Projects That Went Live</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="warning"></forge-icon>
            <a href="./risk.html">At Risk</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="bell"></forge-icon>
            <a href="./alerts.html">Alerts</a>
          </forge-list-item>
          <forge-list-item selected>
            <forge-icon slot="start" name="history"></forge-icon>
            <a href="./changes.html">Changes</a>
          </forge-list-item>
        </forge-list>
      </forge-mini-drawer>

      <main slot="body" class="page">
        <h1>Project Changes</h1>
        <p class="stamp forge-typography--label2" id="stamp">No change dataset loaded yet.</p>

        <section class="controls panel controls-changes forge-card">
```

- [x] **Step 9: `changes.html` — close wrapper elements and add missing scripts**

Replace:

```html
    </main>

    <script src="./data/project_changes.js?v=20260810T1900403284760000"></script>
    <script src="./data/history/change_log.js?v=20260810T1900403284760000"></script>
    <script src="./app.js?v=20260810T1900403284760000"></script>
  </body>
```

with:

```html
      </main>
    </forge-scaffold>

    <script src="./data/projects.js?v=20260810T1900403284760000"></script>
    <script src="./data/project_changes.js?v=20260810T1900403284760000"></script>
    <script src="./data/history/change_log.js?v=20260810T1900403284760000"></script>
    <script src="./app.js?v=20260810T1900403284760000"></script>
    <script src="./alerts.js?v=20260810T1900403284760000"></script>
    <script src="./app-shell.js?v=20260810T1900403284760000"></script>
  </body>
```

(`data/projects.js` is newly added here — `changes.html` didn't load it before. This makes `state.projects` populated for the first time on this page; `app.js`'s per-page rendering is keyed off `dashboardMode()` and DOM element existence checks, so this should be inert for anything changes.html doesn't already render — verified in Step 10.)

- [x] **Step 10: Verify all three pages with Playwright**

For each of `go-lives.html`, `risk.html`, `changes.html`:
1. Navigate, check console errors (expect 0 beyond the pre-existing favicon 404).
2. Screenshot — confirm app bar/drawer render, correct drawer item highlighted.
3. Confirm existing page-specific functionality still works: go-lives.html's search/year filter/refresh button; risk.html's search/risk-level filter; changes.html's search/change-type filter and — specifically — that adding `data/projects.js` didn't introduce any new rendering into `changes.html` (its table/metrics sections should look exactly as before).
4. Confirm `#alertsNotificationButton` shows a badge on risk.html and changes.html (Group A, real count) and on go-lives.html (Group B, fallback count) — evaluate `document.getElementById('alertsNotificationButton').count` on each after a short wait for either the `dashboardReady` event or the fetch to resolve.

- [x] **Step 11: Commit**

```bash
git add dashboard/go-lives.html dashboard/risk.html dashboard/changes.html
git commit -m "Convert go-lives.html, risk.html, changes.html to the Forge app-bar/drawer shell"
```

---

## Task 5: Convert `executive.html`, `alerts.html`

**Files:**
- Modify: `dashboard/executive.html` (Group A — add `alerts.js`)
- Modify: `dashboard/alerts.html` (Group A — already has `alerts.js`)

Both pages have no `#searchInput` today — the app bar search box is decorative (no `id`, no functional binding).

- [x] **Step 1: `executive.html` — add bundle script tag**

After the `forge-card.css` link, add:

```html
    <script type="module" src="./dist/forge-bundle.js"></script>
```

- [x] **Step 2: `executive.html` — replace hero + nav**

Replace:

```html
  <body data-dashboard-mode="executive">
    <main class="page">
      <header class="hero forge-card">
        <p class="eyebrow">EPL Professional Services</p>
        <h1>Executive Summary</h1>
        <p class="lede">
          High-level overview of portfolio health, critical issues, and projects requiring immediate attention.
        </p>
        <p class="stamp" id="stamp">No dataset loaded yet.</p>
      </header>

      <nav class="tabs-nav" aria-label="Dashboard Views">
        <a class="tab-link is-active" href="./executive.html">Executive Summary</a>
        <a class="tab-link" href="./index.html">Active Projects</a>
        <a class="tab-link" href="./go-lives.html">Projects That Went Live</a>
        <a class="tab-link" href="./risk.html">At Risk</a>
        <a class="tab-link" href="./alerts.html">Alerts</a>
        <a class="tab-link" href="./changes.html">Changes</a>
        <!-- <a class="tab-link" href="./sales-handoff.html">Sales Handoff</a> -->
        <!-- <a class="tab-link" href="./new-project.html">New Project</a> -->
      </nav>
```

with:

```html
  <body data-dashboard-mode="executive">
    <forge-scaffold style="min-height: 100vh;">
      <forge-app-bar slot="header" title-text="Project Dashboard">
        <forge-icon slot="logo" name="dashboard"></forge-icon>
        <forge-app-bar-menu-button slot="start" id="appBarMenuButton"></forge-app-bar-menu-button>
        <forge-app-bar-search slot="center">
          <input type="search" placeholder="Search projects...">
        </forge-app-bar-search>
        <forge-app-bar-help-button slot="end" id="appBarHelpButton"></forge-app-bar-help-button>
        <forge-app-bar-notification-button slot="end" id="alertsNotificationButton"></forge-app-bar-notification-button>
        <forge-app-bar-profile-button slot="end" avatar-icon="account" sign-out-button="false"></forge-app-bar-profile-button>
      </forge-app-bar>

      <forge-mini-drawer slot="body-left" hover open id="appDrawer">
        <forge-list>
          <forge-list-item selected>
            <forge-icon slot="start" name="bar_chart"></forge-icon>
            <a href="./executive.html">Executive Summary</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="list"></forge-icon>
            <a href="./index.html">Active Projects</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="rocket"></forge-icon>
            <a href="./go-lives.html">Projects That Went Live</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="warning"></forge-icon>
            <a href="./risk.html">At Risk</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="bell"></forge-icon>
            <a href="./alerts.html">Alerts</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="history"></forge-icon>
            <a href="./changes.html">Changes</a>
          </forge-list-item>
        </forge-list>
      </forge-mini-drawer>

      <main slot="body" class="page">
        <h1>Executive Summary</h1>
        <p class="stamp forge-typography--label2" id="stamp">No dataset loaded yet.</p>
```

Note: this page's `<section class="panel forge-card">` for Portfolio Health etc. already follows immediately after the nav in the source — no separate replacement needed for that part, it's preserved as-is right after this block.

- [x] **Step 3: `executive.html` — close wrapper elements and add scripts**

Replace:

```html
    </main>

    <script src="./data/projects.js?v=20260805090032"></script>
    <script src="./data/project_changes.js?v=20260805090032"></script>
    <script src="./data/history/change_log.js?v=20260805090032"></script>
    <script src="./app.js?v=20260805090032"></script>
    <script src="./executive.js?v=20260805090032"></script>
  </body>
```

with:

```html
      </main>
    </forge-scaffold>

    <script src="./data/projects.js?v=20260805090032"></script>
    <script src="./data/project_changes.js?v=20260805090032"></script>
    <script src="./data/history/change_log.js?v=20260805090032"></script>
    <script src="./app.js?v=20260805090032"></script>
    <script src="./executive.js?v=20260805090032"></script>
    <script src="./alerts.js?v=20260805090032"></script>
    <script src="./app-shell.js?v=20260805090032"></script>
  </body>
```

- [x] **Step 4: `alerts.html` — add bundle script tag**

After the `forge-card.css` link (before the existing `<style>` block), add:

```html
    <script type="module" src="./dist/forge-bundle.js"></script>
```

- [x] **Step 5: `alerts.html` — replace hero + nav**

Replace:

```html
  <body data-dashboard-mode="alerts">
    <main class="page">
      <header class="hero forge-card">
        <p class="eyebrow">EPL Professional Services</p>
        <h1>🚨 Project Alerts</h1>
        <p class="lede">
          Real-time monitoring of critical issues, warnings, and projects requiring immediate management attention.
        </p>
        <p class="stamp" id="stamp">No dataset loaded yet.</p>
      </header>

      <nav class="tabs-nav" aria-label="Dashboard Views">
        <a class="tab-link" href="./executive.html">Executive Summary</a>
        <a class="tab-link" href="./index.html">Active Projects</a>
        <a class="tab-link" href="./go-lives.html">Projects That Went Live</a>
        <a class="tab-link" href="./risk.html">At Risk</a>
        <a class="tab-link is-active" href="./alerts.html">Alerts</a>
        <a class="tab-link" href="./changes.html">Changes</a>
        <!-- <a class="tab-link" href="./sales-handoff.html">Sales Handoff</a> -->
        <!-- <a class="tab-link" href="./new-project.html">New Project</a> -->
      </nav>
```

with:

```html
  <body data-dashboard-mode="alerts">
    <forge-scaffold style="min-height: 100vh;">
      <forge-app-bar slot="header" title-text="Project Dashboard">
        <forge-icon slot="logo" name="dashboard"></forge-icon>
        <forge-app-bar-menu-button slot="start" id="appBarMenuButton"></forge-app-bar-menu-button>
        <forge-app-bar-search slot="center">
          <input type="search" placeholder="Search projects...">
        </forge-app-bar-search>
        <forge-app-bar-help-button slot="end" id="appBarHelpButton"></forge-app-bar-help-button>
        <forge-app-bar-notification-button slot="end" id="alertsNotificationButton"></forge-app-bar-notification-button>
        <forge-app-bar-profile-button slot="end" avatar-icon="account" sign-out-button="false"></forge-app-bar-profile-button>
      </forge-app-bar>

      <forge-mini-drawer slot="body-left" hover open id="appDrawer">
        <forge-list>
          <forge-list-item>
            <forge-icon slot="start" name="bar_chart"></forge-icon>
            <a href="./executive.html">Executive Summary</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="list"></forge-icon>
            <a href="./index.html">Active Projects</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="rocket"></forge-icon>
            <a href="./go-lives.html">Projects That Went Live</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="warning"></forge-icon>
            <a href="./risk.html">At Risk</a>
          </forge-list-item>
          <forge-list-item selected>
            <forge-icon slot="start" name="bell"></forge-icon>
            <a href="./alerts.html">Alerts</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="history"></forge-icon>
            <a href="./changes.html">Changes</a>
          </forge-list-item>
        </forge-list>
      </forge-mini-drawer>

      <main slot="body" class="page">
        <h1>🚨 Project Alerts</h1>
        <p class="stamp forge-typography--label2" id="stamp">No dataset loaded yet.</p>
```

- [x] **Step 6: `alerts.html` — close wrapper elements and add `app-shell.js`**

Replace:

```html
    </main>

    <script src="./data/projects.js?v=20260615110832"></script>
    <script src="./data/project_changes.js?v=20260615110832"></script>
    <script src="./data/history/change_log.js?v=20260615110832"></script>
    <script src="./app.js?v=20260615110832"></script>
    <script src="./alerts.js?v=20260615110832"></script>
  </body>
```

with:

```html
      </main>
    </forge-scaffold>

    <script src="./data/projects.js?v=20260615110832"></script>
    <script src="./data/project_changes.js?v=20260615110832"></script>
    <script src="./data/history/change_log.js?v=20260615110832"></script>
    <script src="./app.js?v=20260615110832"></script>
    <script src="./alerts.js?v=20260615110832"></script>
    <script src="./app-shell.js?v=20260615110832"></script>
  </body>
```

- [x] **Step 7: Verify both pages with Playwright**

For each of `executive.html`, `alerts.html`:
1. Navigate, check console errors (expect 0 beyond the pre-existing favicon 404).
2. Screenshot — confirm app bar/drawer render, correct drawer item highlighted, decorative search box present but inert (typing in it does nothing, no console error).
3. Confirm existing page content still renders (executive.html's Portfolio Health cards; alerts.html's alert summary/category sections).
4. Confirm `#alertsNotificationButton` badge count matches alerts.html's own displayed "Total Alerts" number exactly (this is the strongest end-to-end check of the Group A wiring).

- [x] **Step 8: Commit**

```bash
git add dashboard/executive.html dashboard/alerts.html
git commit -m "Convert executive.html, alerts.html to the Forge app-bar/drawer shell"
```

---

## Task 6: Convert `new-project.html`, `sales-handoff.html`

**Files:**
- Modify: `dashboard/new-project.html` (Group B — no `app.js`, no data scripts, fallback badge only)
- Modify: `dashboard/sales-handoff.html` (Group B — same)

These two pages have no `.hero`/`<nav>` today (their nav links are commented out) — they get wrapped in the same scaffold/app-bar/drawer shell, with none of the 6 drawer items marked `selected` (consistent with today's "not in nav" status), and their existing `.form-header` banner + form content are left completely untouched inside the body slot.

- [x] **Step 1: `new-project.html` — add bundle script tag**

After the `forge-card.css` link (before the existing `<style>` block), add:

```html
    <script type="module" src="./dist/forge-bundle.js"></script>
```

- [x] **Step 2: `new-project.html` — wrap the body in the shell**

Replace:

```html
<body>
    <div class="project-container">
        <div class="form-header">
            <h1>Create New Project</h1>
            <p>Create a new project page in Confluence with all implementation details. The project will automatically appear in the dashboard after the next refresh.</p>
        </div>

        <div id="successMessage" class="success-message"></div>
        <div id="errorMessage" class="error-message"></div>
```

with:

```html
<body>
    <forge-scaffold style="min-height: 100vh;">
      <forge-app-bar slot="header" title-text="Project Dashboard">
        <forge-icon slot="logo" name="dashboard"></forge-icon>
        <forge-app-bar-menu-button slot="start" id="appBarMenuButton"></forge-app-bar-menu-button>
        <forge-app-bar-search slot="center">
          <input type="search" placeholder="Search projects...">
        </forge-app-bar-search>
        <forge-app-bar-help-button slot="end" id="appBarHelpButton"></forge-app-bar-help-button>
        <forge-app-bar-notification-button slot="end" id="alertsNotificationButton"></forge-app-bar-notification-button>
        <forge-app-bar-profile-button slot="end" avatar-icon="account" sign-out-button="false"></forge-app-bar-profile-button>
      </forge-app-bar>

      <forge-mini-drawer slot="body-left" hover open id="appDrawer">
        <forge-list>
          <forge-list-item>
            <forge-icon slot="start" name="bar_chart"></forge-icon>
            <a href="./executive.html">Executive Summary</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="list"></forge-icon>
            <a href="./index.html">Active Projects</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="rocket"></forge-icon>
            <a href="./go-lives.html">Projects That Went Live</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="warning"></forge-icon>
            <a href="./risk.html">At Risk</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="bell"></forge-icon>
            <a href="./alerts.html">Alerts</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="history"></forge-icon>
            <a href="./changes.html">Changes</a>
          </forge-list-item>
        </forge-list>
      </forge-mini-drawer>

      <main slot="body">
    <div class="project-container">
        <div class="form-header">
            <h1>Create New Project</h1>
            <p>Create a new project page in Confluence with all implementation details. The project will automatically appear in the dashboard after the next refresh.</p>
        </div>

        <div id="successMessage" class="success-message"></div>
        <div id="errorMessage" class="error-message"></div>
```

- [x] **Step 3: `new-project.html` — close wrapper elements and add `app-shell.js`**

Find the end of the file. Replace:

```html
    <script src="new-project.js?v=1781707120"></script>
</body>
</html>
```

with:

```html
      </main>
    </forge-scaffold>

    <script src="new-project.js?v=1781707120"></script>
    <script src="./app-shell.js?v=1781707120"></script>
</body>
</html>
```

(Note: the `<div class="project-container">` closing tag right before `</body>` in the original file now needs one more closing — verify with the diff that the pre-existing `</div>` count still balances against the newly-added `<main slot="body">` opening tag; the `</main>` added here closes `<main slot="body">`, and the original file's own trailing `</div>` already closes `.project-container`, so no additional `</div>` is needed here.)

- [x] **Step 4: `sales-handoff.html` — repeat the same pattern**

Add the bundle script tag after `forge-card.css`:

```html
    <script type="module" src="./dist/forge-bundle.js"></script>
```

Replace:

```html
<body>
    <div class="handoff-container">
        <div class="form-header">
            <h1>Sales Handoff Document</h1>
            <p>Complete this form to create a Sales & Client Handoff Information page for the selected project. This facilitates knowledge transfer from the Account Executive to the Professional Services team.</p>
        </div>

        <div id="successMessage" class="success-message"></div>
        <div id="errorMessage" class="error-message"></div>
```

with:

```html
<body>
    <forge-scaffold style="min-height: 100vh;">
      <forge-app-bar slot="header" title-text="Project Dashboard">
        <forge-icon slot="logo" name="dashboard"></forge-icon>
        <forge-app-bar-menu-button slot="start" id="appBarMenuButton"></forge-app-bar-menu-button>
        <forge-app-bar-search slot="center">
          <input type="search" placeholder="Search projects...">
        </forge-app-bar-search>
        <forge-app-bar-help-button slot="end" id="appBarHelpButton"></forge-app-bar-help-button>
        <forge-app-bar-notification-button slot="end" id="alertsNotificationButton"></forge-app-bar-notification-button>
        <forge-app-bar-profile-button slot="end" avatar-icon="account" sign-out-button="false"></forge-app-bar-profile-button>
      </forge-app-bar>

      <forge-mini-drawer slot="body-left" hover open id="appDrawer">
        <forge-list>
          <forge-list-item>
            <forge-icon slot="start" name="bar_chart"></forge-icon>
            <a href="./executive.html">Executive Summary</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="list"></forge-icon>
            <a href="./index.html">Active Projects</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="rocket"></forge-icon>
            <a href="./go-lives.html">Projects That Went Live</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="warning"></forge-icon>
            <a href="./risk.html">At Risk</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="bell"></forge-icon>
            <a href="./alerts.html">Alerts</a>
          </forge-list-item>
          <forge-list-item>
            <forge-icon slot="start" name="history"></forge-icon>
            <a href="./changes.html">Changes</a>
          </forge-list-item>
        </forge-list>
      </forge-mini-drawer>

      <main slot="body">
    <div class="handoff-container">
        <div class="form-header">
            <h1>Sales Handoff Document</h1>
            <p>Complete this form to create a Sales & Client Handoff Information page for the selected project. This facilitates knowledge transfer from the Account Executive to the Professional Services team.</p>
        </div>

        <div id="successMessage" class="success-message"></div>
        <div id="errorMessage" class="error-message"></div>
```

Replace:

```html
    <script src="sales-handoff.js?v=1781707120"></script>
</body>
</html>
```

with:

```html
      </main>
    </forge-scaffold>

    <script src="sales-handoff.js?v=1781707120"></script>
    <script src="./app-shell.js?v=1781707120"></script>
</body>
</html>
```

- [x] **Step 5: Verify both pages with Playwright**

For each of `new-project.html`, `sales-handoff.html`:
1. Navigate, check console errors (expect 0).
2. Screenshot — confirm app bar/drawer render (no item selected, since neither page is in the drawer), the existing purple `.form-header` banner and form fields are visually unchanged.
3. Confirm the form still works: fill a couple of fields, confirm no JS errors on interaction (do not actually submit, since that would call the real Confluence API).
4. Confirm `#alertsNotificationButton` shows the fallback (Red-status) count after the `fetch('./data/projects.json')` resolves.

- [x] **Step 6: Commit**

```bash
git add dashboard/new-project.html dashboard/sales-handoff.html
git commit -m "Convert new-project.html, sales-handoff.html to the Forge app-bar/drawer shell"
```

---

## Task 7: CSS cleanup — remove dead rules, restyle heading/stamp, brand the app bar

**Files:**
- Modify: `dashboard/styles.css`

**Interfaces:** None — pure CSS, no new selectors that other tasks depend on (Task 3-6 already reference `forge-typography--label2` on `.stamp`, which is a Forge-supplied class, not something defined here).

- [x] **Step 1: Merge `.hero, .panel` into just `.panel`**

Replace:

```css
.hero,
.panel {
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid var(--line);
  border-radius: 24px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(10px);
  transition: var(--transition);
}
```

with:

```css
.panel {
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid var(--line);
  border-radius: 24px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(10px);
  transition: var(--transition);
}
```

- [x] **Step 2: Remove `.hero` and `.hero::before`**

Delete these two blocks entirely:

```css
.hero {
  padding: 48px 40px;
  margin-bottom: 32px;
  background:
    linear-gradient(135deg, var(--forge-theme-brand) 0%, var(--forge-theme-primary) 50%, var(--forge-theme-primary-container-high) 100%);
  border: none;
  box-shadow: 0 20px 60px rgba(63, 81, 181, 0.25);
  position: relative;
  overflow: hidden;
}

.hero::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background:
    radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.1), transparent 40%),
    radial-gradient(circle at 80% 80%, rgba(255, 255, 255, 0.08), transparent 40%);
  pointer-events: none;
}
```

- [x] **Step 3: Remove `.eyebrow`**

Delete:

```css
.eyebrow {
  margin: 0 0 12px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  position: relative;
  z-index: 1;
}
```

- [x] **Step 4: Restyle `h1` for a plain (non-hero) heading**

Replace:

```css
h1 {
  font-size: clamp(2.5rem, 5vw, 4.5rem);
  line-height: 1.1;
  color: #ffffff;
  font-weight: 800;
  letter-spacing: -0.02em;
  position: relative;
  z-index: 1;
  text-shadow: 0 2px 20px rgba(0, 0, 0, 0.1);
}
```

with:

```css
h1 {
  font-size: 2rem;
  line-height: 1.25;
  color: var(--ink);
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 24px 0 4px;
}
```

- [x] **Step 5: Remove `.lede` and the hero-scoped color overrides**

Replace:

```css
.lede,
.stamp,
.panel-head p,
label,
select,
input,
td,
th {
  font-family: "Roboto", "Helvetica Neue", Arial, sans-serif;
}

.lede,
.stamp,
.panel-head p {
  color: var(--muted);
}

.hero .lede,
.hero .stamp {
  color: rgba(239, 247, 255, 0.92);
}

.lede {
  max-width: 760px;
  margin: 16px 0 8px;
  font-size: 1.1rem;
  line-height: 1.6;
  position: relative;
  z-index: 1;
  font-weight: 400;
}

.stamp {
  margin: 0;
}
```

with:

```css
.stamp,
.panel-head p,
label,
select,
input,
td,
th {
  font-family: "Roboto", "Helvetica Neue", Arial, sans-serif;
}

.stamp,
.panel-head p {
  color: var(--muted);
}

.stamp {
  margin: 0 0 20px;
}
```

- [x] **Step 6: Remove the `.tabs-nav` rule nested in the responsive media query**

Find (this is inside an existing `@media` block, alongside an unrelated `grid-template-columns: 1fr;` rule that must stay):

```css
  .tabs-nav {
    flex-direction: column;
  }
}
```

Delete just the `.tabs-nav { flex-direction: column; }` rule, keeping the enclosing media query's closing brace and any sibling rules intact:

```css
}
```

- [x] **Step 7: Remove `.tabs-nav`, `.tab-link`, `.tab-link:hover`, `.tab-link.is-active`**

Delete:

```css
.tabs-nav {
  display: flex;
  gap: 6px;
  margin: 0 0 32px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(10px);
}

.tab-link {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 10px 16px;
  border-radius: 12px;
  color: var(--muted);
  text-decoration: none;
  font-family: "Inter", sans-serif;
  font-weight: 600;
  font-size: 0.9rem;
  letter-spacing: -0.01em;
  background: transparent;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.tab-link:hover {
  background: var(--accent-soft);
  color: var(--accent);
  text-decoration: none;
  transform: translateY(-1px);
}

.tab-link.is-active {
  background: linear-gradient(135deg, var(--accent-strong) 0%, var(--accent) 100%);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}
```

- [x] **Step 8: Remove the per-page hero color variants**

Delete:

```css
.hero-go-live {
  background:
    linear-gradient(135deg, rgba(5, 64, 99, 0.97), rgba(26, 114, 163, 0.94)),
    linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0));
}

.hero-changes {
  background:
    linear-gradient(135deg, rgba(54, 78, 11, 0.96), rgba(108, 138, 28, 0.92)),
    linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0));
}

.hero-risk {
  background:
    linear-gradient(135deg, rgba(110, 24, 24, 0.97), rgba(184, 63, 32, 0.92)),
    linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0));
}
```

- [x] **Step 9: Add the app-bar brand color, once, at the end of the file**

Append to `dashboard/styles.css`:

```css
forge-app-bar {
  --forge-app-bar-background: var(--forge-theme-brand);
  --forge-app-bar-foreground: var(--forge-theme-on-brand);
}
```

- [x] **Step 10: Verify**

```bash
grep -n "\.hero\|\.eyebrow\|\.lede\|\.tabs-nav\|\.tab-link" dashboard/styles.css
```

Expected: no output (all removed). Then start the dashboard server and visually re-check all 8 pages via Playwright screenshots — confirm no layout regressions (panels, metrics, tables, forms all still look correct), the app bar shows the brand indigo color, and the plain heading + demoted stamp line read correctly above the controls panel on every page.

- [x] **Step 11: Commit**

```bash
git add dashboard/styles.css
git commit -m "Remove dead hero/tabs-nav CSS, restyle heading for the new app-bar shell"
```

---

## Task 8: Full verification pass

**Files:** none (verification only)

- [x] **Step 1: Run the existing test suite**

```bash
python3 -m unittest tests/test_change_report.py
node tests/test_changes_ui.js
node tests/test_app_shell.js
```

Expected: all pass.

- [x] **Step 2: Rebuild the Forge bundle from scratch to confirm reproducibility**

```bash
rm dashboard/dist/forge-bundle.js
npm run build:forge
git diff --stat dashboard/dist/forge-bundle.js
```

Expected: the file is regenerated; if the diff is non-empty, confirm it's only due to non-deterministic minifier output (e.g. variable renaming), not a functional change — re-run `node --check` on it.

- [x] **Step 3: Playwright pass across all 8 pages**

For each of `index.html`, `go-lives.html`, `risk.html`, `changes.html`, `alerts.html`, `executive.html`, `new-project.html`, `sales-handoff.html`:
- Navigate, confirm 0 console errors (beyond the pre-existing favicon 404).
- Confirm no failed network requests among `dashboard/dist/forge-bundle.js`, the Forge CSS files, and the Tyler font CDN link.
- Screenshot for a final visual check.

Additionally:
- On `index.html`, click each of the 6 drawer nav links in turn and confirm each one navigates to the correct page with the correct item now marked `selected`.
- Re-run the search-filter regression check from the original Forge restyle pass (type "test" into the app-bar search on `index.html`, confirm the table narrows from 155 rows).

- [x] **Step 4: Confirm the "no changes to JS behavior files" constraint held**

```bash
git diff --stat app.js alerts.js executive.js new-project.js sales-handoff.js 2>/dev/null
git diff --stat dashboard/app.js dashboard/alerts.js dashboard/executive.js dashboard/new-project.js dashboard/sales-handoff.js
```

Expected: no output (these files are untouched — `alerts.js` is only *included* on more pages via `<script src>` tags, never edited).

- [x] **Step 5: Final review**

```bash
git status --short
git diff --stat
```

Confirm the full change set matches this plan's scope: `package.json`/`package-lock.json`/`.gitignore`, `dashboard/forge-entry.js`, `dashboard/dist/forge-bundle.js`, `dashboard/app-shell.js`, `tests/test_app_shell.js`, all 8 dashboard HTML pages, and `dashboard/styles.css`.
