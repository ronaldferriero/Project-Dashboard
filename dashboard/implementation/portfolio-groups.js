// Executive Summary grouping and data-coverage rules. Pure functions (no DOM) so they can be unit tested.
//
// Three things are kept separate on purpose and are never merged into one score:
//   - Reported Health   : the status entered on the list (Green / Yellow / Red / ...), "Unknown" when blank
//   - Computed Health   : the dashboard's own risk signal (project.computedHealth), unassessed until inputs exist
//   - Lifecycle stage   : the list status (Signed - Not Started / Active / On Hold)
// A project with missing information must never be shown in a "good news" group.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PortfolioGroups = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const UNRATED = "Unknown";

  // deps: { statusLabel, parseGoLiveDate, isCritical, needsAttention }
  function missingInformation(project, deps) {
    const missing = [];
    const status = deps.statusLabel(project.project_status);
    if (!status || status === UNRATED) missing.push("Reported health not set");
    if (!deps.parseGoLiveDate(project.go_live)) missing.push("No go-live date");
    return missing;
  }

  // Every project lands in exactly one group, most urgent first: Immediate Action, Monitor, Needs assessment, No Current Alerts.
  function groupProjects(projects, deps) {
    const groups = { critical: [], attention: [], needsAssessment: [], onTrack: [] };
    projects.forEach((project) => {
      if (deps.isCritical(project)) groups.critical.push(project);
      else if (deps.needsAttention(project)) groups.attention.push(project);
      else if (missingInformation(project, deps).length) groups.needsAssessment.push(project);
      else groups.onTrack.push(project);
    });
    return groups;
  }

  function isComputedAssessed(project) {
    return !!(project.computedHealth && project.computedHealth.assessed);
  }

  function coverage(projects, deps) {
    const total = projects.length;
    const count = (test) => projects.filter(test).length;
    const row = (key, label, have, note) => ({ key, label, have, total, missing: total - have, pct: total ? Math.round((have / total) * 100) : 0, note });
    return [
      row("reported", "Reported Health set", count((p) => { const s = deps.statusLabel(p.project_status); return s && s !== UNRATED; }), "from the list"),
      row("computed", "Computed Health assessed", count(isComputedAssessed), "dashboard risk signal"),
      row("golive", "Go-live date entered", count((p) => !!deps.parseGoLiveDate(p.go_live)), "from the list"),
      row("stage", "Lifecycle stage set", count((p) => !!(p.portfolio && p.portfolio.list_status)), "list status"),
    ];
  }

  // Contract value of every open project, with the part that is overdue (planned go-live passed, still open) shown separately.
  // An overdue project is delayed, not finished: it stays in the open total and is also counted as exposure.
  // deps: { contractValueForRow, isOverdue }
  function valueExposure(projects, deps) {
    const result = { open: { count: 0, saas: 0, services: 0, total: 0 }, overdue: { count: 0, saas: 0, services: 0, total: 0, projects: [] }, missing: 0 };
    projects.forEach((project) => {
      const value = deps.contractValueForRow(project);
      if (!value.complete) { result.missing += 1; return; }
      const add = (bucket) => { bucket.count += 1; bucket.saas += value.saas; bucket.services += value.services; bucket.total += value.saas + value.services; };
      add(result.open);
      if (deps.isOverdue(project)) { add(result.overdue); result.overdue.projects.push(project); }
    });
    return result;
  }

  return { missingInformation, groupProjects, coverage, isComputedAssessed, valueExposure };
});
