// Executive Dashboard Logic

function initExecutiveDashboard() {
  if (typeof dashboardMode !== 'function' || dashboardMode() !== 'executive') return;

  if (!state || !state.projects) {
    console.error('[Executive] No data available - state.projects is missing');
    return;
  }

  renderPortfolioCards();
  renderActionItems();
  renderReportedHealth();
  renderResourceCards();
  renderTrendingCards();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text === null || text === undefined ? '' : String(text);
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Reported Health (official, from Confluence) counts. Every project lands in exactly one bucket.
function reportedHealthCounts(projects) {
  const counts = { green: 0, yellow: 0, red: 0, other: 0, otherBreakdown: {} };
  projects.forEach(p => {
    const status = statusLabel(p.project_status);
    if (status === 'Green') counts.green++;
    else if (status === 'Yellow') counts.yellow++;
    else if (status === 'Red') counts.red++;
    else {
      counts.other++;
      const label = status === 'Unknown' ? 'Unrated' : status;
      counts.otherBreakdown[label] = (counts.otherBreakdown[label] || 0) + 1;
    }
  });
  return counts;
}

function otherBreakdownText(counts) {
  return Object.entries(counts.otherBreakdown).sort((a, b) => b[1] - a[1]).map(([label, n]) => `${n} ${label}`).join(', ');
}

function bindCardClicks(container) {
  container.querySelectorAll('[data-card-action]').forEach(el => {
    const run = () => {
      const action = el.dataset.cardAction;
      if (action.startsWith('filter:')) navigateToFiltered(action.slice(7));
      else if (action === 'active') window.location.href = './index.html';
      else if (action === 'changes') window.location.href = './changes.html';
      else if (action.startsWith('drawer:')) openAssignmentDrawer(action.slice(7), el.dataset.person || '');
    };
    el.addEventListener('click', run);
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        run();
      }
    });
  });
}

function summaryCardHtml(card) {
  return `
    <div class="executive-card ${card.type ? `executive-card-${card.type}` : ''}" role="button" tabindex="0" data-card-action="${escapeHtml(card.action)}" ${card.person ? `data-person="${escapeHtml(card.person)}"` : ''} ${card.title_attr ? `title="${escapeHtml(card.title_attr)}"` : ''}>
      <div class="executive-card-header">
        <span class="executive-card-title">${escapeHtml(card.title)}</span>
        ${card.badge ? `<span class="executive-card-badge ${card.badgeClass}">${escapeHtml(card.badge)}</span>` : ''}
      </div>
      <div class="executive-card-value">${escapeHtml(card.value)}</div>
      <div class="executive-card-detail">${card.detailHtml || escapeHtml(card.detail)}</div>
    </div>`;
}

function renderPortfolioCards() {
  const container = document.getElementById('portfolioCards');
  if (!container) return;

  const projects = state.projects;
  const critical = projects.filter(p => isCritical(p));
  const attention = projects.filter(p => needsAttention(p) && !isCritical(p));
  const onTrack = projects.filter(p => !isCritical(p) && !needsAttention(p));
  const total = projects.length || 1;
  const pct = n => `${((n / total) * 100).toFixed(0)}% of active projects`;
  const reported = reportedHealthCounts(projects);
  const other = reported.other ? `${reported.other} Other` : '';

  const cards = [
    { title: 'Immediate Action', value: critical.length, detail: `${pct(critical.length)}: Reported Red, or past-due go-live that is not Green`, type: 'critical', badge: 'URGENT', badgeClass: 'badge-critical', action: 'filter:critical', title_attr: 'Generated from dashboard risk rules; separate from Reported Health.' },
    { title: 'Monitor', value: attention.length, detail: `${pct(attention.length)}: Reported Yellow, go-live within 30 days, or missing PM/IM`, type: 'warning', badge: 'MONITOR', badgeClass: 'badge-warning', action: 'filter:attention', title_attr: 'Generated from dashboard risk rules; separate from Reported Health.' },
    { title: 'No Current Alerts', value: onTrack.length, detail: `${pct(onTrack.length)}: no dashboard alert rules triggered`, type: 'success', action: 'filter:on-track', title_attr: 'Generated from dashboard risk rules; separate from Reported Health.' },
    { title: 'Total Active', value: projects.length,
      detailHtml: `Reported Health: <strong>${reported.green}</strong> Green, <strong>${reported.yellow}</strong> Yellow, <strong>${reported.red}</strong> Red${other ? `, <strong>${reported.other}</strong> Other` : ''}${reported.other ? `<br><span class="ch-small">Other = ${escapeHtml(otherBreakdownText(reported))}</span>` : ''}`,
      type: '', action: 'active' },
  ];

  container.innerHTML = cards.map(summaryCardHtml).join('');
  bindCardClicks(container);
}

