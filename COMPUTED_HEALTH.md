# Computed Health

Reported Health (red/yellow/green chosen by the PM/manager in Confluence) and Computed Health (independent, deterministic) are always kept separate. Computed Health appears only on the Executive Summary (and as alerts on the Alerts page). It never changes Reported Health.

## Where things live
- `health_model_config.json` – the only place for weights, labels, thresholds, colors, override vocabulary, alert limits. Embedded into `projects.json` as `health_model`.
- `health_model.py` – pure scoring functions (ratings, weights, status, overrides, completeness, Control Point rating/compliance, history, alignment matrix).
- `dashboard/health-model.js` – pure trend, alignment, alert, portfolio-measure functions.
- `dashboard/executive-health.js` – Executive Summary UI. `?sample=computed-health` shows clearly labeled SAMPLE data from `tests/fixtures/`.
- `dashboard/data/history/computed_health_history.json|js` – per-project score series (appended on each refresh). Change history reuses the existing snapshot diff via `computedHealth.changeView`.

## Confluence fields
Add any of these to the project page as either a header row + value row, or two-column label | value rows (any table). Labels are matched ignoring case/punctuation. Ratings are 0-4 (a number, or Healthy/Watch/At risk/Critical/Failed/Blocked); blank / N/A = not assessed (never zero).

- Assessment: Health Assessment Date, Current Implementation Stage, Health Override, Health Override Reason (not published), Recovery Owner, Recovery Target Date
- Project ratings: Schedule Health, Budget Health, Scope Health, Testing and Quality Health, Risk and Dependency Health, Tyler Team Health, Control Point Health
- Client ratings: Sponsor and Governance Health, Participation and Decision Health, Client Readiness Health, Adoption and Training Health, Client Sentiment Health
- Control Point data (counts unless noted): Required Artifacts, Approved Artifacts, Sign-Offs Due, Sign-Offs Completed, Overdue Sign-Offs, Maximum Sign-Off Days Overdue, Controls Tested, Controls Passed, Major Findings (= open/unresolved), Minor Findings, Corrective Actions Due, Corrective Actions Completed On Time, Mandatory Control Point Bypassed (yes/no), Audit Failed (yes/no)
- Optional extras: Remediation Plan Approved, Required Evidence Missing, Advanced Without Required Approval (yes/no)
- Health Override values (comma/pipe separated keywords): `blocked go-live`, `critical issue` (or security/regulatory/data integrity), `major audit failure`, `loss of confidence`.

## Assumptions
- Overall/Project/Client scores are published only when every dimension in that group is assessed; weights are never redistributed.
- Incomplete assessments show status Incomplete (gray). Override conditions and alerts are still listed for them.
- Structured Control Point data takes precedence over the manual Control Point Health rating once Required + Approved Artifacts exist (or a bypass/audit-fail flag is set). Missing sub-metrics are treated as "none reported". An open major finding with no "Remediation Plan Approved = yes" is rated 1.
- Corrective-action closure below 80% is rated 2 (spec did not define it). Repeated minor findings = 3 or more.
- Alignment adds a seventh category, "Not Comparable", for Reported statuses that are not Red/Yellow/Green (On Hold, Not Started, Unknown).

## Tests
`python3 -m unittest tests.test_health_model`, `node tests/test_health_model.js`, `node tests/test_changes_ui.js`. Regenerate the sample fixture with `python3 tests/build_sample_fixture.py`.
