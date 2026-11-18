# Forge App Shell: App Bar + Mini-Drawer Navigation

## Context

A prior pass ("Restyle the Project Dashboard with Tyler Forge") added Forge's design tokens, typography, and CSS-only button/card classes across all 8 dashboard pages, without changing any DOM structure or JS behavior. That pass deliberately deferred adopting real Forge custom elements.

The user shared a screenshot of a real Tyler product ("Manage Permit" — an EnerGov/Permitting-style app) as the target look: a persistent dark indigo `forge-app-bar` with logo, global search, and a utility icon row (help, notifications, avatar), plus a compact record-list pattern. This spec covers the **app bar + navigation chrome** half of that reference (the record-list/table redesign is an explicit follow-up, out of scope here).

This requires real interactive Forge custom elements (`forge-app-bar`, `forge-mini-drawer`, `forge-scaffold`, etc.), which pull in `lit`, `@floating-ui/dom`, `tslib`, and `@tylertech/forge-core` via bare module specifiers — something the previous CSS-only pass never needed to resolve. The goal here is to introduce those components across all 8 pages with a build approach robust enough not to silently break, while keeping every existing JS behavior (search/filter, sort, export, status editing, the go-lives refresh, alerts computation) working unmodified.

## Decisions From Discussion

- Scope order: app bar chrome first; the record-list/card layout redesign of the Projects table is a separate, later pass.
- Navigation moves from the pill tab row into a **persistent mini-drawer** (icon rail, expands on hover) rather than an overlay drawer or a full always-labeled sidebar.
- App bar utility icons: **help**, **notifications** (badge + link only, no dropdown preview), and a **decorative avatar** (no real auth, no dropdown actions). No theme toggle (dark mode is explicitly deferred), no translate, no AI sparkle, no app launcher — none of those map to a real feature today.
- App bar branding: a generic Forge/Tyler icon (from `@tylertech/tyler-icons`) plus the text "Project Dashboard" — no custom logo asset exists in the repo.
- The drawer holds exactly the 6 views currently in the visible nav (Executive Summary, Active Projects, Go-Lives, At Risk, Alerts, Changes). Sales Handoff and New Project stay hidden, unchanged from today.
- Global search in the app bar is **real**, not decorative: it drives the same filtering `app.js` already does via `#searchInput`.
- The `.hero` banner's descriptive copy (eyebrow, lede sentence) is dropped entirely to match the reference's plain-heading style. The "Last generated" timestamp is kept, demoted to a small subtle line.
- Dark mode is explicitly out of scope for this pass, including the toggle icon (omitted entirely rather than shown non-functional).

## Build Approach: esbuild bundle, not an import map

Real Forge custom elements resolve their internals via bare specifiers (`import { LitElement } from 'lit'`, `import { defineCustomElement } from '@tylertech/forge-core'`, etc.). A browser import map covering every nested dependency (`lit`, `lit-html`, `lit-element`, `@lit/reactive-element`, `@lit/context`, `@floating-ui/dom`, `tslib`, `@tylertech/forge-core`, `@tylertech/tyler-icons`) would work, but is fragile: any entry missed (now or after a future `npm update`) breaks a component silently at runtime with no clear error pointing at the cause.

Instead:
- Add `esbuild` as a devDependency.
- Add `dashboard/forge-entry.js` — a small entry module that imports and calls exactly the `define*Component()` functions this pass needs: app bar, app-bar menu/search/help/notification/profile buttons, mini-drawer, scaffold, plus the button/card/badge definitions already relied on for CSS-only classes.
- Add an npm script, e.g. `"build:forge": "esbuild dashboard/forge-entry.js --bundle --format=esm --outfile=dashboard/dist/forge-bundle.js"`.
- Run it once now and **commit the output** `dashboard/dist/forge-bundle.js`. Each of the 8 pages loads it with one line: `<script type="module" src="./dist/forge-bundle.js"></script>`.
- Document in `CLAUDE.md` (or a comment at the top of `forge-entry.js`) that adding a new Forge component later means adding its `define*Component()` call here and re-running `npm run build:forge`.

This keeps day-to-day serving exactly as it is today (`dashboard_server.py` serves static files, nothing new to run), while avoiding the fragility of a hand-maintained import map.

## Page Shell: `forge-scaffold`

Every page's `<body>` restructures around `forge-scaffold`, which provides named layout slots instead of a hand-rolled flex layout:

