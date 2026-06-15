// Executive Dashboard Logic

function initExecutiveDashboard() {
  console.log('[Executive] Init called, mode:', typeof dashboardMode === 'function' ? dashboardMode() : 'undefined');
  if (typeof dashboardMode !== 'function' || dashboardMode() !== 'executive') return;

  console.log('[Executive] State check:', {
    stateExists: !!state,
    projectsExists: !!(state && state.projects),
    projectsCount: state && state.projects ? state.projects.length : 0
  });

  if (!state || !state.projects) {
    console.error('[Executive] No data available - state.projects is missing');
    return;
  }

  console.log('[Executive] Rendering with', state.projects.length, 'projects');
  renderPortfolioCards();
  renderActionItems();
  renderResourceCards();
  renderTrendingCards();
}

function renderPortfolioCards() {
  const container = document.getElementById('portfolioCards');
  if (!container) return;

  const projects = state.projects;
  const critical = projects.filter(p => isCritical(p));
  const attention = projects.filter(p => needsAttention(p) && !isCritical(p));
  const onTrack = projects.filter(p => !isCritical(p) && !needsAttention(p));
  const totalProjects = projects.length;

  const cards = [
    {
      title: 'Critical Issues',
      value: critical.length,
      detail: `${((critical.length / totalProjects) * 100).toFixed(0)}% of portfolio`,
      type: 'critical',
      badge: 'URGENT',
      badgeClass: 'badge-critical',
      onClick: () => navigateToFiltered('critical')
    },
    {
      title: 'Needs Attention',
      value: attention.length,
      detail: `${((attention.length / totalProjects) * 100).toFixed(0)}% require monitoring`,
      type: 'warning',
      badge: 'MONITOR',
      badgeClass: 'badge-warning',
      onClick: () => navigateToFiltered('attention')
    },
    {
      title: 'On Track',
      value: onTrack.length,
      detail: `${((onTrack.length / totalProjects) * 100).toFixed(0)}% healthy`,
      type: 'success',
      onClick: () => navigateToFiltered('on-track')
    },
    {
      title: 'Total Active',
      value: totalProjects,
      detail: `${projects.filter(p => p.project_status === 'Green').length} green, ${projects.filter(p => p.project_status === 'Yellow').length} yellow, ${projects.filter(p => p.project_status === 'Red').length} red`,
      type: '',
      onClick: () => window.location.href = './index.html'
    }
  ];

  container.innerHTML = cards.map(card => `
    <div class="executive-card ${card.type ? `executive-card-${card.type}` : ''}" onclick='${card.onClick.toString().replace(/'/g, "\\'")}()'>
      <div class="executive-card-header">
        <span class="executive-card-title">${card.title}</span>
        ${card.badge ? `<span class="executive-card-badge ${card.badgeClass}">${card.badge}</span>` : ''}
      </div>
      <div class="executive-card-value">${card.value}</div>
      <div class="executive-card-detail">${card.detail}</div>
    </div>
  `).join('');
}

function renderActionItems() {
  const container = document.getElementById('actionItemsList');
  if (!container) return;

  const projects = state.projects;
  const riskUpKeys = latestRiskUpProjectKeys(currentChangesReport());

  const pastDue = projects.filter(p => isPastDue(p));
  const dueSoon = projects.filter(p => isDueSoon(p) && !isPastDue(p));
  const redStatus = projects.filter(p => statusLabel(p.project_status) === 'Red');
  const missingOwners = projects.filter(p => !canonicalPersonName(p.project_manager) || !canonicalPersonName(p.implementation_manager));
  const recentlyDegraded = projects.filter(p => {
    const pageIdKey = normalize(p.page_id) ? `page:${normalize(p.page_id)}` : "";
    const titleKey = normalize(p.title) ? `title:${normalize(p.title).toLowerCase()}` : "";
    return (pageIdKey && riskUpKeys.has(pageIdKey)) || (titleKey && riskUpKeys.has(titleKey));
  });

  const items = [
    {
      icon: '🔴',
      title: 'Past Due Go-Lives',
      subtitle: 'Projects that have missed their go-live date',
      count: pastDue.length,
      filter: 'past-due'
    },
    {
      icon: '⚠️',
      title: 'Due Within 30 Days',
      subtitle: 'Projects with Yellow/Red status approaching go-live',
      count: dueSoon.length,
      filter: 'due-soon'
    },
    {
      icon: '🚨',
      title: 'Red Status Projects',
      subtitle: 'Critical projects requiring immediate intervention',
      count: redStatus.length,
      filter: 'red-status'
    },
    {
      icon: '👥',
      title: 'Missing Ownership',
      subtitle: 'Projects without assigned PM or IM',
      count: missingOwners.length,
      filter: 'missing-owners'
    },
    {
      icon: '📉',
      title: 'Recently Degraded',
      subtitle: 'Projects that moved to higher risk status',
      count: recentlyDegraded.length,
      filter: 'degraded'
    }
  ];

  container.innerHTML = items.map(item => `
    <li class="action-item" onclick="navigateToFiltered('${item.filter}')">
      <span class="action-item-icon">${item.icon}</span>
      <div class="action-item-content">
        <h3 class="action-item-title">${item.title}</h3>
        <p class="action-item-subtitle">${item.subtitle}</p>
      </div>
      <div class="action-item-count">${item.count}</div>
    </li>
  `).join('');
}

