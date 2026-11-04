# CRM ARR on Active Projects: Design

**Date:** 2026-11-04
**Status:** Approved 2026-11-04 (CRM ARR stays local-only)

## Intent

Each active implementation on the dashboard is a client relationship that is worth something to Tyler. Today
the Active Projects page shows project health, timeline and Confluence contract values, but nothing about what
the client pays Tyler each year. This feature shows, for each project's client:

- **Total ARR**: the client's annual recurring revenue across all Tyler products, and
- **EPL ARR**: the part of that ARR from Enterprise Permitting & Licensing,

and rolls both up into the page's KPIs, so the portfolio can be read in revenue terms (how much client ARR is
tied to the implementations in flight, how much of it is EPL, and where it sits).

The data comes from Dynamics CRM through Tyler Foundry, reusing the connection already working in the Analyst
CoPilot project (`~/Tyler_Codex_Projects/Analyst CoPilot/app`).

## Goals

1. Two new sortable columns on the Active Projects table: **Total ARR** and **EPL ARR**.
2. Two new tiles in **Portfolio Snapshot**: **Client Total ARR** (with how many projects matched in CRM) and
   **EPL ARR** (with EPL as a share of client Total ARR).
3. A new **ARR by Region** chart in **Visual KPIs**: one bar per region, stacked EPL ARR vs other Tyler ARR.
4. A "CRM ARR checked ..." timestamp next to the existing "Last generated" stamp.
5. ARR is stored locally after one initial load and checked for changes by a weekend job (see *Polling
   schedule*); the page never waits on CRM.
6. The UI follows the Tyler Forge standard (see *UI*).

## Non-goals

- ARR on any other page (Go-Lives, At Risk, Contract Value, Executive Summary, Peer Compare). Later, maybe.
- Any change to the separate `dashboard/implementation/` dashboard.
- Live CRM calls from the browser.
- Using the direct Dynamics MCP credentials in Analyst CoPilot's `.env` (`DYNAMICS_MCP_URL`, token, client
  id/secret). They are unused there; this feature goes through the Foundry agent like CoPilot does.
- Upgrading Forge (for example to get `forge-count-card`).
- Showing ARR change history in the UI. The weekly job records changes to a local log so it is available
  later (for example on the Changes page), but no page displays it yet.

## Anti-goals (failure even if it "works")

- **Anything that writes to CRM.** The Foundry agent has write tools. Every request must be read-only.
- **Showing $0 for a client that wasn't found.** Unmatched or unfetched projects show "n/a", never $0.
- **Letting the agent do arithmetic.** Agents drop rows and miscount. The dashboard adds up ARR itself from
  rows it can count and check.
- **Silently incomplete totals.** If some accounts could not be fetched, the tiles say how many matched.
- **Publishing client ARR.** The GitHub repository (`ronaldferriero/Project-Dashboard`) is **public**, and
  `publish-update.sh` commits and pushes all of `dashboard/data/`. CRM data must not land in a committed or
  published path (see *Storage*).
- **Breaking the page when CRM is unavailable.** No key, a failed refresh, or a missing cache file must leave
  the rest of the dashboard working exactly as today.

## Definitions (decided with the user)

| Term | Definition |
| --- | --- |
| Client | The CRM account whose **Account Number** equals the number at the end of the project title. `Abilene, TX City of - 42004` -> Account Number `42004`. It is the Account Number field, **not** the Dynamics account GUID. |
| ARR source | CRM's **Active Customer Product Items**: the product line items under the client's products. |
| ARR amount | The item's **"Product…"** column (the money column next to the product details in the CRM view). The user confirmed this column is the ARR. The adjacent **"Direct Customer…"** column is **not** used. |
| Total ARR | Sum of the ARR amount over **all** of the client's active customer product items, in every division. |
| EPL ARR | The same sum, restricted to items whose **Division** is **Enterprise Permitting & Licensing**. |

Notes on the definitions:

- The full display name and logical name of the "Product…" column, the logical name of the customer product
  item entity, and the exact filter behind the "Active Customer Product Items" view were **not** confirmed in
  conversation. The builder must look them up (see *Discovery*), not guess them. Analyst CoPilot reads a
  different, higher-level entity (`tyl_customerproducts` with `sla_maintenanceamount`); that is **not** the
  source for this feature.
