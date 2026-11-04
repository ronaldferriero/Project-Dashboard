// Alerts Dashboard Logic

function initAlertsDashboard() {
  if (typeof dashboardMode !== 'function' || !['alerts', 'risk'].includes(dashboardMode())) return;
  if (!state || !state.projects) return;

  const alerts = categorizeAlerts();
  const computed = computeComputedHealthAlerts();
  renderAlertSummary(alerts, computed);
  renderCriticalAlerts(alerts.critical);
  renderWarningAlerts(alerts.warning);
  renderScheduleAlerts(alerts.schedule);
  renderResourceAlerts(alerts.resource);
  renderTrendingAlerts(alerts.trending);
  renderComputedHealthAlerts(computed);
}

// Computed Risk Signal alerts (independent of Reported Health; see health-model.js), sorted by severity.
// Returns null when the model has not been generated. Computed once per page render.
function computeComputedHealthAlerts() {
  const H = window.EPLHealth;
  const config = window.PROJECT_DASHBOARD_DATA && window.PROJECT_DASHBOARD_DATA.health_model;
  if (!H || !config) return null;
  const history = (window.COMPUTED_HEALTH_HISTORY_DATA && window.COMPUTED_HEALTH_HISTORY_DATA.projects) || {};
  const ctx = { config, history, today: new Date() };
  const alerts = state.projects.flatMap(project => H.buildRow(project, ctx).alerts);
  const order = { critical: 0, warning: 1, trending: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity] || a.projectTitle.localeCompare(b.projectTitle));
}

// Each computed alert links to the executive detail for its project.
function renderComputedHealthAlerts(computed) {
  const container = document.getElementById('computedAlerts');
  const countEl = document.getElementById('computedCount');
  if (!container || !countEl) return;
  const total = computed ? computed.length : 0;
  renderListToggle('computedAlertsToggle', { key: 'computedAlerts', total, noun: 'alerts', controls: 'computedAlerts' }, () => renderComputedHealthAlerts(computed));
  countEl.textContent = computed ? total : '—';
  if (!computed) {
    container.innerHTML = '<p class="ch-muted">The Computed Risk Signal has not been generated yet.</p>';
    return;
  }
  if (!total) {
    container.innerHTML = '<p class="ch-muted">No Computed Risk Signal alerts. Projects without a Computed Risk Signal assessment do not generate alerts.</p>';
    return;
  }
  container.innerHTML = `<ul class="ch-alert-list">${collapsibleRows(computed, 'computedAlerts').map(a => `
    <li class="ch-alert ch-alert-${escapeHtml(a.severity)}">
      <strong>${escapeHtml(a.severity.toUpperCase())}</strong> —
      <a href="./executive.html?project=${encodeURIComponent(a.pageId)}">${escapeHtml(a.projectTitle)}</a>: ${escapeHtml(a.title)}
      <div class="ch-muted ch-small">${escapeHtml(a.evidence)}</div>
    </li>`).join('')}</ul>`;
}