```html
<forge-scaffold>
  <forge-app-bar slot="header" title-text="Project Dashboard">
    <forge-icon slot="logo" name="INSERT_ICON_NAME"></forge-icon>
    <forge-app-bar-menu-button slot="start"></forge-app-bar-menu-button>
    <forge-app-bar-search slot="center">
      <input id="searchInput" type="search" placeholder="Project, PM, IM, state...">
    </forge-app-bar-search>
    <forge-app-bar-help-button slot="end"></forge-app-bar-help-button>
    <forge-app-bar-notification-button slot="end" id="alertsNotificationButton"></forge-app-bar-notification-button>
    <forge-app-bar-profile-button slot="end" avatar-text="TT" sign-out-button="false" profile-button="false"></forge-app-bar-profile-button>
  </forge-app-bar>

  <forge-mini-drawer slot="body-left" hover>
    <!-- one entry per view, current page marked active; icons TBD from tyler-icons search -->
  </forge-mini-drawer>

  <main slot="body" class="page">
    <!-- existing panel content, minus .hero and the old <nav class="tabs-nav"> -->
  </main>
</forge-scaffold>
```

Notes:
- `forge-app-bar-menu-button` toggles the mini-drawer's `open` attribute (small inline script, one per page, identical across all 8 — consistent with how nav links are already duplicated per page in this codebase).
- The exact icon names for the logo and each drawer nav item need a quick `find_icons` lookup during implementation rather than being guessed here.
- Since `#searchInput` keeps its id and just moves inside `forge-app-bar-search`, `app.js`'s existing `document.getElementById('searchInput')` binding needs no changes. On `executive.html` and `alerts.html` (no filterable list today), the search box still renders for visual consistency but has no listener bound, matching current per-page conditionals in `app.js`.

## Page Heading Changes

Each page's `<header class="hero ...">` block is removed. In its place, a plain heading matching the view name (e.g. `<h1>Active Projects</h1>`) sits directly above the controls panel, with the existing `#stamp` "Last generated: ..." text kept but restyled smaller/subtler (e.g. `forge-typography--label2`) rather than the current large hero treatment. `styles.css` loses the `.hero` gradient/shadow rules (now dead) once all 8 pages stop using the class; the `--accent-strong`/`--forge-theme-brand` token mapping from the prior pass is otherwise unaffected since it's still used elsewhere (labels, etc.).

## Notifications Badge

A new small shared script (e.g. `dashboard/alerts-count.js`, loaded on all 8 pages after the data files) computes a total alert count from the already-loaded `PROJECT_DASHBOARD_DATA` — reusing whatever minimal subset of `alerts.js`'s logic actually determines "critical + warning" counts, without duplicating its full rendering logic. On page load, it sets `count` and `show-badge="true"` on `#alertsNotificationButton`; a click handler navigates to `alerts.html`. If the count is 0, `show-badge` stays false (no empty badge).

## Out of Scope (this pass)

- Record-list/card redesign of the Projects table (separate follow-up).
- Dark mode / theme toggle (explicitly deferred; icon omitted rather than shown disabled).
- Any change to `new-project.html` / `sales-handoff.html` beyond receiving the same scaffold/app-bar/drawer shell as the other 6 pages.
- Any change to alert-computation logic itself, beyond exposing a count for the badge.

## Files Touched

- `package.json` / `package-lock.json` — add `esbuild` devDependency, add `build:forge` script.
- `dashboard/forge-entry.js` — new.
- `dashboard/dist/forge-bundle.js` — new, generated + committed.
- `dashboard/alerts-count.js` — new, small.
- All 8 dashboard HTML pages — replace `<header class="hero...">` + `<nav class="tabs-nav">` with the `forge-scaffold`/`forge-app-bar`/`forge-mini-drawer` shell described above; add the bundle `<script>` tag.
- `dashboard/styles.css` — remove now-dead `.hero`/`.tabs-nav`/`.tab-link` rules once superseded; add minimal layout rules only if `forge-scaffold`'s defaults need adjusting for the existing `.page` content width/padding.
- No changes to `app.js`, `alerts.js`, `executive.js`, `new-project.js`, `sales-handoff.js`, or any data files.

## Verification

- `npm run build:forge` succeeds and produces `dashboard/dist/forge-bundle.js`.
- Start the dashboard server; load all 8 pages via Playwright:
  - No console errors (custom elements defined, no missing bare-specifier errors).
  - Drawer expands on hover and its links navigate correctly; current page shows as active.
  - App-bar search filters projects on index/go-lives/risk/changes exactly as `#searchInput` did before.
  - Notification badge shows the correct count and links to `alerts.html`.
  - Screenshot each page to confirm visual match with the reference's app-bar chrome.
- `git diff` confirms no changes to any of the five JS behavior files listed above.