const ACTION_SEVERITY = {
  critical: { label: 'Critical', icon: '🔴' },
  warning: { label: 'Warning', icon: '⚠️' },
  info: { label: 'Info', icon: 'ℹ️' },
};

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
    { severity: 'critical', title: 'Past-Due Go-Lives', subtitle: 'Projects that have missed their go-live date', filter: 'past-due', projects: pastDue },
    { severity: 'warning', title: 'Due Within 30 Days', subtitle: 'Projects with Yellow/Red status approaching go-live', filter: 'due-soon', projects: dueSoon },
    { severity: 'critical', title: 'Red Status Projects', subtitle: 'Reported Red: intervention needed', filter: 'red-status', projects: redStatus },
    { severity: 'info', title: 'Missing Ownership', subtitle: 'Projects without an assigned PM or IM', filter: 'missing-owners', projects: missingOwners },
    { severity: 'warning', title: 'Recently Degraded', subtitle: 'Projects that moved to a higher-risk status', filter: 'degraded', projects: recentlyDegraded },
  ];

  const active = items.filter(item => item.projects.length);
  const quiet = items.filter(item => !item.projects.length);
  container.innerHTML = active.map(renderActionItem).join('') +
    (quiet.length ? `<li class="action-item-quiet">Nothing right now: ${quiet.map(i => escapeHtml(i.title)).join(', ')}.</li>` : '');

  container.querySelectorAll('.action-item').forEach(li => {
    li.addEventListener('click', event => {
      if (event.target.closest('a')) return;
      navigateToFiltered(li.dataset.filter);
    });
  });
}