function categorizeAlerts() {
  const projects = state.projects;
  const riskUpKeys = latestRiskUpProjectKeys(currentChangesReport());
  const now = new Date();

  const alerts = {
    critical: [],
    warning: [],
    schedule: [],
    resource: [],
    trending: []
  };

  projects.forEach(project => {
    const status = statusLabel(project.project_status);
    const clientStatus = statusLabel(project.client_status);
    const goLiveDate = parseGoLiveDate(project.go_live);
    const daysUntil = goLiveDate ? Math.floor((goLiveDate - now) / (1000 * 60 * 60 * 24)) : null;
    const pageIdKey = normalize(project.page_id) ? `page:${normalize(project.page_id)}` : "";
    const titleKey = normalize(project.title) ? `title:${normalize(project.title).toLowerCase()}` : "";
    const hasDegraded = (pageIdKey && riskUpKeys.has(pageIdKey)) || (titleKey && riskUpKeys.has(titleKey));

    // CRITICAL ALERTS: Red status projects due in < 30 days
    if (status === 'Red' && daysUntil !== null && daysUntil >= 0 && daysUntil < 30) {
      alerts.critical.push({
        project,
        type: 'red-urgent',
        title: project.title,
        badge: 'RED',
        badgeClass: 'alert-badge-red',
        meta: `Go-Live in ${daysUntil} days`,
        detail: `Red status with imminent go-live. ${project.project_health || 'No status notes available.'}`
      });
    }

    // CRITICAL ALERTS: Past due projects
    if (daysUntil !== null && daysUntil < 0) {
      const daysOverdue = Math.abs(daysUntil);
      alerts.critical.push({
        project,
        type: 'past-due',
        title: project.title,
        badge: `${daysOverdue}d OVERDUE`,
        badgeClass: 'alert-badge-neutral',
        meta: `Status: ${status}`,
        detail: `Go-live was ${project.go_live}. ${project.project_health || ''}`
      });
    }

    // WARNING ALERTS: Yellow projects with multiple risk signals
    if (status === 'Yellow' && daysUntil !== null && daysUntil < 60) {
      const riskCategories = getProjectRiskCategories(project);
      if (riskCategories.length > 1) {
        alerts.warning.push({
          project,
          type: 'yellow-multi-risk',
          title: project.title,
          badge: 'YELLOW',
          badgeClass: 'alert-badge-yellow',
          meta: `Go-Live in ${daysUntil} days`,
          detail: `Multiple risks: ${riskCategories.map(c => c.label).join(', ')}`
        });
      }
    }

    // WARNING ALERTS: Client dissatisfaction
    if (clientStatus === 'Red' || clientStatus === 'Yellow') {
      alerts.warning.push({
        project,
        type: 'client-risk',
        title: project.title,
        badge: `Client ${clientStatus}`,
        badgeClass: clientStatus === 'Red' ? 'alert-badge-red' : 'alert-badge-yellow',
        meta: `Go-Live: ${project.go_live || 'TBD'}`,
        detail: project.client_health || 'Client health concern identified.'
      });
    }

    // SCHEDULE ALERTS: Due within 30 days with any risk
    if (daysUntil !== null && daysUntil >= 0 && daysUntil <= 30 && status !== 'Green') {
      alerts.schedule.push({
        project,
        type: 'due-soon',
        title: project.title,
        badge: `${daysUntil} days`,
        badgeClass: 'alert-badge-neutral',
        meta: `Status: ${status}`,
        detail: `Approaching go-live with ${status} status. ${project.project_health || ''}`
      });
    }

    // RESOURCE ALERTS: Missing PM or IM
    const missingPM = !canonicalPersonName(project.project_manager);
    const missingIM = !canonicalPersonName(project.implementation_manager);
    if (missingPM || missingIM) {
      const missing = [];
      if (missingPM) missing.push('PM');
      if (missingIM) missing.push('IM');
      alerts.resource.push({
        project,
        type: 'missing-owner',
        title: project.title,
        badge: `No ${missing.join('/')}`,
        badgeClass: 'alert-badge-neutral',
        meta: `Go-Live: ${project.go_live || 'TBD'}`,
        detail: `Project is missing ${missing.join(' and ')} assignment.`
      });
    }

    // TRENDING ALERTS: Recently degraded status
    if (hasDegraded) {
      alerts.trending.push({
        project,
        type: 'status-degraded',
        title: project.title,
        badge: 'DEGRADED',
        badgeClass: 'alert-badge-neutral',
        meta: `Current: ${status}`,
        detail: `Status has moved to higher risk recently. ${project.project_health || ''}`
      });
    }
  });

  Object.values(alerts).forEach(group => group.forEach(alert => { alert.tone = alertTone(alert); }));
  return alerts;
}

// Summary tiles in page order. Total counts the five rule-based categories (the same number as the app-bar
// bell); the Computed Risk Signal is a separate model, shown on its own tile.
function alertSummaryTiles(alerts, computed) {
  const total = ['critical', 'warning', 'schedule', 'resource', 'trending'].reduce((sum, key) => sum + alerts[key].length, 0);
  return [
    { label: 'Total Alerts', icon: 'bell', value: total, target: null, detail: 'Rule-based alerts' },
    { label: 'Critical', icon: 'alert_decagram', value: alerts.critical.length, target: 'criticalAlertsSection' },
    { label: 'Warning', icon: 'warning', value: alerts.warning.length, target: 'warningAlertsSection' },
    {
      label: 'Computed Risk Signal', icon: 'calculator_variant', value: computed ? computed.length : '—', target: 'computedAlertsSection',
      detail: computed ? 'Separate model, not in total' : 'Not generated yet',
    },
    { label: 'Schedule', icon: 'calendar_clock', value: alerts.schedule.length, target: 'scheduleAlertsSection' },
    { label: 'Resource', icon: 'account_group', value: alerts.resource.length, target: 'resourceAlertsSection' },
    { label: 'Trending', icon: 'trending_down', value: alerts.trending.length, target: 'trendingAlertsSection' },
  ];
}