- Items with a blank ARR amount count as $0 toward the sums (several rows in the user's screenshot are blank).
  *Design call.*

### Reading the Account Number from the title *(design call)*

165 of 167 active titles end in ` - <digits>` (`Abilene, TX City of - 42004`). Two put a state code between the
dash and the number (`Yuba County - CA 48397`, `Hennepin County Health - MN 48979`). Accept both shapes and
nothing looser: the number must be the last thing in the title and must follow a dash, optionally with a
two-letter state code in between. Roughly `-\s*(?:[A-Z]{2}\s+)?(\d{3,7})\s*$`; the builder confirms the digit
range against real Account Numbers during discovery. A bare trailing number with no dash (a year, a phase number)
is **not** an Account Number. Titles that don't match show "n/a" with the tooltip "No account number in project
title", and the refresh prints them so they can be fixed in Confluence.

### Account Number matching more than one account *(design call)*

*Revised 2026-11-04 after discovery, decided with the user.* Discovery showed that one Account Number usually
covers a **family** of active accounts: one top-level account plus department (child) accounts whose parent is
in the same group (6 of 8 sampled numbers had 2 to 4 accounts).

- Match **active** CRM accounts only.
- **The client is the whole family**: every active account with that Account Number. Total ARR and EPL ARR
  sum the active product items on all of them.
- The family's display name is its top-level account's name (the account whose parent is not in the group).
- No active match: status `not_found` ("Account 5059 not found in CRM").
- More than one top-level account in the group (accounts sharing a number that are not parent and child):
  status `ambiguous` with the tooltip "Account Number 42004 has N separate top-level CRM accounts". The refresh
  prints these with the account names so they can be reviewed. The refresh summary lists every `ambiguous` and
  `not_found` account, and the "X of Y matched" tile detail keeps the gap visible.

## Connection (reused from Analyst CoPilot)

Analyst CoPilot's live mode (`CRM_MODE=foundry-agent`) reads Dynamics by chatting with a Foundry agent that
has the Dynamics MCP tools. Reuse exactly that route:

| Setting | Value |
| --- | --- |
| Base URL | `https://foundry.tylertechai.com` |
| Tenant | `dev` (sent as `X-Tenant-Slug`) |
| Agent | "EPL Support Agent (Test)", id `754773e3-5009-4a52-851d-14a1688c2a90` |
| Endpoint | `POST {base}/api/agents/{agentId}/stream` with `{threadId, messages: [{role: "user", content}]}` |
| Auth | `X-API-Key: <key>` |
| Response | Server-Sent Events; text arrives in `text-delta` events as `payload.text`; all other events ignored |

Reference implementation to port (TypeScript, read for behavior): `app/server/crm/agentCrmClient.ts`,
`agentPrompts.ts`, `foundryClient.ts`, `sse.ts`, `env.ts`.

**API key** *(design call)*: read `FOUNDRY_API_KEY` from this project's `.env` (already git-ignored). If it is not
set, read only the `FoundryAPIKey` value from Analyst CoPilot's project `.env`, at the path in
`ANALYST_COPILOT_ENV` (default `~/Tyler_Codex_Projects/Analyst CoPilot/.env`). This mirrors CoPilot's own
fallback, so the key lives in one place. Base URL, tenant and agent id are configurable through `.env` with the
values above as defaults. Placeholder values (`<your key>`, `replace-me`) count as unset. The key must never be
logged, written to a data file, or sent to the browser.

**Prompt rules** (carried over from CoPilot, all required):

- Every prompt starts with CoPilot's READ-ONLY instruction (`AGENT_READ_ONLY` in `agentPrompts.ts`).
- Every prompt names one exact read tool call (for example `dynamic_odata_query` with an entity set, filter and
  select) and tells the agent not to call any other tool.
- Replies are a single fenced ```json block of compact positional arrays; the parser takes the last JSON fence.
- Every value interpolated into a prompt is validated first. Account Numbers must match a strict pattern
  (digits only; the builder confirms the real format during discovery) and are rejected otherwise.
- Requests are batched (CoPilot uses 12 ids per call, 4 calls in parallel) because long replies get truncated.
  Each batch first establishes how many records to expect, then checks the rows returned; missing ones get one
  retry, and anything still missing is reported, not hidden.

## Discovery (first build step)

Before writing the fetcher, the builder runs read-only lookups through the same agent and records the answers
in the implementation notes:

1. Logical name of the customer product item entity behind "Active Customer Product Items", and that view's
   filter (the saved view's definition), so "active" means exactly what the CRM view means.
2. Logical name and type of the "Product…" ARR column, and of the Division field (and whether Division is a
   lookup, so the filter compares the right value for "Enterprise Permitting & Licensing").
3. How an item links to its account (directly, or through its parent customer product), and the logical name of
   the account's Account Number field.
4. Whether `dynamic_odata_query` supports server-side aggregation (`$apply` groupby/sum). If it does, prefer
   asking Dynamics for per-account, per-division sums plus item counts; if not, fetch item rows (amount,
   division, account number) and sum locally. Either way the arithmetic is done by Dynamics or by this code,
   never by the agent.

If any lookup contradicts this design (for example, ARR turns out to live on a different record), stop and
check with the user.

## Data flow

1. **Collect account numbers** from `dashboard/data/projects.json`: parse the trailing ` - <digits>` from each
   project title. Projects without one get no CRM data ("n/a").
2. **Fetch** ARR per account through the agent (batched, validated, read-only). Which accounts get fetched
   depends on the run type (see *Polling schedule*).
3. **Store** per account: account number, CRM account name, Total ARR, EPL ARR, item count, fetched-at time,
   last-checked time, and a status (`ok`, `not_found`, `ambiguous`, `error` with a short reason). The stored
   values persist between runs; the stored file is the source of truth the page reads.
4. **Record changes:** when a fetch returns a Total ARR or EPL ARR different from the stored value, append an
   entry to a local ARR change log (account number, field, old value, new value, detected-at time).
5. **Write** the browser file the dashboard loads (see *Storage*), keyed by Account Number, with the time of the
   last weekly check.
6. The page joins CRM entries to projects by Account Number at render time.

Expected run time: about 35 seconds per agent call in CoPilot's experience, so the one-time initial load for
~170 accounts, batched with 4 parallel calls, is on the order of minutes to tens of minutes. Later runs touch far
fewer accounts.

## Polling schedule (decided with the user)

ARR changes rarely, so the data is **stored once and checked for changes weekly**, not re-pulled on every
refresh. This keeps the number of CRM calls at any one time small.

| Run | When | What it fetches |
| --- | --- | --- |
| **Initial load** | Once, run by hand (`refresh_crm.sh --initial`) | Every active project's account. |
| **Weekly change check** | Scheduled, weekends | Only accounts whose ARR may have changed (below). |
| **New accounts** *(design call)* | During `refresh_dashboard.sh --full` | Only accounts never fetched before (a project that appeared in Confluence this week). Already-stored accounts are not touched. |
| **Monthly reconcile** *(design call)* | The weekly job on the first weekend of each month | Every account, as a safety net for anything change detection can miss. |
| **Manual** | `refresh_crm.sh --force` | Every account. |

**Change detection** *(design call; confirm in discovery)*: the weekly check asks Dynamics for customer product
items **modified since the last successful check** for the tracked accounts (by `modifiedon`), then re-fetches
the full totals only for the accounts those items belong to. Deactivating an item updates its `modifiedon`, so
items dropping out of "active" are caught. Hard-deleted items are not; the monthly reconcile catches those.
If discovery shows `modifiedon` filtering is not available or unreliable for these items, fall back to
re-fetching every account weekly and tell the user.

**Scheduling on macOS** *(design call)*:

- A launchd LaunchAgent (`~/Library/LaunchAgents/com.tyler.project-dashboard.crm-weekly.plist`) runs
  `refresh_crm.sh --weekly` every **Saturday at 6:00 AM** local time. If the Mac is asleep then, launchd runs it
  on wake. If the Mac is off, the run is missed, so:
- **Catch-up:** any `refresh_dashboard.sh` run (fast or full) checks the time of the last successful weekly
  check. If it is more than 8 days old and a Foundry key is configured, it starts the weekly check in the
  background and does not wait for it.
- `install_crm_schedule.sh` and `uninstall_crm_schedule.sh` install and remove the LaunchAgent. Installing it
  is a deliberate, separate step; nothing installs it automatically. The job logs to `/tmp/` like the dashboard
  server does, and the refresh summary (counts checked, changed, not found, ambiguous, errors) goes to that log.
- The job only writes local files. It never publishes, commits or pushes.

### Refresh entry points *(design calls)*

- New `refresh_crm.sh` (zsh, same style as `refresh_go_lives.sh`) with `--initial`, `--weekly`, `--new-only`
  and `--force` modes, matching the table above.
- `refresh_dashboard.sh --full` runs `refresh_crm.sh --new-only` after the Confluence fetch, **only when a
  Foundry key is configured**; with no key it skips silently. A CRM failure only prints a warning; the
  Confluence refresh and server start still succeed. A `--skip-crm` flag skips it explicitly.
- `publish-update.sh` passes `--skip-crm`. CRM data is never published, so fetching it during a publish only
  adds time (and Ron, who runs most publishes, has no Foundry key configured).
- The fast default `refresh_dashboard.sh` does not fetch CRM data, apart from the background catch-up above.
- The CRM fetch is a separate Python module (for example `fetch_crm_arr.py`) rather than more code in
  `fetch_confluence_dashboard_data.py`. Python matches the rest of this repo's tooling; no Node server is added.

## Storage

Client ARR is customer financial data and the repo is public, so CRM output is **local-only**:

- Written under a git-ignored path, for example `dashboard/data/crm/crm_arr.json` plus a `crm_arr.js` wrapper
  (same `window.<NAME> = ...` pattern as `write_js_data_file` in the Confluence fetcher). Add the folder to
  `.gitignore`.
- `publish-update.sh` runs `git add dashboard/data/`; a git-ignored subfolder is skipped by that command. Verify
  this with a dry run (`git add -n dashboard/data/`) once the files exist.
- The page loads the wrapper with a normal `<script>` tag. When the file is missing (fresh clone, GitHub Pages,
  no key), the page renders exactly as it does today, with the ARR columns, tiles and chart hidden.

## UI

Matches the approved mockup (`.superpowers/brainstorm/.../arr-forge-v2.html`), which was built from the
dashboard's own Forge stylesheets.

**Forge rules:**

- Colors only from Forge theme tokens (`--forge-theme-*`) or the dashboard's existing token-mapped variables. No
  new hard-coded colors.
- Snapshot tiles reuse the existing `.metric` tile markup and follow Forge's count-card anatomy: a `forge-icon`
  (`currency_usd`, already registered), the label, the count. `forge-count-card` itself is not in the installed
  Forge 3.15.2, so do not use it.
- The "CRM" marker on the tiles is a Forge badge in the info theme. Use either the `forge-badge` component
  (register it in `dashboard/forge-entry.js` and rebuild with `npm run build:forge`) or the CSS-only
  `.forge-badge` class with `forge-badge.css` linked; builder's choice.
- "n/a" for unmatched projects is italic, low-emphasis text (`--forge-theme-text-low`), with a tooltip naming
  the reason ("Account 5059 not found in CRM", "No account number in project title", "CRM fetch failed").
  Prefer `forge-tooltip` (register and rebuild); a `title` attribute is acceptable.
- The "CRM data as of" stamp uses the existing stamp style (`forge-typography--label2`).

**Behavior:**

- **Columns:** Total ARR and EPL ARR sit between Project Manager-side columns and Region, as in the mockup (the
  exact position is the builder's call). They are sortable via `data-sort-key` like the other columns, with
  "n/a" rows sorting last in both directions. Values are right-aligned, tabular numerals, whole dollars
  (`$612,400`).
- **Tiles:** Client Total ARR and EPL ARR follow the page's current filters, like the other Snapshot tiles.
  Compact currency (`$41.8M`). Detail lines: "All Tyler products · X of Y matched" and "Z% of client Total
  ARR".
- **Client counted once:** if two filtered projects share an Account Number, that client's ARR is added once in
  the tiles and chart. Each project row still shows its client's ARR.
- **Chart:** ARR by Region, one row per region in the filtered set, stacked EPL (primary token) vs other Tyler
  ARR (primary-container-high token), with a legend. Same "client counted once" rule, assigned to the region of
  the project. Clicking a region filters like the other charts if the existing chart filter mechanism makes that
  straightforward; otherwise not clickable.
- **Stamp:** "CRM ARR checked <date of last successful weekly check>". If that is more than 8 days old, or the
  last check had errors, append a short warning ("weekly CRM check overdue" / "some accounts could not be
  refreshed").
- **Export List** includes Total ARR and EPL ARR as plain numbers (blank for n/a).
- **Exec Level Notes** toggle and other existing controls are unaffected.

## Constraints

- Read-only against CRM, always (see *Anti-goals*).
- The page must work with the CRM file absent.
- No secrets in the repo, data files, logs or browser.
- Existing tests keep passing (`python3 -m unittest` suites, `node tests/*.js`).
- Cache-busting: add the new script tag to `index.html` with the same `?v=` token as its neighbors; it will be
  rewritten by `refresh_dashboard.sh`.

## Testing

- Python unit tests with the agent HTTP call mocked: title -> Account Number parsing, Account Number validation
  (rejects anything non-numeric), prompt text always starts with the READ-ONLY instruction and names one read
  tool, SSE parsing, JSON fence extraction, summation (blank amounts, division filter), completeness check and
  retry, the run modes (`--initial`, `--weekly`, `--new-only`, `--force`, first-weekend reconcile) choosing the
  right accounts, change detection only re-fetching affected accounts, change-log entries written only on real
  changes, the 8-day catch-up trigger, and the "CRM unavailable" path leaving stored data untouched.
- The LaunchAgent plist validates (`plutil -lint`), and a manual `launchctl kickstart` of the installed job
  completes and writes its log.
- Node test (same style as `tests/test_changes_ui.js`) for the rendering logic: n/a vs $0, client-counted-once in
  tiles and chart, sorting with n/a last, filter-following totals.
- A manual live run against Foundry, checked against two or three accounts' totals in the CRM "Active Customer
  Product Items" view.

## Left to the builder

- Module, function and file names; exact JSON shape of the cache file.
- Batch sizes and concurrency, within the completeness rules above.
- Column position, chart clickability, badge/tooltip implementation choice (within the Forge rules).
- Whether to aggregate in Dynamics or locally (decided by discovery step 4).