function renderActionItem(item) {
  const sev = ACTION_SEVERITY[item.severity];
  const projectLinks = item.projects.slice(0, 5).map(p => {
    const title = p.title || 'Untitled Project';
    const url = p.url || '#';
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="project-quick-link ql-${item.severity}" title="${escapeHtml(title)}">${escapeHtml(title)}</a>`;
  }).join('');
  const moreCount = item.projects.length - 5;
  const moreText = moreCount > 0 ? `<span class="project-quick-more">+${moreCount} more</span>` : '';

  return `
    <li class="action-item action-item-${item.severity}" data-filter="${escapeHtml(item.filter)}">
      <span class="action-item-icon" aria-hidden="true">${sev.icon}</span>
      <div class="action-item-content">
        <h3 class="action-item-title">${escapeHtml(item.title)} <span class="action-severity action-severity-${item.severity}">${sev.label}</span></h3>
        <p class="action-item-subtitle">${escapeHtml(item.subtitle)}</p>
        <div class="project-quick-links">${projectLinks}${moreText}</div>
      </div>
      <div class="action-item-count" aria-label="${item.projects.length} projects">${item.projects.length}</div>
    </li>`;
}

function renderReportedHealth() {
  const container = document.getElementById('reportedHealth');
  if (!container) return;
  const projects = state.projects;
  const c = reportedHealthCounts(projects);
  const total = projects.length;
  const segs = [
    { key: 'green', label: 'Green', icon: '✔', n: c.green },
    { key: 'yellow', label: 'Yellow', icon: '▲', n: c.yellow },
    { key: 'red', label: 'Red', icon: '✖', n: c.red },
    { key: 'other', label: 'Other / not started / unrated', icon: '○', n: c.other },
  ];
  const summary = `${segs.map(s => `${s.n} ${s.label}`).join(', ')}; ${total} active projects`;
  container.innerHTML = `
    <div class="rp-bar" role="img" aria-label="${escapeHtml(summary)}">
      ${segs.filter(s => s.n).map(s => `<span class="rp-seg rp-${s.key}" style="flex:${s.n}" title="${s.label}: ${s.n}"></span>`).join('')}
    </div>
    <ul class="rp-legend">
      ${segs.map(s => `<li><span class="rp-swatch rp-${s.key}" aria-hidden="true"></span><span aria-hidden="true">${s.icon}</span> ${escapeHtml(s.label)} <strong>${s.n}</strong> <span class="ch-muted">(${total ? Math.round((s.n / total) * 100) : 0}%)</span></li>`).join('')}
    </ul>
    <p class="ch-small ch-muted">Total ${total} = ${segs.map(s => s.n).join(' + ')}.${c.other ? ` Other includes ${escapeHtml(otherBreakdownText(c))}.` : ''} Source: Confluence project pages.</p>`;
}

function personLoad(projects, field) {
  const groups = {};
  projects.forEach(p => {
    const name = canonicalPersonName(p[field]);
    if (!name || name === 'Pending Assignment') return; // placeholders are not people
    (groups[name] = groups[name] || []).push(p);
  });
  const entries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const top = entries[0];
  const tied = top ? entries.filter(e => e[1].length === top[1].length).length - 1 : 0;
  return { entries, top, tied };
}

function renderResourceCards() {
  const container = document.getElementById('resourceCards');
  if (!container) return;

  const projects = state.projects;
  const missingPM = projects.filter(p => !canonicalPersonName(p.project_manager));
  const missingIM = projects.filter(p => !canonicalPersonName(p.implementation_manager));
  const pm = personLoad(projects, 'project_manager');
  const im = personLoad(projects, 'implementation_manager');
  const pending = field => projects.filter(p => canonicalPersonName(p[field]) === 'Pending Assignment').length;
  const pendingText = n => (n ? `, ${n} pending assignment` : '');
  const avg = load => load.entries.length ? (projects.length / load.entries.length).toFixed(1) : '0'; // projects per named person

  const loadCard = (title, role, load) => load.top
    ? { title, value: load.top[1].length, detailHtml: `<strong>${escapeHtml(load.top[0])}</strong>${load.tied ? ` (+${load.tied} tied)` : ''}<br><span class="ch-small">${load.entries.length} ${role}s, avg ${avg(load)} projects each. Select to view assigned projects.</span>`, type: '', action: `drawer:${role}`, person: load.top[0] }
    : { title, value: 0, detail: `No ${role} assigned`, type: '', action: 'active' };

  const cards = [
    { title: 'Missing PM', value: missingPM.length, detail: `${pm.entries.length} PMs, avg ${avg(pm)} projects each${pendingText(pending('project_manager'))}`, type: missingPM.length > 0 ? 'warning' : 'success', action: 'filter:missing-pm' },
    { title: 'Missing IM', value: missingIM.length, detail: `${im.entries.length} IMs, avg ${avg(im)} projects each${pendingText(pending('implementation_manager'))}`, type: missingIM.length > 0 ? 'warning' : 'success', action: 'filter:missing-im' },
    loadCard('Max PM Load', 'PM', pm),
    loadCard('Max IM Load', 'IM', im),
  ];

  container.innerHTML = cards.map(summaryCardHtml).join('');
  bindCardClicks(container);
}

function openAssignmentDrawer(role, person) {
  const field = role === 'IM' ? 'implementation_manager' : 'project_manager';
  const rows = state.projects.filter(p => canonicalPersonName(p[field]) === person)
    .sort((a, b) => compareGoLiveDates(a.go_live, b.go_live));
  if (!window.EPLExecDrawer) {
    window.location.href = './index.html';
    return;
  }
  const body = `
    <p class="ch-lede">${rows.length} active projects assigned to this ${role}. Reported Health is the official status from Confluence.</p>
    <div class="table-wrap"><table class="ch-dim-table"><thead><tr><th scope="col">Project</th><th scope="col">Reported</th><th scope="col">Go-live</th></tr></thead><tbody>
      ${rows.map(p => `<tr><th scope="row"><a href="${escapeHtml(p.url || '#')}" target="_blank" rel="noopener">${escapeHtml(p.title || 'Untitled')}</a></th><td>${escapeHtml(statusLabel(p.project_status))}</td><td>${escapeHtml(formatGoLiveDate(p.go_live))}</td></tr>`).join('')}
    </tbody></table></div>`;
  window.EPLExecDrawer.show(`${role}: ${person}`, body);
}

function renderTrendingCards() {
  const container = document.getElementById('trendingCards');
  if (!container) return;
  const note = document.getElementById('trendingNote');

  const changesReport = currentChangesReport();
  const movement = changesReport ? latestStatusMovementSummary(changesReport) : { changed: 0, riskUp: 0, riskDown: 0 };
  const other = movement.changed - movement.riskUp - movement.riskDown;
  const otherUpdates = changesReport && changesReport.summary ? (changesReport.summary.updated || 0) : 0;
  const previousAt = changesReport && changesReport.comparison ? changesReport.comparison.previous_generated_at : '';
  const when = previousAt ? ` since ${formatTimestamp(previousAt)}` : '';

  if (!movement.changed) {
    container.innerHTML = '';
    if (note) note.innerHTML = `No project changed its Reported Health status${escapeHtml(when)}. ${otherUpdates ? `${otherUpdates} project(s) had other updates (notes, go-live dates, staffing). ` : ''}<a href="./changes.html">View all changes</a>`;
    return;
  }

  const cards = [
    { title: 'Status Degraded', value: movement.riskUp, detail: 'Moved to a higher-risk status', type: movement.riskUp > 0 ? 'warning' : '', action: 'filter:degraded' },
    { title: 'Status Improved', value: movement.riskDown, detail: 'Moved to a lower-risk status', type: movement.riskDown > 0 ? 'success' : '', action: 'filter:improved' },
    { title: 'Other Status Changes', value: other, detail: 'Status changed with no change in risk rank (e.g. Unknown to Green)', type: '', action: 'changes' },
    { title: 'Total Status Changes', value: movement.changed, detail: `${movement.riskUp} degraded + ${movement.riskDown} improved + ${other} other`, type: '', action: 'changes' },
  ];
  container.innerHTML = cards.map(summaryCardHtml).join('');
  bindCardClicks(container);
  if (note) note.innerHTML = `Status changes compare Reported Health between the last two data refreshes.${otherUpdates ? ` ${otherUpdates} project(s) had any update; the rest changed notes, go-live dates or staffing.` : ''} <a href="./changes.html">View all changes</a>`;
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
  window.addEventListener('dashboardReady', initExecutiveDashboard);

  // Also try immediate init in case the data event already fired
  if (typeof state !== 'undefined' && state && state.projects && state.projects.length) {
    initExecutiveDashboard();
  }
}