// Neutral Snapshot-style tiles (same .metric markup as Active Projects); each category jumps to its section.
function renderAlertSummary(alerts, computed) {
  const container = document.getElementById('alertSummary');
  if (!container) return;
  container.innerHTML = alertSummaryTiles(alerts, computed).map(tile => {
    const body = `
      <h3><forge-icon name="${escapeHtml(tile.icon)}" aria-hidden="true"></forge-icon>${escapeHtml(tile.label)}</h3>
      <p>${escapeHtml(String(tile.value))}</p>
      ${tile.detail ? `<div class="metric-detail">${escapeHtml(tile.detail)}</div>` : ''}`;
    return tile.target
      ? `<a class="metric metric-link metric-alert" href="#${escapeHtml(tile.target)}">${body}</a>`
      : `<article class="metric metric-alert">${body}</article>`;
  }).join('');
}

function renderCriticalAlerts(alerts) {
  renderAlertSection('criticalAlerts', 'criticalCount', alerts);
}

function renderWarningAlerts(alerts) {
  renderAlertSection('warningAlerts', 'warningCount', alerts);
}

function renderScheduleAlerts(alerts) {
  renderAlertSection('scheduleAlerts', 'scheduleCount', alerts);
}

function renderResourceAlerts(alerts) {
  renderAlertSection('resourceAlerts', 'resourceCount', alerts);
}

function renderTrendingAlerts(alerts) {
  renderAlertSection('trendingAlerts', 'trendingCount', alerts);
}

// Cards are colored by status, like the Snapshot tiles: the client's status for client-health alerts,
// the project's status for everything else. The section an alert sits in never sets its color.
function alertTone(alert) {
  const status = alert.type === 'client-risk' ? alert.project.client_status : alert.project.project_status;
  return metricToneForStatus(status);
}

function renderAlertSection(containerId, countId, alerts) {
  const container = document.getElementById(containerId);
  const countElement = document.getElementById(countId);

  if (!container) return;

  if (countElement) {
    countElement.textContent = alerts.length;
  }
  const cardLimit = typeof CollapsibleList === 'undefined' ? undefined : CollapsibleList.CARD_LIMIT;
  renderListToggle(`${containerId}Toggle`, { key: containerId, total: alerts.length, limit: cardLimit, noun: 'alerts', controls: containerId },
    () => renderAlertSection(containerId, countId, alerts));

  if (alerts.length === 0) {
    container.innerHTML = `
      <div class="alert-empty">
        <div class="alert-empty-icon"><forge-icon name="check_circle_outline"></forge-icon></div>
        <div class="alert-empty-text">No alerts in this category</div>
      </div>
    `;
    return;
  }

  container.innerHTML = collapsibleRows(alerts, containerId, cardLimit).map(alert => `
    <div class="alert-card${alert.tone ? ` alert-card-${alert.tone}` : ''}" onclick="navigateToProject('${escapeHtml(alert.project.url)}')">
      <div class="alert-card-header">
        <h3 class="alert-card-title">${escapeHtml(alert.title)}</h3>
        <span class="alert-badge ${alert.badgeClass}">${alert.badge}</span>
      </div>
      <div class="alert-card-meta">${escapeHtml(alert.meta)}</div>
      <div class="alert-card-detail">${escapeHtml(alert.detail.substring(0, 150))}${alert.detail.length > 150 ? '...' : ''}</div>
    </div>
  `).join('');
}

function navigateToProject(url) {
  if (url) {
    window.open(url, '_blank');
  }
}

// Initialize when dashboard data is ready
if (typeof window !== 'undefined') {
  window.addEventListener('dashboardReady', initAlertsDashboard);
}