function renderResourceCards() {
  const container = document.getElementById('resourceCards');
  if (!container) return;

  const projects = state.projects;
  const missingPM = projects.filter(p => !canonicalPersonName(p.project_manager));
  const missingIM = projects.filter(p => !canonicalPersonName(p.implementation_manager));

  // Count projects by PM
  const pmCounts = {};
  projects.forEach(p => {
    const pm = canonicalPersonName(p.project_manager) || 'Unassigned';
    pmCounts[pm] = (pmCounts[pm] || 0) + 1;
  });
  const maxPMLoad = Math.max(...Object.values(pmCounts));
  const avgPMLoad = (projects.length / Object.keys(pmCounts).length).toFixed(1);

  // Count projects by IM
  const imCounts = {};
  projects.forEach(p => {
    const im = canonicalPersonName(p.implementation_manager) || 'Unassigned';
    imCounts[im] = (imCounts[im] || 0) + 1;
  });
  const maxIMLoad = Math.max(...Object.values(imCounts));
  const avgIMLoad = (projects.length / Object.keys(imCounts).length).toFixed(1);

  const cards = [
    {
      title: 'Missing PM',
      value: missingPM.length,
      detail: `${Object.keys(pmCounts).length} PMs, avg ${avgPMLoad} projects each`,
      type: missingPM.length > 0 ? 'warning' : 'success',
      onClick: () => navigateToFiltered('missing-pm')
    },
    {
      title: 'Missing IM',
      value: missingIM.length,
      detail: `${Object.keys(imCounts).length} IMs, avg ${avgIMLoad} projects each`,
      type: missingIM.length > 0 ? 'warning' : 'success',
      onClick: () => navigateToFiltered('missing-im')
    },
    {
      title: 'Max PM Load',
      value: maxPMLoad,
      detail: `Highest project count per PM`,
      type: '',
      onClick: () => window.location.href = './index.html'
    },
    {
      title: 'Max IM Load',
      value: maxIMLoad,
      detail: `Highest project count per IM`,
      type: '',
      onClick: () => window.location.href = './index.html'
    }
  ];

  container.innerHTML = cards.map(card => `
    <div class="executive-card ${card.type ? `executive-card-${card.type}` : ''}" onclick='${card.onClick.toString().replace(/'/g, "\\'")}()'>
      <div class="executive-card-header">
        <span class="executive-card-title">${card.title}</span>
      </div>
      <div class="executive-card-value">${card.value}</div>
      <div class="executive-card-detail">${card.detail}</div>
    </div>
  `).join('');
}

function renderTrendingCards() {
  const container = document.getElementById('trendingCards');
  if (!container) return;

  const projects = state.projects;
  const changesReport = currentChangesReport();
  const movement = changesReport ? statusMovementSummary(changesReport) : { changed: 0, riskUp: 0, riskDown: 0 };

  // Calculate trends
  const riskUpTrend = movement.riskUp > 0 ? 'up' : 'stable';
  const riskDownTrend = movement.riskDown > 0 ? 'down' : 'stable';

  const cards = [
    {
      title: 'Status Degraded',
      value: movement.riskUp,
      detail: 'Projects moved to higher risk',
      type: movement.riskUp > 0 ? 'warning' : 'success',
      trend: riskUpTrend,
      trendIcon: movement.riskUp > 0 ? '↑' : '→',
      onClick: () => navigateToFiltered('degraded')
    },
    {
      title: 'Status Improved',
      value: movement.riskDown,
      detail: 'Projects moved to lower risk',
      type: movement.riskDown > 0 ? 'success' : '',
      trend: riskDownTrend,
      trendIcon: movement.riskDown > 0 ? '↓' : '→',
      onClick: () => navigateToFiltered('improved')
    },
    {
      title: 'Total Changes',
      value: movement.changed,
      detail: 'Projects with status changes',
      type: '',
      onClick: () => window.location.href = './changes.html'
    }
  ];

  container.innerHTML = cards.map(card => `
    <div class="executive-card ${card.type ? `executive-card-${card.type}` : ''}" onclick='${card.onClick.toString().replace(/'/g, "\\'")}()'>
      <div class="executive-card-header">
        <span class="executive-card-title">${card.title}</span>
        ${card.trend ? `<span class="trend-indicator trend-${card.trend}">${card.trendIcon}</span>` : ''}
      </div>
      <div class="executive-card-value">${card.value}</div>
      <div class="executive-card-detail">${card.detail}</div>
    </div>
  `).join('');
}

// Helper functions for classification
function isCritical(project) {
  const status = statusLabel(project.project_status);
  return status === 'Red' || (isPastDue(project) && status !== 'Green');
}

function needsAttention(project) {
  const status = statusLabel(project.project_status);
  return status === 'Yellow' || isDueSoon(project) || !canonicalPersonName(project.project_manager) || !canonicalPersonName(project.implementation_manager);
}

function isPastDue(project) {
  const goLiveDate = parseGoLiveDate(project.go_live);
  if (!goLiveDate) return false;
  const now = new Date();
  return goLiveDate < now;
}

function isDueSoon(project) {
  const goLiveDate = parseGoLiveDate(project.go_live);
  if (!goLiveDate) return false;
  const now = new Date();
  const daysUntil = Math.floor((goLiveDate - now) / (1000 * 60 * 60 * 24));
  const status = statusLabel(project.project_status);
  return daysUntil <= 30 && daysUntil >= 0 && (status === 'Yellow' || status === 'Red');
}

function navigateToFiltered(filter) {
  // Store filter in sessionStorage and navigate to risk page
  sessionStorage.setItem('executiveFilter', filter);
  window.location.href = './risk.html';
}

// Initialize when dashboard data is ready
if (typeof window !== 'undefined') {
  console.log('[Executive] Setting up dashboardReady listener');
  window.addEventListener('dashboardReady', function(event) {
    console.log('[Executive] dashboardReady event received', event.detail);
    initExecutiveDashboard();
  });

  // Also try immediate init in case event already fired
  if (typeof state !== 'undefined' && state && state.projects) {
    console.log('[Executive] State already available, initializing immediately');
    initExecutiveDashboard();
  }
}
