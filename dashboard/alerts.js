// Alerts Dashboard Logic

function initAlertsDashboard() {
  if (typeof dashboardMode !== 'function' || dashboardMode() !== 'alerts') return;
  if (!state || !state.projects) return;

  const alerts = categorizeAlerts();
  renderAlertSummary(alerts);
  renderCriticalAlerts(alerts.critical);
  renderWarningAlerts(alerts.warning);
  renderScheduleAlerts(alerts.schedule);
  renderResourceAlerts(alerts.resource);
  renderTrendingAlerts(alerts.trending);
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
        badgeClass: 'alert-badge-overdue',
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
        badgeClass: status === 'Red' ? 'alert-badge-red' : 'alert-badge-yellow',
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
        badgeClass: 'alert-badge-red',
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
        badgeClass: 'alert-badge-red',
        meta: `Current: ${status}`,
        detail: `Status has moved to higher risk recently. ${project.project_health || ''}`
      });
    }
  });

  return alerts;
}

function renderAlertSummary(alerts) {
  const container = document.getElementById('alertSummary');
  if (!container) return;

  const totalCritical = alerts.critical.length;
  const totalWarning = alerts.warning.length;
  const totalSchedule = alerts.schedule.length;
  const totalResource = alerts.resource.length;
  const totalTrending = alerts.trending.length;
  const totalAlerts = totalCritical + totalWarning + totalSchedule + totalResource + totalTrending;

  container.innerHTML = `
    <div class="summary-stat">
      <div class="summary-stat-value">${totalAlerts}</div>
      <div class="summary-stat-label">Total Alerts</div>
    </div>
    <div class="summary-stat">
      <div class="summary-stat-value">${totalCritical}</div>
      <div class="summary-stat-label">Critical</div>
    </div>
    <div class="summary-stat">
      <div class="summary-stat-value">${totalWarning}</div>
      <div class="summary-stat-label">Warnings</div>
    </div>
    <div class="summary-stat">
      <div class="summary-stat-value">${totalSchedule}</div>
      <div class="summary-stat-label">Schedule</div>
    </div>
    <div class="summary-stat">
      <div class="summary-stat-value">${totalResource}</div>
      <div class="summary-stat-label">Resource</div>
    </div>
    <div class="summary-stat">
      <div class="summary-stat-value">${totalTrending}</div>
      <div class="summary-stat-label">Trending</div>
    </div>
  `;
}

function renderCriticalAlerts(alerts) {
  renderAlertSection('criticalAlerts', 'criticalCount', alerts, 'alert-card-critical');
}

function renderWarningAlerts(alerts) {
  renderAlertSection('warningAlerts', 'warningCount', alerts, 'alert-card-warning');
}

function renderScheduleAlerts(alerts) {
  renderAlertSection('scheduleAlerts', 'scheduleCount', alerts, '');
}

function renderResourceAlerts(alerts) {
  renderAlertSection('resourceAlerts', 'resourceCount', alerts, '');
}

function renderTrendingAlerts(alerts) {
  renderAlertSection('trendingAlerts', 'trendingCount', alerts, '');
}

function renderAlertSection(containerId, countId, alerts, cardClass) {
  const container = document.getElementById(containerId);
  const countElement = document.getElementById(countId);

  if (!container) return;

  if (countElement) {
    countElement.textContent = alerts.length;
  }

  if (alerts.length === 0) {
    container.innerHTML = `
      <div class="alert-empty">
        <div class="alert-empty-icon">✅</div>
        <div class="alert-empty-text">No alerts in this category</div>
      </div>
    `;
    return;
  }

  container.innerHTML = alerts.map(alert => `
    <div class="alert-card ${cardClass}" onclick="navigateToProject('${escapeHtml(alert.project.url)}')">
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
