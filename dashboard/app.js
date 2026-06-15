const DATA_PATH = "./data/projects.json";
const CHANGES_DATA_PATH = "./data/project_changes.json";
const CHANGE_LOG_PATH = "./data/history/change_log.json";

const state = {
  projects: [],
  activeProjects: [],
  filtered: [],
  changes: [],
  filteredChanges: [],
  changesReport: null,
  changeLog: [],
  changeMonths: [],
  activeChangeMonthKey: "",
  snapshotPayloads: {},
  snapshotChangeReports: {},
  monthDisplayChanges: {},
  issueHistoryComparison: null,
  noteHistoryCache: {},
  source: {
    base_url: "https://tylertech.atlassian.net",
    space: "EPLPS",
  },
  chartFilters: {
    status: "",
    pm: "",
  },
  attentionFilters: {
    atRiskOnly: false,
    reason: "",
  },
  goLivesDetail: {
    mode: "",
  },
  sorts: {
    active: { key: "go_live", direction: "asc" },
    risk: { key: "go_live", direction: "asc" },
    "go-lives": { key: "go_live", direction: "desc" },
    changes: { key: "changed_at", direction: "desc" },
    history: { key: "generated_at", direction: "desc" },
  },
  server: {
    projectStatusEditable: false,
    statusOptions: ["Green", "Yellow", "Red", "On Hold", "Not Started"],
    menuOpenFor: "",
  },
};

const STATUS_RISK_WEIGHT = {
  Green: 0,
  "Not Started": 1,
  "On Hold": 2,
  Yellow: 3,
  Red: 4,
};

const NOTE_ISSUE_BUCKETS = [
  {
    label: "Schedule",
    tone: "yellow",
    patterns: [/\bgo[- ]?live\b/i, /\bdelay(?:ed|s)?\b/i, /\bslip(?:page|ped|s)?\b/i, /\btimeline\b/i, /\bpast due\b/i, /\bbehind\b/i],
  },
  {
    label: "Staffing",
    tone: "yellow",
    patterns: [/\bstaff(?:ing)?\b/i, /\bresource(?:s)?\b/i, /\bbandwidth\b/i, /\bcapacity\b/i, /\bvacan(?:cy|cies)\b/i, /\bturnover\b/i],
  },
  {
    label: "Scope",
    tone: "yellow",
    patterns: [/\bscope\b/i, /\brequirement(?:s)?\b/i, /\bchange request\b/i, /\bphase\b/i, /\bmodule(?:s)?\b/i, /\badd(?:ed|ing)?\b/i],
  },
  {
    label: "Integration",
    tone: "yellow",
    patterns: [/\bintegration\b/i, /\bapi\b/i, /\binterface\b/i, /\boracle\b/i, /\blaser ?fiche\b/i, /\bimport\b/i, /\bexport\b/i],
  },
  {
    label: "Report Development",
    tone: "yellow",
    patterns: [/\breport(?:ing)?\b/i, /\breport development\b/i, /\bssrs\b/i, /\bbi\b/i, /\bdashboard\b/i, /\bquery\b/i],
  },
  {
    label: "Data Conversion",
    tone: "yellow",
    patterns: [/\bconversion\b/i, /\bmigration\b/i, /\bconvert(?:ed|ing)?\b/i, /\bclean(?:up)?\b/i, /\bmapping\b/i, /\bdata load\b/i],
  },
  {
    label: "Financial",
    tone: "green",
    patterns: [/\bfinancial(?:s)?\b/i, /\bfinance\b/i, /\bpayment(?:s)?\b/i, /\bmerchant\b/i, /\bcashiering\b/i, /\btyler payments?\b/i, /\bjp morgan\b/i, /\battestation\b/i, /\bgl\b/i, /\bgeneral ledger\b/i, /\bbudget\b/i],
  },
  {
    label: "Training",
    tone: "green",
    patterns: [/\btraining\b/i, /\badoption\b/i, /\bknowledge transfer\b/i, /\bworkshop\b/i],
  },
  {
    label: "Client Decision",
    tone: "yellow",
    patterns: [/\bdecision\b/i, /\bapproval\b/i, /\bsign(?:ed|off)?\b/i, /\bwaiting\b/i, /\bclient\b.*\b(confirm|response|review)\b/i],
  },
  {
    label: "Testing",
    tone: "red",
    patterns: [/\btest(?:ing)?\b/i, /\buat\b/i, /\bqa\b/i, /\bvalidation\b/i, /\btest script(?:s)?\b/i],
  },
  {
    label: "Bug / Defect",
    tone: "red",
    patterns: [/\bdefect(?:s)?\b/i, /\bbug(?:s)?\b/i, /\berror(?:s)?\b/i, /\bbroken\b/i, /\bfail(?:ure|ing|s)?\b/i, /\bfix(?:es|ing)?\b/i],
  },
];

// Enhanced Risk Categories for Management Filtering
const RISK_CATEGORIES = {
  SCHEDULE: {
    label: "Schedule Risk",
    patterns: [/\bgo[- ]?live\b/i, /\bdelay(?:ed|s)?\b/i, /\bslip(?:page|ped|s)?\b/i, /\btimeline\b/i, /\bpast due\b/i, /\bbehind\b/i, /\boverdue\b/i, /\bpostpon(?:e|ed)\b/i],
    check: (project) => {
      const goLiveDate = parseGoLiveDate(project.go_live);
      const now = new Date();
      if (!goLiveDate) return false;
      const daysUntil = Math.floor((goLiveDate - now) / (1000 * 60 * 60 * 24));
      const status = statusLabel(project.project_status);
      // Past due OR due soon with risk status
      return goLiveDate < now || (daysUntil <= 30 && (status === 'Yellow' || status === 'Red'));
    }
  },
  RESOURCE: {
    label: "Resource Risk",
    patterns: [/\bstaff(?:ing)?\b/i, /\bresource(?:s)?\b/i, /\bbandwidth\b/i, /\bcapacity\b/i, /\bvacan(?:cy|cies)\b/i, /\bturnover\b/i, /\bshortage\b/i],
    check: (project) => {
      return !canonicalPersonName(project.project_manager) || !canonicalPersonName(project.implementation_manager);
    }
  },
  TECHNICAL: {
    label: "Technical Risk",
    patterns: [/\bintegration\b/i, /\bapi\b/i, /\binterface\b/i, /\bconversion\b/i, /\bmigration\b/i, /\bdata\b.*\b(issue|problem)\b/i, /\bperformance\b/i, /\bbug(?:s)?\b/i, /\bdefect(?:s)?\b/i],
    check: (project) => false // Pattern-based only
  },
  FINANCIAL: {
    label: "Financial Risk",
    patterns: [/\bbudget\b/i, /\bcost\b/i, /\bfunding\b/i, /\bpayment\b/i, /\boverrun\b/i, /\bchange order\b/i, /\bcontract\b/i],
    check: (project) => false // Pattern-based only
  },
  CLIENT: {
    label: "Client Satisfaction Risk",
    patterns: [/\bclient\b.*\b(unhappy|concern|frustrated|complain)\b/i, /\bescalat(?:e|ed|ion)\b/i, /\bdissatisf(?:ied|action)\b/i],
    check: (project) => {
      const clientStatus = statusLabel(project.client_status);
      return clientStatus === 'Yellow' || clientStatus === 'Red';
    }
  }
};

// Risk Level Classification
const RISK_LEVELS = {
  CRITICAL: { label: "Critical", weight: 4, color: "red" },
  HIGH: { label: "High", weight: 3, color: "yellow" },
  MEDIUM: { label: "Medium", weight: 2, color: "yellow" },
  LOW: { label: "Low", weight: 1, color: "green" }
};

// Calculate comprehensive risk level for a project
function calculateRiskLevel(project) {
  let score = 0;
  const status = statusLabel(project.project_status);
  const clientStatus = statusLabel(project.client_status);

  // Status-based scoring
  if (status === 'Red') score += 5;
  else if (status === 'Yellow') score += 3;
  else if (status === 'On Hold') score += 2;

  if (clientStatus === 'Red') score += 3;
  else if (clientStatus === 'Yellow') score += 2;

  // Schedule risk
  const goLiveDate = parseGoLiveDate(project.go_live);
  if (goLiveDate) {
    const now = new Date();
    const daysUntil = Math.floor((goLiveDate - now) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) score += 4; // Past due
    else if (daysUntil <= 14 && status !== 'Green') score += 3;
    else if (daysUntil <= 30 && status === 'Red') score += 2;
  } else {
    score += 1; // Missing go-live date
  }

  // Resource risk
  if (!canonicalPersonName(project.project_manager)) score += 2;
  if (!canonicalPersonName(project.implementation_manager)) score += 2;

  // Determine level
  if (score >= 8) return 'CRITICAL';
  if (score >= 5) return 'HIGH';
  if (score >= 3) return 'MEDIUM';
  return 'LOW';
}

// Get risk categories for a project
function getProjectRiskCategories(project) {
  const categories = [];
  const notesText = [project.project_health, project.client_health].filter(Boolean).join(' ').toLowerCase();

  for (const [key, category] of Object.entries(RISK_CATEGORIES)) {
    const hasPattern = category.patterns.some(pattern => pattern.test(notesText));
    const meetsCheck = category.check(project);

    if (hasPattern || meetsCheck) {
      categories.push({
        key,
        label: category.label,
        hasPattern,
        meetsCheck
      });
    }
  }

  return categories;
}

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
]);

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function goLivesAvailableYears() {
  return uniqueSorted([
    ...state.projects.map((row) => goLiveYear(row.go_live)),
    ...state.activeProjects.map((row) => goLiveYear(row.go_live)),
  ]);
}

function normalize(value) {
  return String(value || "").trim();
}

function canonicalizeModuleName(value) {
  const normalized = normalize(value);
  const compact = normalized.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact.includes("ereview") || compact.includes("ereviews")) {
    return "E-Reviews";
  }
  return normalized;
}

function normalizeList(values) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => canonicalizeModuleName(value)).filter(Boolean))]
    : [];
}

function isTemplateTitle(value) {
  const title = normalize(value).toLowerCase();
  return title.includes("template") || title.includes("do not use") || title.includes("copy of 1 template");
}

function dashboardMode() {
  if (typeof document === "undefined" || !document.body) {
    return "active";
  }
  return document.body.dataset.dashboardMode || "active";
}

function canonicalPersonName(value) {
  const normalized = normalize(value);
  const compact = normalized.toLowerCase().replace(/[^a-z]/g, "");

  if (["greglapoin", "greglapointe", "gregorylapointe"].includes(compact)) {
    return "Gregory Lapointe";
  }

  if (["brianmoorman"].includes(compact)) {
    return "Brian Moorman";
  }

  if (["melaniedacunha"].includes(compact)) {
    return "Melanie DaCunha";
  }

  if (["patdriscoll", "patrickdriscoll"].includes(compact)) {
    return "Patrick Driscoll";
  }

  if (["jarredellis", "jarradellis"].includes(compact)) {
    return "Jarrad Ellis";
  }

  return normalized;
}

function goLiveSortKey(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return "9999-99-99";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return `9999-99-99-${normalized.toLowerCase()}`;
}

function compareGoLiveDates(a, b, descending = false) {
  const comparison = goLiveSortKey(a).localeCompare(goLiveSortKey(b));
  return descending ? -comparison : comparison;
}

function startDateSortKey(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return "9999-99-99";
  }

  const isoMatch = normalized.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoMatch) {
    return isoMatch[0];
  }

  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return `9999-99-99-${normalized.toLowerCase()}`;
}

function compareStartDates(a, b, descending = false) {
  const comparison = startDateSortKey(a).localeCompare(startDateSortKey(b));
  return descending ? -comparison : comparison;
}

function currentSort(mode = dashboardMode()) {
  return state.sorts[mode] || { key: "", direction: "asc" };
}

function setSort(mode, key) {
  const existing = currentSort(mode);
  state.sorts[mode] = {
    key,
    direction: existing.key === key && existing.direction === "asc" ? "desc" : "asc",
  };
}

function compareText(a, b) {
  return normalize(a).localeCompare(normalize(b));
}

function monthKeyFromValue(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 7);
  }
  const match = normalized.match(/\b\d{4}-\d{2}\b/);
  return match ? match[0] : "";
}

function monthLabelFromKey(value) {
  const key = monthKeyFromValue(value);
  if (!key) {
    return "";
  }
  const [year, month] = key.split("-");
  const parsed = Date.parse(`${year}-${month}-01T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return key;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(parsed));
}

function buildMonthlyChangeHistory(log) {
  const entries = [...(Array.isArray(log) ? log : [])]
    .filter((row) => normalize(row?.generated_at))
    .sort((a, b) => Date.parse(a.generated_at || 0) - Date.parse(b.generated_at || 0));

  const months = [];
  let current = null;

  entries.forEach((entry, index) => {
    const monthKey = monthKeyFromValue(entry.generated_at);
    if (!monthKey) {
      return;
    }

    if (!current || current.month_key !== monthKey) {
      current = {
        month_key: monthKey,
        month_label: monthLabelFromKey(monthKey),
        generated_at: entry.generated_at,
        snapshot_file: entry.snapshot_file || "",
        current_snapshot_file: entry.snapshot_file || "",
        previous_snapshot_file: index > 0 ? entries[index - 1].snapshot_file || "" : "",
      };
      months.push(current);
      return;
    }

    current.generated_at = entry.generated_at;
    current.snapshot_file = entry.snapshot_file || "";
    current.current_snapshot_file = entry.snapshot_file || "";
  });

  return months.sort((a, b) => Date.parse(b.generated_at || 0) - Date.parse(a.generated_at || 0));
}

function changeLogEntriesAscending() {
  return [...state.changeLog]
    .filter((row) => normalize(row?.generated_at))
    .sort((a, b) => Date.parse(a.generated_at || 0) - Date.parse(b.generated_at || 0));
}

function manualDashboardEntriesForMonth(monthKey) {
  const normalized = normalize(monthKey);
  if (!normalized) {
    return [];
  }

  return changeLogEntriesAscending().filter((entry) => (
    monthKeyFromValue(entry.generated_at) === normalized
      && normalize(entry.change_source).toLowerCase() === "dashboard"
  ));
}

function compareNumber(a, b) {
  return (Number(a) || 0) - (Number(b) || 0);
}

function compareRowsByKey(a, b, key) {
  if (key === "go_live") return compareGoLiveDates(a.go_live, b.go_live);
  if (key === "implementation_start_date") return compareStartDates(a.implementation_start_date, b.implementation_start_date);
  if (key === "project_manager") return compareText(canonicalPersonName(a.project_manager), canonicalPersonName(b.project_manager));
  if (key === "implementation_manager") return compareText(canonicalPersonName(a.implementation_manager), canonicalPersonName(b.implementation_manager));
  if (key === "region_state") return compareText(projectState(a), projectState(b));
  if (key === "project_status" || key === "client_status") return compareText(statusLabel(a[key]), statusLabel(b[key]));
  if (key === "changed_at" || key === "generated_at") return Date.parse(a[key] || 0) - Date.parse(b[key] || 0);
  if (key === "added" || key === "updated" || key === "removed") return compareNumber(a.summary?.[key] ?? a[key], b.summary?.[key] ?? b[key]);
  if (key === "changedFields") return compareText((a.changedFields || []).join(" | "), (b.changedFields || []).join(" | "));
  return compareText(a[key], b[key]);
}

function sortedRows(rows, mode = dashboardMode()) {
  const sort = currentSort(mode);
  if (!sort?.key) {
    return [...rows];
  }

  return [...rows].sort((a, b) => {
    const comparison = compareRowsByKey(a, b, sort.key);
    if (comparison !== 0) {
      return sort.direction === "desc" ? -comparison : comparison;
    }
    return compareText(a.title || a.snapshot_file || "", b.title || b.snapshot_file || "");
  });
}

function applyHeaderSortState(tableId, mode = dashboardMode()) {
  const table = document.getElementById(tableId);
  if (!table) {
    return;
  }

  const sort = currentSort(mode);
  table.querySelectorAll("thead th[data-sort-key]").forEach((th) => {
    const key = th.dataset.sortKey;
    th.classList.toggle("th-sort-active", sort.key === key);
    th.dataset.sortDirection = sort.key === key ? sort.direction : "";
  });
}

function goLiveYear(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return "";
  }

  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    return String(month === 11 && day === 31 ? year + 1 : year);
  }

  const isoMatch = normalized.match(/\b(19|20)\d{2}\b/);
  if (isoMatch) {
    return isoMatch[0];
  }

  return "";
}

function parseGoLiveDate(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed);
}

function formatGoLiveDate(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return "";
  }

  const parsed = parseGoLiveDate(normalized);
  if (!parsed) {
    return normalized;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatTimestamp(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return "";
  }

  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return normalized;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function implementationStartYear(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return "";
  }

  const isoMatch = normalized.match(/\b(19|20)\d{2}\b/);
  if (isoMatch) {
    return isoMatch[0];
  }

  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    return String(new Date(parsed).getUTCFullYear());
  }

  return "";
}

function formatStartDate(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return "";
  }

  const isoMatch = normalized.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoMatch) {
    return formatGoLiveDate(isoMatch[0]);
  }

  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    return formatGoLiveDate(new Date(parsed).toISOString().slice(0, 10));
  }

  return normalized;
}

function projectState(row) {
  const region = normalize(row.region_state);
  const regionMatch = region.match(/\b([A-Z]{2})\b$/);
  if (regionMatch && US_STATE_CODES.has(regionMatch[1])) {
    return regionMatch[1];
  }

  const title = normalize(row.title);
  const titleMatch = title.match(/(?:-|,)\s*([A-Z]{2})\b/);
  if (titleMatch && US_STATE_CODES.has(titleMatch[1])) {
    return titleMatch[1];
  }

  if (region || title) {
    return "Other";
  }

  return "";
}

function statusClass(status) {
  const value = normalize(status).toLowerCase();
  if (value === "green") return "status-green";
  if (value === "yellow") return "status-yellow";
  if (value === "red") return "status-red";
  if (value === "unknown") return "status-unknown";
  return "status-other";
}

function inferStatusFromHealth(text, fallback = "") {
  const normalized = normalize(text).toLowerCase();
  if (!normalized) {
    return statusLabel(fallback);
  }

  const firstToken = normalized.split(/\s+/)[0] || "";
  if (normalized.startsWith("on hold") || normalized.startsWith("hold") || normalized.startsWith("w -")) return "On Hold";
  if (normalized.startsWith("not started")) return "Not Started";
  if (firstToken === "r" || normalized.startsWith("red")) return "Red";
  if (firstToken === "y" || firstToken === "amber" || normalized.startsWith("yellow") || normalized.startsWith("amber")) return "Yellow";
  if (firstToken === "g" || normalized.startsWith("green")) return "Green";
  return statusLabel(fallback);
}

function statusLabel(status) {
  return normalize(status) || "Unknown";
}

function stripStatusPrefix(text, status) {
  const normalizedText = normalize(text);
  const label = statusLabel(status);
  if (!normalizedText) {
    return "";
  }

  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return normalizedText.replace(new RegExp(`^${escaped}\\s*[:|-]?\\s*`, "i"), "").trim();
}

function comparableHistoryNotes(status, notes) {
  return stripStatusPrefix(notes, status)
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function noteIssueTagsFromText(text) {
  const normalized = normalize(text);
  if (!normalized) {
    return [];
  }

  return NOTE_ISSUE_BUCKETS
    .filter((bucket) => bucket.patterns.some((pattern) => pattern.test(normalized)))
    .map((bucket) => ({ label: bucket.label, tone: bucket.tone }));
}

function noteIssueTagsForRow(row) {
  const tags = [
    ...noteIssueTagsFromText(row?.project_health),
    ...noteIssueTagsFromText(row?.client_health),
  ];
  const seen = new Set();
  return tags.filter((tag) => {
    const key = `${tag.label}:${tag.tone}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function noteIssueSummary(rows) {
  const counts = new Map();

  rows.forEach((row) => {
    noteIssueTagsForRow(row).forEach((tag) => {
      const existing = counts.get(tag.label) || { ...tag, value: 0 };
      existing.value += 1;
      counts.set(tag.label, existing);
    });
  });

  return [...counts.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function noteIssueSeveritySummary(rows) {
  const counts = new Map([
    ["red", 0],
    ["yellow", 0],
    ["green", 0],
  ]);

  rows.forEach((row) => {
    const tones = new Set(noteIssueTagsForRow(row).map((tag) => tag.tone).filter((tone) => counts.has(tone)));
    tones.forEach((tone) => {
      counts.set(tone, (counts.get(tone) || 0) + 1);
    });
  });

  return {
    red: counts.get("red") || 0,
    yellow: counts.get("yellow") || 0,
    green: counts.get("green") || 0,
  };
}

function projectRiskIssueTags(row) {
  return noteIssueTagsForRow(row).filter((tag) => tag.tone === "red" || tag.tone === "yellow");
}

function issueSummaryEntry(rows, generatedAt = "") {
  return {
    generated_at: generatedAt,
    items: noteIssueSummary(rows),
  };
}

async function buildLatestMonthlyIssueComparison(log) {
  const dated = [...(log || [])]
    .filter((entry) => !Number.isNaN(Date.parse(entry.generated_at || "")))
    .sort((a, b) => Date.parse(a.generated_at) - Date.parse(b.generated_at));
  if (!dated.length) {
    return null;
  }

  const latestByMonth = new Map();
  dated.forEach((entry) => {
    const key = monthKey(entry.generated_at);
    if (key) {
      latestByMonth.set(key, entry);
    }
  });

  const monthKeys = [...latestByMonth.keys()].sort();
  const currentMonthKey = monthKeys[monthKeys.length - 1];
  const previousMonthKeyValue = currentMonthKey ? previousMonthKey(currentMonthKey) : "";
  if (!currentMonthKey || !previousMonthKeyValue || !latestByMonth.has(previousMonthKeyValue)) {
    return null;
  }

  const currentEntry = latestByMonth.get(currentMonthKey);
  const previousEntry = latestByMonth.get(previousMonthKeyValue);
  const [currentPayload, previousPayload] = await Promise.all([
    loadSnapshotPayload(currentEntry.snapshot_file),
    loadSnapshotPayload(previousEntry.snapshot_file),
  ]);
  if (!currentPayload || !previousPayload) {
    return null;
  }

  const normalizeRows = (payload) => (payload.projects || [])
    .map((row) => normalizeProjectRow(row))
    .filter((row) => !isTemplateTitle(row.title));

  return {
    current: issueSummaryEntry(normalizeRows(currentPayload), currentEntry.generated_at),
    previous: issueSummaryEntry(normalizeRows(previousPayload), previousEntry.generated_at),
  };
}

function issueComparisonItems(comparison, limit = 8) {
  if (!comparison?.current || !comparison?.previous) {
    return [];
  }

  const previousByLabel = new Map((comparison.previous.items || []).map((item) => [item.label, item]));
  const currentByLabel = new Map((comparison.current.items || []).map((item) => [item.label, item]));
  const labels = [...new Set([...currentByLabel.keys(), ...previousByLabel.keys()])];

  return labels
    .map((label) => {
      const current = currentByLabel.get(label);
      const previous = previousByLabel.get(label);
      return {
        label,
        currentValue: current?.value || 0,
        previousValue: previous?.value || 0,
        tone: current?.tone || previous?.tone || "",
      };
    })
    .sort((a, b) => (b.currentValue + b.previousValue) - (a.currentValue + a.previousValue) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function healthCellHtml(status, notes) {
  return healthCellHtmlWithOptions(status, notes);
}

function healthCellHtmlWithOptions(status, notes, options = {}) {
  const label = statusLabel(status);
  const detail = stripStatusPrefix(notes, status);
  const detailHtml = detail ? `<div class="health-notes-text">${detail}</div>` : `<div class="health-notes-empty">No detail</div>`;
  const tags = Array.isArray(options.issueTags) ? options.issueTags : [];
  const tagsHtml = tags.length
    ? `<div class="project-risk-tags">${tags.map((tag) => `<span class="project-risk-tag project-risk-tag-${tag.tone}">${escapeHtml(tag.label)}</span>`).join("")}</div>`
    : "";
  const editable = options.editable && options.pageId;
  const labelHtml = editable
    ? `<button type="button" class="status-pill status-pill-button ${statusClass(status)}" title="Click to update project status" data-status-editor="project" data-page-id="${escapeHtml(options.pageId)}" data-project-title="${escapeHtml(options.title || "")}" data-current-status="${escapeHtml(label)}">${label}</button>`
    : `<span class="status-pill ${statusClass(status)}">${label}</span>`;
  return `
    <div class="health-notes-cell">
      ${labelHtml}
      ${tagsHtml}
      ${detailHtml}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fieldLabel(field) {
  return normalize(field)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizedConfluenceUrl(url) {
  const direct = normalize(url);
  if (!direct) {
    return "";
  }
  if (direct.includes("/wiki/")) {
    return direct;
  }
  if (direct.includes("://") && direct.includes("/spaces/")) {
    return direct.replace("/spaces/", "/wiki/spaces/");
  }
  return direct;
}

function summarizeProjectForChange(row) {
  return {
    page_id: String(row?.page_id || ""),
    title: row?.title || "",
    url: row?.url || "",
    go_live: row?.go_live || "",
    project_status: row?.project_status || "",
    project_manager: row?.project_manager || "",
    implementation_manager: row?.implementation_manager || "",
    region_state: row?.region_state || "",
    epl_version: row?.epl_version || "",
    last_modified: row?.last_modified || "",
  };
}

function buildSnapshotChangeReport(previousPayload, currentPayload) {
  const changeFields = [
    "title",
    "go_live",
    "project_status",
    "client_status",
    "project_health",
    "client_health",
    "project_manager",
    "implementation_manager",
    "region_state",
    "epl_version",
  ];
  const previousProjects = Object.fromEntries(
    ((previousPayload?.projects) || [])
      .filter((row) => normalize(row?.page_id))
      .map((row) => [String(row.page_id), row]),
  );
  const currentProjects = Object.fromEntries(
    ((currentPayload?.projects) || [])
      .filter((row) => normalize(row?.page_id))
      .map((row) => [String(row.page_id), row]),
  );

  const added = [];
  const removed = [];
  const updated = [];

  Object.entries(currentProjects).forEach(([pageId, row]) => {
    if (!previousProjects[pageId]) {
      added.push(summarizeProjectForChange(row));
      return;
    }

    const previousRow = previousProjects[pageId];
    const fieldChanges = {};
    changeFields.forEach((field) => {
      const previousValue = previousRow?.[field] || "";
      const currentValue = row?.[field] || "";
      if (previousValue !== currentValue) {
        fieldChanges[field] = {
          before: previousValue,
          after: currentValue,
        };
      }
    });

    if (Object.keys(fieldChanges).length) {
      updated.push({
        ...summarizeProjectForChange(row),
        changes: fieldChanges,
        previous: summarizeProjectForChange(previousRow),
      });
    }
  });

  Object.entries(previousProjects).forEach(([pageId, row]) => {
    if (!currentProjects[pageId]) {
      removed.push(summarizeProjectForChange(row));
    }
  });

  return {
    generated_at: currentPayload?.generated_at || "",
    detail_level: "full",
    comparison: {
      current_generated_at: currentPayload?.generated_at || "",
      previous_generated_at: previousPayload?.generated_at || "",
    },
    summary: {
      added: added.length,
      removed: removed.length,
      updated: updated.length,
    },
    added,
    removed,
    updated,
  };
}

async function ensureMonthlyChangeReport(monthEntry) {
  const monthKey = normalize(monthEntry?.month_key);
  if (!monthKey) {
    return null;
  }

  const cacheKey = `month:${monthKey}`;
  if (state.snapshotChangeReports[cacheKey]) {
    return state.snapshotChangeReports[cacheKey];
  }

  const currentPayload = await loadSnapshotPayload(monthEntry.current_snapshot_file);
  const previousPayload = monthEntry.previous_snapshot_file
    ? await loadSnapshotPayload(monthEntry.previous_snapshot_file)
    : null;
  const report = buildSnapshotChangeReport(previousPayload, currentPayload);
  report.month_key = monthKey;
  report.month_label = monthEntry.month_label || monthLabelFromKey(monthKey);
  report.snapshot_file = monthEntry.current_snapshot_file || "";
  state.snapshotChangeReports[cacheKey] = report;
  return report;
}

async function ensureMonthlyChangeReports(entries) {
  for (const entry of entries) {
    const report = await ensureMonthlyChangeReport(entry);
    if (report) {
      entry.summary = report.summary || { added: 0, updated: 0, removed: 0 };
    }
  }
}

async function ensureSnapshotChangeReport(snapshotFile) {
  const normalized = normalize(snapshotFile);
  if (!normalized) {
    return null;
  }

  const cacheKey = `snapshot:${normalized}`;
  if (state.snapshotChangeReports[cacheKey]) {
    return state.snapshotChangeReports[cacheKey];
  }

  const orderedEntries = changeLogEntriesAscending();
  const entryIndex = orderedEntries.findIndex((row) => normalize(row.snapshot_file) === normalized);
  if (entryIndex < 0) {
    return null;
  }

  const currentPayload = await loadSnapshotPayload(normalized);
  const previousEntry = entryIndex > 0 ? orderedEntries[entryIndex - 1] : null;
  const previousPayload = previousEntry ? await loadSnapshotPayload(previousEntry.snapshot_file) : null;
  const report = buildSnapshotChangeReport(previousPayload, currentPayload);
  report.snapshot_file = normalized;
  state.snapshotChangeReports[cacheKey] = report;
  return report;
}

function projectUrl(row) {
  const direct = normalizedConfluenceUrl(row?.url);
  if (direct) {
    return direct;
  }

  const pageId = normalize(row?.page_id);
  if (!pageId) {
    return "";
  }

  const baseUrl = normalize(state.source?.base_url) || "https://tylertech.atlassian.net";
  const space = normalize(state.source?.space) || "EPLPS";
  return `${baseUrl}/wiki/spaces/${space}/pages/${pageId}`;
}

function normalizeProjectRow(row) {
  return {
    ...row,
    contracted_products: normalizeList(row?.contracted_products),
    project_status: inferStatusFromHealth(row?.project_health, row?.project_status),
    client_status: inferStatusFromHealth(row?.client_health, row?.client_status),
  };
}

function selectedValues(selectId) {
  const element = document.getElementById(selectId);
  if (!element) {
    return [];
  }

  if ("selectedOptions" in element) {
    return [...element.selectedOptions].map((option) => normalize(option.value)).filter(Boolean);
  }

  return [...element.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => normalize(input.value))
    .filter(Boolean);
}

function moduleFilterSummary(values) {
  if (!values.length) {
    return "All modules";
  }
  if (values.length === 1) {
    return values[0];
  }
  if (values.length === 2) {
    return `${values[0]} + ${values[1]}`;
  }
  return `${values.length} modules selected`;
}

function updateModuleFilterTrigger() {
  const trigger = document.getElementById("moduleFilterTrigger");
  if (!trigger) {
    return;
  }
  trigger.textContent = moduleFilterSummary(selectedValues("moduleFilter"));
}

function renderModuleFilter(values) {
  const container = document.getElementById("moduleFilterMenu");
  if (!container) {
    return;
  }

  const selected = new Set(selectedValues("moduleFilter"));
  container.innerHTML = `
    <button type="button" class="multi-select-clear" id="moduleFilterClear">Clear Modules</button>
    ${values.map((value) => `
      <label class="multi-select-option">
        <input type="checkbox" value="${escapeHtml(value)}" ${selected.has(value) ? "checked" : ""} />
        <span>${escapeHtml(value)}</span>
      </label>
    `).join("")}
  `;

  const clearButton = document.getElementById("moduleFilterClear");
  if (clearButton) {
    clearButton.addEventListener("click", () => {
      container.querySelectorAll("input[type='checkbox']").forEach((input) => {
        input.checked = false;
      });
      updateModuleFilterTrigger();
      applyFilters();
    });
  }

  container.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => {
      updateModuleFilterTrigger();
      applyFilters();
    });
  });
}

function setModuleFilterOpen(open) {
  const trigger = document.getElementById("moduleFilterTrigger");
  const menu = document.getElementById("moduleFilterMenu");
  if (!trigger || !menu) {
    return;
  }
  trigger.setAttribute("aria-expanded", open ? "true" : "false");
  menu.classList.toggle("multi-select-hidden", !open);
}

function canEditProjectStatus() {
  return (dashboardMode() === "active" || dashboardMode() === "risk") && !!state.server.projectStatusEditable;
}

function changeTypeClass(type) {
  const value = normalize(type).toLowerCase();
  if (value === "added") return "change-added";
  if (value === "updated") return "change-updated";
  if (value === "removed") return "change-removed";
  return "change-other";
}

function changeReportHasDetails(report) {
  if (!report) {
    return false;
  }

  if (normalize(report.detail_level).toLowerCase() === "summary") {
    return false;
  }

  return Array.isArray(report.added) && Array.isArray(report.removed) && Array.isArray(report.updated);
}

function buildChangesDataNote(report, log) {
  if (!report && !log.length) {
    return {
      tone: "muted",
      message: "No change report has been generated yet.",
    };
  }

  if (!changeReportHasDetails(report)) {
    return {
      tone: "warning",
      message: "Summary-only history is available. Run a fresh dashboard refresh to populate detailed monthly added, removed, and field-level changes.",
    };
  }

  const total = (report.summary?.added || 0) + (report.summary?.updated || 0) + (report.summary?.removed || 0);
  if (!total) {
    return {
      tone: "success",
      message: "Detailed monthly comparison is available, and the selected month did not detect any project changes.",
    };
  }

  return {
    tone: "info",
    message: "Detailed monthly comparison is available, including field-level before/after values.",
  };
}

function currentChangesReport() {
  const cacheKey = state.activeChangeMonthKey ? `month:${state.activeChangeMonthKey}` : "";
  if (cacheKey && state.snapshotChangeReports[cacheKey]) {
    return state.snapshotChangeReports[cacheKey];
  }
  return state.changesReport;
}

function activeSnapshotLabel() {
  if (!state.activeChangeMonthKey) {
    return "latest month";
  }
  return monthLabelFromKey(state.activeChangeMonthKey) || state.activeChangeMonthKey;
}

function syncChangeFilterOptions() {
  const typeFilter = document.getElementById("changeTypeFilter");
  const fieldFilter = document.getElementById("fieldFilter");
  if (!typeFilter || !fieldFilter) {
    return;
  }

  const currentType = typeFilter.value;
  const currentField = fieldFilter.value;
  const typeValues = uniqueSorted(state.changes.map((row) => row.type));
  const fieldValues = uniqueSorted(state.changes.flatMap((row) => row.changedFields.map((field) => field)));

  typeFilter.innerHTML = '<option value="">All</option>';
  fieldFilter.innerHTML = '<option value="">All</option>';
  populateSelect("changeTypeFilter", typeValues);
  populateSelect("fieldFilter", fieldValues);

  if (typeValues.includes(currentType)) {
    typeFilter.value = currentType;
  } else {
    const defaultType = typeValues.find((value) => normalize(value).toLowerCase() === "updated");
    if (defaultType) {
      typeFilter.value = defaultType;
    }
  }
  if (fieldValues.includes(currentField)) {
    fieldFilter.value = currentField;
  }
}

function renderChangesSelectionMeta() {
  const title = document.getElementById("changesSectionTitle");
  const meta = document.getElementById("changesSectionMeta");
  const latestButton = document.getElementById("showLatestChangesButton");
  if (!title || !meta || !latestButton) {
    return;
  }

  if (!state.activeChangeMonthKey) {
    title.textContent = "Current Month Change Report";
    meta.textContent = "Showing the most recent monthly rollup by default.";
    latestButton.classList.add("field-hidden");
    return;
  }

  title.textContent = "Selected Month Change Report";
  meta.textContent = `Showing rolled-up changes for ${activeSnapshotLabel()}.`;
  latestButton.classList.remove("field-hidden");
}

function flattenChanges(report) {
  if (!report) {
    return [];
  }

  const changedAt = report.comparison?.current_generated_at || report.generated_at || "";

  const added = (report.added || []).map((row) => ({
    changed_at: changedAt,
    type: "Added",
    page_id: row.page_id || "",
    url: row.url || "",
    title: row.title || "",
    go_live: row.go_live || "",
    project_status: row.project_status || "",
    project_manager: row.project_manager || "",
    implementation_manager: row.implementation_manager || "",
    region_state: row.region_state || "",
    epl_version: row.epl_version || "",
    detailText: "New project added to the active dashboard dataset.",
    changedFields: [],
    changes: [],
  }));

  const removed = (report.removed || []).map((row) => ({
    changed_at: changedAt,
    type: "Removed",
    page_id: row.page_id || "",
    url: row.url || "",
    title: row.title || "",
    go_live: row.go_live || "",
    project_status: row.project_status || "",
    project_manager: row.project_manager || "",
    implementation_manager: row.implementation_manager || "",
    region_state: row.region_state || "",
    epl_version: row.epl_version || "",
    detailText: "Project no longer appears in the active dashboard dataset.",
    changedFields: [],
    changes: [],
  }));

  const updated = (report.updated || []).map((row) => {
    const entries = Object.entries(row.changes || {});
    return {
      changed_at: changedAt,
      type: "Updated",
      page_id: row.page_id || "",
      url: row.url || "",
      title: row.title || "",
      go_live: row.go_live || "",
      project_status: row.project_status || "",
      project_manager: row.project_manager || "",
      implementation_manager: row.implementation_manager || "",
      region_state: row.region_state || "",
      epl_version: row.epl_version || "",
      detailText: `${entries.length} field${entries.length === 1 ? "" : "s"} changed`,
      changedFields: entries.map(([field]) => field),
      changes: entries.map(([field, values]) => ({
        field,
        before: values.before || "",
        after: values.after || "",
      })),
      previous: row.previous || null,
    };
  });

  return [...updated, ...added, ...removed]
    .filter((row) => !isTemplateTitle(row.title))
    .sort((a, b) => {
    const typeOrder = { Updated: 0, Added: 1, Removed: 2 };
    const dateDiff = Date.parse(b.changed_at || 0) - Date.parse(a.changed_at || 0);
    return dateDiff || (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) || a.title.localeCompare(b.title);
    });
}

function withManualChangeMetadata(rows, changedAt) {
  return rows.map((row) => ({
    ...row,
    change_source: "dashboard",
    sourceLabel: "Manual",
    detailText: row.type === "Updated"
      ? `${row.detailText} | Manual dashboard change ${formatTimestamp(changedAt)}`
      : `${row.detailText} | Manual dashboard change ${formatTimestamp(changedAt)}`,
    manualChangedAt: changedAt,
    changed_at: changedAt || row.changed_at,
  }));
}

function riskWeight(status) {
  return STATUS_RISK_WEIGHT[statusLabel(status)] ?? 0;
}

async function buildMonthDisplayChanges(monthEntry, report) {
  const monthKey = normalize(monthEntry?.month_key);
  if (!monthKey) {
    return flattenChanges(report);
  }

  if (state.monthDisplayChanges[monthKey]) {
    return state.monthDisplayChanges[monthKey];
  }

  const monthlyRows = flattenChanges(report).map((row) => ({
    ...row,
    change_source: "monthly",
    sourceLabel: "Monthly Rollup",
  }));

  const manualRows = [];
  for (const entry of manualDashboardEntriesForMonth(monthKey)) {
    const snapshotReport = await ensureSnapshotChangeReport(entry.snapshot_file);
    if (!snapshotReport) {
      continue;
    }
    manualRows.push(...withManualChangeMetadata(flattenChanges(snapshotReport), entry.generated_at));
  }

  const mergedRows = [...manualRows, ...monthlyRows].sort((a, b) => {
    const dateDiff = Date.parse(b.changed_at || 0) - Date.parse(a.changed_at || 0);
    if (dateDiff !== 0) {
      return dateDiff;
    }
    const manualBias = (normalize(b.change_source) === "dashboard") - (normalize(a.change_source) === "dashboard");
    if (manualBias !== 0) {
      return manualBias;
    }
    return compareText(a.title, b.title);
  });

  state.monthDisplayChanges[monthKey] = mergedRows;
  return mergedRows;
}

function missingDataSummary(rows) {
  const summary = {
    total: 0,
    go_live: 0,
    project_manager: 0,
    implementation_manager: 0,
    project_status: 0,
  };

  rows.forEach((row) => {
    const missingGoLive = !normalize(row.go_live);
    const missingPm = !canonicalPersonName(row.project_manager);
    const missingIm = !canonicalPersonName(row.implementation_manager);
    const missingStatus = statusLabel(row.project_status) === "Unknown";
    if (missingGoLive || missingPm || missingIm || missingStatus) {
      summary.total += 1;
    }
    if (missingGoLive) summary.go_live += 1;
    if (missingPm) summary.project_manager += 1;
    if (missingIm) summary.implementation_manager += 1;
    if (missingStatus) summary.project_status += 1;
  });

  return summary;
}

function latestStatusMovementSummary(report) {
  const summary = {
    changed: 0,
    riskUp: 0,
    riskDown: 0,
  };

  (report?.updated || []).forEach((row) => {
    const statusChange = row?.changes?.project_status;
    if (!statusChange) {
      return;
    }
    summary.changed += 1;
    const before = riskWeight(statusChange.before);
    const after = riskWeight(statusChange.after);
    if (after > before) {
      summary.riskUp += 1;
    } else if (after < before) {
      summary.riskDown += 1;
    }
  });

  return summary;
}

function latestRiskUpProjectKeys(report) {
  const keys = new Set();

  (report?.updated || []).forEach((row) => {
    const statusChange = row?.changes?.project_status;
    if (!statusChange) {
      return;
    }

    const before = riskWeight(statusChange.before);
    const after = riskWeight(statusChange.after);
    if (after > before) {
      const pageId = normalize(row.page_id);
      const title = normalize(row.title);
      if (pageId) {
        keys.add(`page:${pageId}`);
      }
      if (title) {
        keys.add(`title:${title.toLowerCase()}`);
      }
    }
  });

  return keys;
}

function attentionItemTone(score) {
  if (score >= 8) return "red";
  if (score >= 5) return "yellow";
  return "blue";
}

function attentionSignalsForRow(row, riskUpKeys) {
  const reasons = [];
  let score = 0;
  const status = statusLabel(row.project_status);
  const pageIdKey = normalize(row.page_id) ? `page:${normalize(row.page_id)}` : "";
  const titleKey = normalize(row.title) ? `title:${normalize(row.title).toLowerCase()}` : "";
  const goLiveDate = parseGoLiveDate(row.go_live);
  const now = new Date();

  if (status === "Red") {
    score += 5;
    reasons.push("Red status");
  } else if (status === "Yellow") {
    score += 3;
    reasons.push("Yellow status");
  } else if (status === "On Hold") {
    score += 2;
    reasons.push("On hold");
  } else if (status === "Unknown") {
    score += 2;
    reasons.push("Missing status");
  }

  if (!normalize(row.go_live)) {
    score += 2;
    reasons.push("Missing go-live");
  }
  if (!canonicalPersonName(row.project_manager)) {
    score += 2;
    reasons.push("Missing PM");
  }
  if (!canonicalPersonName(row.implementation_manager)) {
    score += 2;
    reasons.push("Missing IM");
  }

  if (goLiveDate) {
    const daysUntil = Math.ceil((goLiveDate.getTime() - now.getTime()) / 86400000);
    if (daysUntil < 0) {
      score += 4;
      reasons.push("Past due go-live");
    } else if (daysUntil <= 30 && riskWeight(status) >= STATUS_RISK_WEIGHT["On Hold"]) {
      score += 3;
      reasons.push("Go-live in 30 days");
    } else if (daysUntil <= 60 && riskWeight(status) >= STATUS_RISK_WEIGHT.Yellow) {
      score += 2;
      reasons.push("Go-live in 60 days");
    } else if (daysUntil <= 90 && riskWeight(status) >= STATUS_RISK_WEIGHT.Yellow) {
      score += 1;
      reasons.push("Go-live in 90 days");
    }
  }

  if ((pageIdKey && riskUpKeys.has(pageIdKey)) || (titleKey && riskUpKeys.has(titleKey))) {
    score += 4;
    reasons.push("Status moved up");
  }

  const notesText = `${normalize(row.project_health)} ${normalize(row.client_health)}`.toLowerCase();
  if (/\b(blocked|delay|delayed|escalat|waiting|issue|risk)\b/.test(notesText)) {
    score += 2;
    reasons.push("Notes mention risk");
  }

  return {
    score,
    reasons: [...new Set(reasons)],
    tone: attentionItemTone(score),
  };
}

function isAtRiskAttention(attention) {
  const reasons = attention?.reasons || [];
  const primaryReasons = new Set([
    "Red status",
    "Yellow status",
    "On hold",
    "Missing status",
    "Past due go-live",
    "Status moved up",
    "Missing go-live",
    "Missing PM",
    "Missing IM",
  ]);

  if (reasons.some((reason) => primaryReasons.has(reason))) {
    return true;
  }

  return reasons.includes("Notes mention risk") && reasons.length > 1;
}

function groupChangesByProject(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const key = normalize(row.page_id) || normalize(row.title);
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...row,
        projectChangeCount: 0,
        changeTypes: new Set(),
        changedFieldSet: new Set(),
        groupedChanges: [],
      });
    }

    const group = grouped.get(key);
    group.projectChangeCount += 1;
    group.changeTypes.add(row.type);
    (row.changedFields || []).forEach((field) => group.changedFieldSet.add(field));
    group.groupedChanges.push(row);
    if (Date.parse(row.changed_at || 0) > Date.parse(group.changed_at || 0)) {
      group.changed_at = row.changed_at;
    }
  });

  return [...grouped.values()].map((group) => ({
    ...group,
    type: [...group.changeTypes].sort().join(", "),
    changedFields: [...group.changedFieldSet],
    detailText: `${group.projectChangeCount} change${group.projectChangeCount === 1 ? "" : "s"} across ${group.changeTypes.size} type${group.changeTypes.size === 1 ? "" : "s"}`,
  }));
}

function renderChangesDataNote() {
  const note = document.getElementById("changesDataNote");
  if (!note) {
    return;
  }

  const report = currentChangesReport();
  const meta = buildChangesDataNote(report, state.changeLog);
  note.className = `changes-note changes-note-${meta.tone}`;
  note.textContent = state.activeChangeMonthKey
    ? `${meta.message} Viewing ${activeSnapshotLabel()}.`
    : meta.message;
}

function populateSelect(selectId, values) {
  const select = document.getElementById(selectId);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function populateYearFilter(values) {
  const yearFilter = document.getElementById("yearFilter");
  if (!yearFilter) {
    return;
  }

  if (yearFilter.tagName === "SELECT") {
    yearFilter.innerHTML = '<option value="">All</option>';
    populateSelect("yearFilter", values);
    return;
  }

  const listId = yearFilter.getAttribute("list");
  if (!listId) {
    return;
  }
  const datalist = document.getElementById(listId);
  if (!datalist) {
    return;
  }

  datalist.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    datalist.appendChild(option);
  });
}

function syncPeopleFilters(filters = currentFilterValues()) {
  if (!["active", "go-lives", "risk"].includes(dashboardMode())) {
    return;
  }

  const imFilter = document.getElementById("imFilter");
  const pmFilter = document.getElementById("pmFilter");
  if (!imFilter || !pmFilter) {
    return;
  }

  const imCurrentValue = normalize(imFilter.value);
  const pmCurrentValue = normalize(pmFilter.value);

  const imRows = filterProjectRows(state.projects, {
    ...filters,
    im: "",
  });
  const pmRows = filterProjectRows(state.projects, {
    ...filters,
    pm: "",
  });

  const imValues = uniqueSorted(imRows.map((row) => canonicalPersonName(row.implementation_manager)).filter(Boolean));
  const pmValues = uniqueSorted(pmRows.map((row) => canonicalPersonName(row.project_manager)).filter(Boolean));

  imFilter.innerHTML = '<option value="">All</option>';
  pmFilter.innerHTML = '<option value="">All</option>';
  populateSelect("imFilter", imValues);
  populateSelect("pmFilter", pmValues);

  if (imValues.includes(imCurrentValue)) {
    imFilter.value = imCurrentValue;
  }
  if (pmValues.includes(pmCurrentValue)) {
    pmFilter.value = pmCurrentValue;
  }
}

function currentFilterValues() {
  const yearElement = document.getElementById("yearFilter");
  const stateElement = document.getElementById("stateFilter");
  const startYearElement = document.getElementById("startYearFilter");
  const atRiskOnlyToggle = document.getElementById("atRiskOnlyToggle");
  const riskLevelElement = document.getElementById("riskLevelFilter");
  const riskCategoryElement = document.getElementById("riskCategoryFilter");
  const daysToGoLiveElement = document.getElementById("daysToGoLiveFilter");
  return {
    search: normalize(document.getElementById("searchInput")?.value).toLowerCase(),
    status: normalize(document.getElementById("statusFilter")?.value),
    im: normalize(document.getElementById("imFilter")?.value),
    pm: normalize(document.getElementById("pmFilter")?.value),
    year: normalize(yearElement ? yearElement.value : ""),
    stateCode: normalize(stateElement ? stateElement.value : ""),
    startYear: normalize(startYearElement ? startYearElement.value : ""),
    selectedModules: selectedValues("moduleFilter"),
    chartStatus: normalize(state.chartFilters.status),
    chartPm: normalize(state.chartFilters.pm),
    atRiskOnly: !!(atRiskOnlyToggle && atRiskOnlyToggle.checked),
    attentionReason: normalize(state.attentionFilters.reason),
    riskLevel: normalize(riskLevelElement ? riskLevelElement.value : ""),
    riskCategory: normalize(riskCategoryElement ? riskCategoryElement.value : ""),
    daysToGoLive: normalize(daysToGoLiveElement ? daysToGoLiveElement.value : ""),
  };
}

function rowMatchesProjectSearch(row, search) {
  if (!search) {
    return true;
  }

  const haystack = [
    row.title,
    row.project_status,
    canonicalPersonName(row.project_manager),
    canonicalPersonName(row.implementation_manager),
    row.region_state,
    row.implementation_start_date,
    ...normalizeList(row.contracted_products),
    row.project_health,
    row.client_health,
  ]
    .map((value) => normalize(value).toLowerCase())
    .join(" ");
  return haystack.includes(search);
}

function filterProjectRows(rows, filters) {
  const riskUpKeys = latestRiskUpProjectKeys(currentChangesReport());
  const forceRiskList = dashboardMode() === "risk";
  return rows
    .filter((row) => matchesStatusFilter(row, filters.status))
    .filter((row) => !filters.im || canonicalPersonName(row.implementation_manager) === filters.im)
    .filter((row) => !filters.pm || canonicalPersonName(row.project_manager) === filters.pm)
    .filter((row) => !filters.year || goLiveYear(row.go_live) === filters.year)
    .filter((row) => !filters.stateCode || projectState(row) === filters.stateCode)
    .filter((row) => !filters.selectedModules.length || filters.selectedModules.some((module) => normalizeList(row.contracted_products).includes(module)))
    .filter((row) => !filters.startYear || implementationStartYear(row.implementation_start_date) === filters.startYear)
    .filter((row) => !filters.chartStatus || statusLabel(row.project_status) === filters.chartStatus)
    .filter((row) => !filters.chartPm || canonicalPersonName(row.project_manager) === filters.chartPm)
    .filter((row) => {
      // Enhanced risk level filter
      if (filters.riskLevel) {
        const projectRiskLevel = calculateRiskLevel(row);
        if (projectRiskLevel !== filters.riskLevel) return false;
      }
      return true;
    })
    .filter((row) => {
      // Risk category filter
      if (filters.riskCategory) {
        const categories = getProjectRiskCategories(row);
        if (!categories.some(cat => cat.key === filters.riskCategory)) return false;
      }
      return true;
    })
    .filter((row) => {
      // Days to go-live filter
      if (filters.daysToGoLive) {
        const goLiveDate = parseGoLiveDate(row.go_live);
        if (!goLiveDate) return filters.daysToGoLive === "past-due";
        const now = new Date();
        const daysUntil = Math.floor((goLiveDate - now) / (1000 * 60 * 60 * 24));

        if (filters.daysToGoLive === "past-due") return daysUntil < 0;
        if (filters.daysToGoLive === "0-30") return daysUntil >= 0 && daysUntil <= 30;
        if (filters.daysToGoLive === "30-60") return daysUntil > 30 && daysUntil <= 60;
        if (filters.daysToGoLive === "60-90") return daysUntil > 60 && daysUntil <= 90;
        if (filters.daysToGoLive === "90+") return daysUntil > 90;
      }
      return true;
    })
    .filter((row) => {
      if (!forceRiskList && !filters.atRiskOnly && !filters.attentionReason) {
        return true;
      }
      const attention = attentionSignalsForRow(row, riskUpKeys);
      if ((forceRiskList || filters.atRiskOnly) && !isAtRiskAttention(attention)) {
        return false;
      }
      if (filters.attentionReason && !attention.reasons.includes(filters.attentionReason)) {
        return false;
      }
      return true;
    })
    .filter((row) => rowMatchesProjectSearch(row, filters.search));
}

function openGoLiveProjectKeys() {
  return new Set(
    (state.projects || []).flatMap((row) => {
      const keys = [];
      const pageId = normalize(row.page_id);
      const title = normalize(row.title).toLowerCase();
      if (pageId) {
        keys.push(`page:${pageId}`);
      }
      if (title) {
        keys.push(`title:${title}`);
      }
      return keys;
    }),
  );
}

function excludeClosedGoLives(rows) {
  if (dashboardMode() !== "go-lives") {
    return rows;
  }

  const closedKeys = openGoLiveProjectKeys();
  if (!closedKeys.size) {
    return rows;
  }

  return rows.filter((row) => {
    const pageId = normalize(row.page_id);
    const title = normalize(row.title).toLowerCase();
    return !(pageId && closedKeys.has(`page:${pageId}`)) && !(title && closedKeys.has(`title:${title}`));
  });
}

function goLivesCompanionSummary(filters) {
  const selectedYear = filters.year || String(new Date().getUTCFullYear());
  const remainingRows = excludeClosedGoLives(filterProjectRows(state.activeProjects, {
    ...filters,
    status: "",
    selectedModules: [],
    startYear: "",
    chartStatus: "",
    chartPm: "",
    year: selectedYear,
  }));

  return {
    year: selectedYear,
    remaining: remainingRows.length,
  };
}

function goLivesRemainingRows(filters) {
  const selectedYear = filters.year || String(new Date().getUTCFullYear());
  return excludeClosedGoLives(filterProjectRows(state.activeProjects, {
    ...filters,
    status: "",
    selectedModules: [],
    startYear: "",
    chartStatus: "",
    chartPm: "",
    year: selectedYear,
  })).sort((a, b) => compareGoLiveDates(a.go_live, b.go_live));
}

async function loadActiveProjectsForGoLives() {
  if (dashboardMode() !== "go-lives") {
    return;
  }

  const payload = await loadJson("./data/projects.json");
  state.activeProjects = (payload.projects || [])
    .map((row) => normalizeProjectRow(row))
    .filter((row) => !isTemplateTitle(row.title));
}

function activeChartFilterText() {
  const parts = [];
  if (state.chartFilters.status) {
    parts.push(`Status: ${state.chartFilters.status}`);
  }
  if (state.chartFilters.pm) {
    parts.push(`PM: ${state.chartFilters.pm}`);
  }
  return parts.join(" | ");
}

function renderChartFilterSummary() {
  const summary = document.getElementById("chartFilterSummary");
  if (!summary) {
    return;
  }

  const text = activeChartFilterText();
  if (!text) {
    summary.innerHTML = "";
    summary.classList.add("chart-filter-hidden");
    return;
  }

  summary.classList.remove("chart-filter-hidden");
  summary.innerHTML = `
    <span class="chart-filter-text">Chart filter active: ${text}</span>
    <button type="button" class="chart-filter-clear" id="clearChartFilterButton">Clear</button>
  `;
  document.getElementById("clearChartFilterButton").addEventListener("click", () => {
    state.chartFilters.status = "";
    state.chartFilters.pm = "";
    applyFilters();
  });
}

function setChartFilter(kind, value) {
  if (kind === "status") {
    state.chartFilters.status = state.chartFilters.status === value ? "" : value;
  }
  if (kind === "pm") {
    state.chartFilters.pm = state.chartFilters.pm === value ? "" : value;
  }
  applyFilters();
}

function metricToneForStatus(status) {
  const value = statusLabel(status).toLowerCase();
  if (value === "green") return "green";
  if (value === "yellow") return "yellow";
  if (value === "red") return "red";
  if (value === "on hold") return "blue";
  if (value === "not started") return "slate";
  if (value === "unknown") return "slate";
  return "";
}

function formatPercent(value, total) {
  if (!total) {
    return "0%";
  }
  return `${Math.round((value / total) * 100)}%`;
}

function statusFilterOptions(rows) {
  const statuses = uniqueSorted(rows.map((row) => statusLabel(row.project_status)));
  if (dashboardMode() === "active") {
    return ["Red / Yellow", ...statuses];
  }
  return statuses;
}

function matchesStatusFilter(row, statusFilterValue) {
  if (!statusFilterValue) {
    return true;
  }
  const current = statusLabel(row.project_status);
  if (statusFilterValue === "Red / Yellow") {
    return current === "Red" || current === "Yellow";
  }
  return current === statusFilterValue;
}

function monthKey(value) {
  const parsed = Date.parse(normalize(value));
  if (Number.isNaN(parsed)) {
    return "";
  }
  const date = new Date(parsed);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabelFromKey(key) {
  if (!key) {
    return "";
  }

  const [year, month] = key.split("-").map(Number);
  if (!year || !month) {
    return key;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function previousMonthKey(key) {
  if (!key) {
    return "";
  }

  const [year, month] = key.split("-").map(Number);
  if (!year || !month) {
    return "";
  }

  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function historyEntryStatusSummary(entry) {
  return entry?.status_summary || {};
}

function historyEntryProjectCount(entry) {
  if (typeof entry?.project_count === "number") {
    return entry.project_count;
  }

  return Object.values(historyEntryStatusSummary(entry)).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function latestMonthlyStatusComparison(log) {
  const dated = [...(log || [])]
    .filter((entry) => !Number.isNaN(Date.parse(entry.generated_at || "")))
    .sort((a, b) => Date.parse(a.generated_at) - Date.parse(b.generated_at));
  if (!dated.length) {
    return null;
  }

  const latestByMonth = new Map();
  dated.forEach((entry) => {
    const key = monthKey(entry.generated_at);
    if (key) {
      latestByMonth.set(key, entry);
    }
  });

  const monthKeys = [...latestByMonth.keys()].sort();
  const currentMonthKey = monthKeys[monthKeys.length - 1];
  if (!currentMonthKey) {
    return null;
  }

  const previousMonth = previousMonthKey(currentMonthKey);
  if (!previousMonth || !latestByMonth.has(previousMonth)) {
    return null;
  }

  return {
    current: latestByMonth.get(currentMonthKey),
    previous: latestByMonth.get(previousMonth),
  };
}

function renderMetrics(rows) {
  const metrics = document.getElementById("metrics");
  const mode = dashboardMode();
  if (mode === "changes") {
    const report = currentChangesReport() || { summary: { added: 0, updated: 0, removed: 0 } };
    const latestSummary = report.summary || { added: 0, updated: 0, removed: 0 };
    const total = (latestSummary.added || 0) + (latestSummary.updated || 0) + (latestSummary.removed || 0);
    const activeRows = Array.isArray(state.projects) ? state.projects : [];
    const missing = missingDataSummary(activeRows);
    const movement = latestStatusMovementSummary(currentChangesReport());
    const cards = [
      { label: "Latest Total Changes", value: total },
      { label: "Added", value: latestSummary.added || 0, tone: "green" },
      { label: "Updated", value: latestSummary.updated || 0 },
      { label: "Removed", value: latestSummary.removed || 0, tone: "red" },
      { label: "Status Moves", value: movement.changed, tone: movement.riskUp ? "yellow" : "blue", detail: `Up ${movement.riskUp} | Down ${movement.riskDown}` },
      { label: "Missing Data", value: missing.total, tone: missing.total ? "slate" : "green", detail: `GL ${missing.go_live} | PM ${missing.project_manager} | IM ${missing.implementation_manager}` },
      { label: "Snapshots Tracked", value: state.changeLog.length },
    ];

    metrics.innerHTML = "";
    cards.forEach(({ label, value, tone, detail }) => {
      const card = document.createElement("article");
      card.className = tone ? `metric metric-${tone}` : "metric";
      card.innerHTML = `<h3>${label}</h3><p>${value}</p>${detail ? `<div class="metric-detail">${detail}</div>` : ""}`;
      metrics.appendChild(card);
    });
    return;
  }

  const today = new Date();
  const ninetyDays = new Date(today);
  ninetyDays.setUTCDate(ninetyDays.getUTCDate() + 90);

  let cards;
  if (mode === "go-lives") {
    const filters = currentFilterValues();
    const summary = goLivesCompanionSummary(filters);
    const currentLiveCount = rows.filter((row) => goLiveYear(row.go_live) === summary.year).length;
    const uniqueStates = new Set(rows.map((row) => projectState(row)).filter(Boolean)).size;

    cards = [
      { label: "Total Projects", value: rows.length },
      { label: `Current Live Clients ${summary.year}`, value: currentLiveCount },
      {
        label: `Remaining Live Clients ${summary.year}`,
        value: summary.remaining,
        tone: summary.remaining ? "yellow" : "green",
        detail: summary.remaining ? "Click to view list" : "No remaining clients",
        action: "remaining-go-lives",
      },
      { label: "States", value: uniqueStates },
    ];
  } else if (mode === "risk") {
    const missing = missingDataSummary(rows);
    const movement = latestStatusMovementSummary(currentChangesReport());
    const topIssues = noteIssueSummary(rows).slice(0, 3);
    const redCount = rows.filter((row) => statusLabel(row.project_status) === "Red").length;
    const yellowCount = rows.filter((row) => statusLabel(row.project_status) === "Yellow").length;
    const pastDue = rows
      .map((row) => ({ date: parseGoLiveDate(row.go_live) }))
      .filter((entry) => entry.date && entry.date < today).length;

    cards = [
      { label: "Risk Projects", value: rows.length },
      { label: "Red", value: redCount, tone: "red" },
      { label: "Yellow", value: yellowCount, tone: "yellow" },
      { label: "Past Due", value: pastDue, tone: pastDue ? "red" : "green" },
      { label: "Missing Data", value: missing.total, tone: missing.total ? "slate" : "green", detail: `GL ${missing.go_live} | PM ${missing.project_manager} | IM ${missing.implementation_manager}` },
      { label: "Status Moves", value: movement.changed, tone: movement.riskUp ? "yellow" : "blue", detail: `Up ${movement.riskUp} | Down ${movement.riskDown}` },
      ...topIssues.map((issue) => ({ label: `${issue.label} Tags`, value: issue.value, tone: issue.tone, detail: formatPercent(issue.value, rows.length) })),
    ];
  } else {
    const counts = rows.reduce((acc, row) => {
      const status = statusLabel(row.project_status);
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    const datedRows = rows
      .map((row) => ({ row, date: parseGoLiveDate(row.go_live) }))
      .filter((entry) => entry.date);
    const nextNinety = datedRows.filter((entry) => entry.date >= today && entry.date <= ninetyDays).length;
    const pastDue = datedRows.filter((entry) => entry.date < today).length;
    const statusCards = Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([status, value]) => ({
        label: status,
        value,
        tone: metricToneForStatus(status),
        detail: formatPercent(value, rows.length),
      }));

    cards = [
      { label: "Total Projects", value: rows.length },
      ...statusCards,
      { label: "Go-Lives Next 90", value: nextNinety },
      { label: "Past Due", value: pastDue },
    ];
  }

  metrics.innerHTML = "";
  cards.forEach(({ label, value, tone, detail, action }) => {
    const card = document.createElement(action ? "button" : "article");
    card.className = tone ? `metric metric-${tone}` : "metric";
    if (action) {
      card.type = "button";
      card.className += " metric-button";
      card.dataset.metricAction = action;
    }
    card.innerHTML = `<h3>${label}</h3><p>${value}</p>${detail ? `<div class="metric-detail">${detail}</div>` : ""}`;
    metrics.appendChild(card);
  });

  metrics.querySelectorAll("[data-metric-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.metricAction === "remaining-go-lives") {
        state.goLivesDetail.mode = "remaining";
        renderGoLivesDrilldown();
      }
    });
  });
}

function buildTopCounts(rows, labelBuilder, valueBuilder, limit = 6) {
  const counts = new Map();
  rows.forEach((row) => {
    const label = labelBuilder(row);
    if (!label) {
      return;
    }
    counts.set(label, (counts.get(label) || 0) + valueBuilder(row));
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function buildChronologicalMonthCounts(rows, limit = 6) {
  const counts = new Map();

  rows.forEach((row) => {
    const date = parseGoLiveDate(row.go_live);
    if (!date) {
      return;
    }
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, value]) => ({
      label: new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" })
        .format(new Date(`${key}-01T00:00:00Z`)),
      value,
    }));
}

function chartDataForMode(rows) {
  const mode = document.body.dataset.dashboardMode || "active";
  const today = new Date();

  if (mode === "go-lives") {
    return [
      {
        title: "Go-Lives By Year",
        meta: "Closed project completions grouped by year",
        items: buildTopCounts(rows, (row) => goLiveYear(row.go_live), () => 1, 6),
      },
      {
        title: "Top States",
        meta: "States with the largest number of closed projects",
        items: buildTopCounts(rows, (row) => projectState(row), () => 1, 8),
      },
      {
        title: "PM Distribution",
        meta: "Project manager volume across the filtered closed list",
        items: buildTopCounts(rows, (row) => canonicalPersonName(row.project_manager), () => 1, 8),
        filterKind: "pm",
      },
    ];
  }

  if (mode === "risk") {
    const riskReasonItems = buildTopCounts(
      rows.flatMap((row) => attentionSignalsForRow(row, latestRiskUpProjectKeys(currentChangesReport())).reasons.map((reason) => ({ reason }))),
      (entry) => entry.reason,
      () => 1,
      8,
    );
    const issueComparison = issueComparisonItems(state.issueHistoryComparison, 8);

    return [
      {
        title: "Issue Buckets MoM",
        meta: state.issueHistoryComparison
          ? `${monthLabelFromKey(monthKey(state.issueHistoryComparison.previous.generated_at))} vs ${monthLabelFromKey(monthKey(state.issueHistoryComparison.current.generated_at))}`
          : "Appears after consecutive monthly snapshots are available",
        items: issueComparison,
        type: "comparison",
      },
      {
        title: "Risk Status Mix",
        meta: "Distribution of statuses inside the filtered risk list",
        items: ["Red", "Yellow", "On Hold", "Unknown", "Green", "Not Started"]
          .map((status) => ({
            label: status,
            value: rows.filter((row) => statusLabel(row.project_status) === status).length,
            tone: status.toLowerCase().replace(/\s+/g, "-"),
          }))
          .filter((item) => item.value > 0),
        type: "pie",
        filterKind: "status",
      },
      {
        title: "Top Risk Signals",
        meta: "Most common reasons projects are appearing on the risk list",
        items: riskReasonItems,
      },
      {
        title: "Issue Buckets",
        meta: "Consistent note tags derived from project and client health notes",
        items: noteIssueSummary(rows).slice(0, 8),
      },
      {
        title: "PM Risk Load",
        meta: "Project counts by project manager across the filtered risk list",
        items: buildTopCounts(rows, (row) => canonicalPersonName(row.project_manager), () => 1, 8),
        filterKind: "pm",
      },
    ];
  }

  const statusCounts = ["Green", "Yellow", "Red", "On Hold", "Not Started"]
    .map((status) => ({
      label: status,
      value: rows.filter((row) => statusLabel(row.project_status) === status).length,
      tone: status.toLowerCase().replace(/\s+/g, "-"),
    }))
    .filter((item) => item.value > 0);

  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const sixMonthsOut = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 6, 1));
  const monthly = buildChronologicalMonthCounts(
    rows.filter((row) => {
      const date = parseGoLiveDate(row.go_live);
      return date && date >= monthStart && date < sixMonthsOut;
    }),
    6,
  );
  const historyComparison = latestMonthlyStatusComparison(state.changeLog);
  const issueComparison = issueComparisonItems(state.issueHistoryComparison, 8);
  const comparisonStatuses = ["Green", "Yellow", "Red", "On Hold", "Not Started"];
  const comparisonItems = historyComparison
    ? [
        {
          label: "Total Projects",
          currentValue: historyEntryProjectCount(historyComparison.current),
          previousValue: historyEntryProjectCount(historyComparison.previous),
          tone: "",
        },
        ...comparisonStatuses.map((status) => ({
          label: status,
          currentValue: historyEntryStatusSummary(historyComparison.current)[status] || 0,
          previousValue: historyEntryStatusSummary(historyComparison.previous)[status] || 0,
          tone: status.toLowerCase().replace(/\s+/g, "-"),
        })),
      ]
    : [];

  return [
    {
      title: "Issue Buckets MoM",
      meta: state.issueHistoryComparison
        ? `${monthLabelFromKey(monthKey(state.issueHistoryComparison.previous.generated_at))} vs ${monthLabelFromKey(monthKey(state.issueHistoryComparison.current.generated_at))}`
        : "Appears after consecutive monthly snapshots are available",
      items: issueComparison,
      type: "comparison",
    },
    {
      title: "Month-Over-Month Status",
      meta: historyComparison
        ? `${monthLabelFromKey(monthKey(historyComparison.previous.generated_at))} vs ${monthLabelFromKey(monthKey(historyComparison.current.generated_at))}`
        : "Appears after consecutive monthly snapshots are available",
      items: comparisonItems,
      type: "comparison",
    },
    {
      title: "Status Mix",
      meta: "Green vs risk categories in the filtered portfolio",
      items: statusCounts,
      type: "pie",
      filterKind: "status",
    },
    {
      title: "Upcoming Go-Lives",
      meta: "Filtered go-lives scheduled in the next 6 months",
      items: monthly,
    },
    {
      title: "Issue Buckets",
      meta: "Consistent note tags derived from project and client health notes",
      items: noteIssueSummary(rows).slice(0, 8),
    },
    {
      title: "PM Workload",
      meta: "Project counts by project manager in the active list",
      items: buildTopCounts(rows, (row) => canonicalPersonName(row.project_manager), () => 1, 8),
      filterKind: "pm",
    },
  ];
}

function pieToneColor(tone) {
  if (tone === "green") return "#2e8b57";
  if (tone === "yellow") return "#b88416";
  if (tone === "red") return "#c53d3d";
  if (tone === "on-hold") return "#0c5da5";
  if (tone === "not-started") return "#7a8796";
  return "#0c5da5";
}

function renderPieChart(chart) {
  const activeValue = chart.filterKind === "status" ? state.chartFilters.status : chart.filterKind === "pm" ? state.chartFilters.pm : "";
  if (!chart.items.length) {
    return '<p class="chart-meta">No chart data for the current filters.</p>';
  }

  const total = chart.items.reduce((sum, item) => sum + item.value, 0) || 1;
  let currentAngle = -90;
  const slices = chart.items.map((item) => {
    const sliceAngle = (item.value / total) * 360;
    const start = polarToCartesian(50, 50, 42, currentAngle + sliceAngle);
    const end = polarToCartesian(50, 50, 42, currentAngle);
    const largeArcFlag = sliceAngle > 180 ? 1 : 0;
    const d = [
      `M 50 50`,
      `L ${end.x} ${end.y}`,
      `A 42 42 0 ${largeArcFlag} 1 ${start.x} ${start.y}`,
      `Z`,
    ].join(" ");
    currentAngle += sliceAngle;
    return `<path d="${d}" fill="${pieToneColor(item.tone)}"></path>`;
  }).join("");

  const legend = chart.items.map((item) => {
    const isActive = activeValue && activeValue === item.label;
    const labelHtml = chart.filterKind
      ? `<button type="button" class="pie-legend-button${isActive ? " is-active" : ""}" data-chart-filter="${chart.filterKind}" data-chart-value="${item.label}"><span class="pie-dot" style="background:${pieToneColor(item.tone)}"></span>${item.label}</button>`
      : `<div class="pie-legend-label"><span class="pie-dot" style="background:${pieToneColor(item.tone)}"></span>${item.label}</div>`;
    return `
      <div class="pie-legend-row">
        ${labelHtml}
        <div class="pie-legend-value">${item.value}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="pie-layout">
      <div class="pie-wrap">
        <svg class="pie-chart" viewBox="0 0 100 100" aria-label="${chart.title}">
          ${slices}
          <circle cx="50" cy="50" r="20" fill="#ffffff"></circle>
          <text x="50" y="47" text-anchor="middle" class="pie-total-label">Total</text>
          <text x="50" y="58" text-anchor="middle" class="pie-total-value">${total}</text>
        </svg>
      </div>
      <div class="pie-legend">${legend}</div>
    </div>
  `;
}

function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = (angleInDegrees * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function renderCharts(rows) {
  const chartGrid = document.getElementById("chartGrid");
  if (!chartGrid) {
    return;
  }

  const charts = chartDataForMode(rows);
  chartGrid.innerHTML = "";

  charts.forEach((chart) => {
    const card = document.createElement("article");
    card.className = "chart-card";

    let content;
    if (chart.type === "pie") {
      content = renderPieChart(chart);
    } else if (chart.type === "comparison") {
      const max = Math.max(...chart.items.flatMap((item) => [item.currentValue, item.previousValue]), 1);
      content = chart.items.length
        ? `<div class="comparison-chart">${chart.items.map((item) => {
            const currentWidth = Math.max(8, Math.round((item.currentValue / max) * 100));
            const previousWidth = Math.max(8, Math.round((item.previousValue / max) * 100));
            const toneClass = item.tone ? ` chart-${item.tone}` : "";
            const delta = item.currentValue - item.previousValue;
            const deltaLabel = delta > 0 ? `+${delta}` : `${delta}`;
            return `
              <div class="comparison-row">
                <div class="comparison-label">${item.label}</div>
                <div class="comparison-bars">
                  <div class="comparison-series">
                    <span class="comparison-series-label">Prev</span>
                    <div class="chart-track"><div class="chart-fill comparison-fill-previous${toneClass}" style="width:${previousWidth}%"></div></div>
                    <div class="chart-value">${item.previousValue}</div>
                  </div>
                  <div class="comparison-series">
                    <span class="comparison-series-label">Current</span>
                    <div class="chart-track"><div class="chart-fill${toneClass}" style="width:${currentWidth}%"></div></div>
                    <div class="chart-value">${item.currentValue}</div>
                  </div>
                </div>
                <div class="comparison-delta${delta === 0 ? "" : delta > 0 ? " comparison-up" : " comparison-down"}">${deltaLabel}</div>
              </div>
            `;
          }).join("")}</div>`
        : '<p class="chart-meta">No monthly comparison data available yet.</p>';
    } else {
      const max = Math.max(...chart.items.map((item) => item.value), 1);
      const activeValue = chart.filterKind === "status" ? state.chartFilters.status : chart.filterKind === "pm" ? state.chartFilters.pm : "";
      const bars = chart.items.length
        ? chart.items.map((item) => {
            const width = Math.max(8, Math.round((item.value / max) * 100));
            const toneClass = item.tone ? ` chart-${item.tone}` : "";
            const isActive = activeValue && activeValue === item.label;
            const labelHtml = chart.filterKind
              ? `<button type="button" class="chart-label-button${isActive ? " is-active" : ""}" data-chart-filter="${chart.filterKind}" data-chart-value="${item.label}">${item.label}</button>`
              : `<div class="chart-label">${item.label}</div>`;
            return `
              <div class="chart-row">
                ${labelHtml}
                <div class="chart-track"><div class="chart-fill${toneClass}" style="width:${width}%"></div></div>
                <div class="chart-value">${item.value}</div>
              </div>
            `;
          }).join("")
        : '<p class="chart-meta">No chart data for the current filters.</p>';
      content = `<div class="chart-bars">${bars}</div>`;
    }

    card.innerHTML = `
      <h3>${chart.title}</h3>
      <p class="chart-meta">${chart.meta}</p>
      ${content}
    `;
    chartGrid.appendChild(card);
  });

  chartGrid.querySelectorAll("[data-chart-filter][data-chart-value]").forEach((button) => {
    button.addEventListener("click", () => {
      setChartFilter(button.dataset.chartFilter, button.dataset.chartValue);
    });
  });
}

function renderChangesTable(rows) {
  const tbody = document.querySelector("#changesTable tbody");
  const count = document.getElementById("resultsCount");
  if (!tbody || !count) {
    return;
  }

  const groupToggle = document.getElementById("groupChangesToggle");
  const isGrouped = !!groupToggle?.checked;
  const displayRows = isGrouped ? groupChangesByProject(rows) : rows;

  tbody.innerHTML = "";
  count.textContent = isGrouped
    ? `${displayRows.length} project${displayRows.length === 1 ? "" : "s"}`
    : `${rows.length} change${rows.length === 1 ? "" : "s"}`;

  if (!displayRows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty";
    td.textContent = "No matching change records.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  sortedRows(displayRows, "changes").forEach((row) => {
    const tr = document.createElement("tr");
    const meta = [
      formatGoLiveDate(row.go_live),
      statusLabel(row.project_status),
      canonicalPersonName(row.project_manager),
      canonicalPersonName(row.implementation_manager),
    ].filter(Boolean).join(" | ");
    const chips = row.changedFields.length
      ? `<div class="change-chip-row">${row.changedFields.map((field) => `<span class="change-chip">${escapeHtml(fieldLabel(field))}</span>`).join("")}</div>`
      : '<span class="change-muted">N/A</span>';
    const detailHtml = isGrouped
      ? `<div class="change-group-list">${(row.groupedChanges || []).map((entry) => `
          <div class="change-group-item">
            <div class="change-group-head">
              <span class="status-pill ${changeTypeClass(entry.type)}">${escapeHtml(entry.type)}</span>
              ${entry.sourceLabel === "Manual" ? `<span class="change-chip">Manual ${escapeHtml(formatTimestamp(entry.changed_at))}</span>` : ""}
              <span class="change-muted">${escapeHtml(entry.detailText)}</span>
            </div>
            ${(entry.changes || []).length
              ? `<div class="change-detail-list">${entry.changes.map((change) => `
                  <div class="change-detail-item">
                    <div class="change-detail-field">${escapeHtml(fieldLabel(change.field))}</div>
                    <div class="change-detail-values">
                      <span class="change-before">${escapeHtml(normalize(change.before) || "Empty")}</span>
                      <span class="change-arrow">to</span>
                      <span class="change-after">${escapeHtml(normalize(change.after) || "Empty")}</span>
                    </div>
                  </div>
                `).join("")}</div>`
              : `<div class="change-muted">${escapeHtml(entry.detailText)}</div>`}
          </div>
        `).join("")}</div>`
      : row.changes.length
      ? `<div class="change-detail-list">${row.changes.map((change) => `
          <div class="change-detail-item">
            <div class="change-detail-field">${escapeHtml(fieldLabel(change.field))}</div>
            <div class="change-detail-values">
              <span class="change-before">${escapeHtml(normalize(change.before) || "Empty")}</span>
              <span class="change-arrow">to</span>
              <span class="change-after">${escapeHtml(normalize(change.after) || "Empty")}</span>
            </div>
          </div>
        `).join("")}</div>`
      : `<div class="change-muted">${escapeHtml(row.detailText)}</div>`;
    const rowUrl = projectUrl(row);
    const projectHtml = rowUrl
      ? `<a class="project-link" href="${escapeHtml(rowUrl)}" target="_blank" rel="noreferrer">${escapeHtml(row.title)}</a>`
      : `<div class="change-project">${escapeHtml(row.title)}</div>`;
    const snapshotMeta = [normalize(row.region_state), normalize(row.epl_version) ? `v${normalize(row.epl_version)}` : ""]
      .filter(Boolean)
      .join(" | ");
    const sourceMeta = row.sourceLabel === "Manual"
      ? `Manual ${formatTimestamp(row.changed_at)}`
      : row.sourceLabel === "Monthly Rollup"
      ? "Monthly rollup"
      : "";

    tr.innerHTML = `
      <td>${escapeHtml(formatTimestamp(row.changed_at))}</td>
      <td>${isGrouped ? `<div class="change-project-count">${row.projectChangeCount} change${row.projectChangeCount === 1 ? "" : "s"}</div>` : `<span class="status-pill ${changeTypeClass(row.type)}">${escapeHtml(row.type)}</span>${sourceMeta ? `<div class="change-muted">${escapeHtml(sourceMeta)}</div>` : ""}`}</td>
      <td>
        ${projectHtml}
        <div class="change-muted">${escapeHtml(meta || row.detailText)}</div>
        ${snapshotMeta ? `<div class="change-muted">${escapeHtml(snapshotMeta)}</div>` : ""}
      </td>
      <td>${chips}</td>
      <td>${detailHtml}</td>
    `;
    tbody.appendChild(tr);
  });
  applyHeaderSortState("changesTable", "changes");
}

function renderChangeHistory() {
  const tbody = document.querySelector("#historyTable tbody");
  if (!tbody) {
    return;
  }

  tbody.innerHTML = "";
  const rows = sortedRows(state.changeMonths, "history");
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty";
    td.textContent = "No monthly history available yet.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.className = "history-row";
    tr.dataset.monthKey = row.month_key || "";
    tr.classList.toggle("history-row-active", normalize(state.activeChangeMonthKey) === normalize(row.month_key));
    const summary = row.summary || {};
    tr.innerHTML = `
      <td>${escapeHtml(row.month_label || monthLabelFromKey(row.month_key) || formatTimestamp(row.generated_at))}</td>
      <td>${escapeHtml(row.snapshot_file || "")}</td>
      <td>${summary.added || 0}</td>
      <td>${summary.updated || 0}</td>
      <td>${summary.removed || 0}</td>
    `;
    tbody.appendChild(tr);
  });
  applyHeaderSortState("historyTable", "history");
}

function renderGoLivesDrilldown() {
  const panel = document.getElementById("remainingGoLivesPanel");
  const title = document.getElementById("remainingGoLivesTitle");
  const meta = document.getElementById("remainingGoLivesMeta");
  const tbody = document.querySelector("#remainingGoLivesTable tbody");
  if (!panel || !title || !meta || !tbody || dashboardMode() !== "go-lives") {
    return;
  }

  if (state.goLivesDetail.mode !== "remaining") {
    panel.classList.add("field-hidden");
    tbody.innerHTML = "";
    return;
  }

  const filters = currentFilterValues();
  const year = filters.year || String(new Date().getUTCFullYear());
  const rows = goLivesRemainingRows(filters);

  title.textContent = `Remaining Live Clients ${year}`;
  meta.textContent = `${rows.length} active project${rows.length === 1 ? "" : "s"} still scheduled to go live in ${year}.`;
  panel.classList.remove("field-hidden");
  tbody.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty";
    td.textContent = `No remaining live clients found for ${year}.`;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const rowUrl = projectUrl(row);
    tr.innerHTML = `
      <td>${rowUrl ? `<a class="project-link" href="${escapeHtml(rowUrl)}" target="_blank" rel="noreferrer">${escapeHtml(row.title || "")}</a>` : escapeHtml(row.title || "")}</td>
      <td>${escapeHtml(formatGoLiveDate(row.go_live))}</td>
      <td>${escapeHtml(canonicalPersonName(row.project_manager))}</td>
      <td>${escapeHtml(canonicalPersonName(row.implementation_manager))}</td>
      <td>${healthCellHtml(row.project_status, row.project_health)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderNeedsAttention(rows) {
  const panel = document.getElementById("attentionPanel");
  const list = document.getElementById("attentionList");
  const meta = document.getElementById("attentionMeta");
  if (!panel || !list || !meta || !["active", "risk"].includes(dashboardMode())) {
    return;
  }

  const riskUpKeys = latestRiskUpProjectKeys(currentChangesReport());
  const items = rows
    .map((row) => ({ row, attention: attentionSignalsForRow(row, riskUpKeys) }))
    .filter((entry) => entry.attention.score > 0)
    .sort((a, b) => (
      b.attention.score - a.attention.score
      || compareGoLiveDates(a.row.go_live, b.row.go_live)
      || normalize(a.row.title).localeCompare(normalize(b.row.title))
    ));

  list.innerHTML = "";

  if (!items.length) {
    panel.classList.add("field-hidden");
    meta.textContent = "No active attention signals in the current filter set.";
    return;
  }

  panel.classList.remove("field-hidden");
  const visibleItems = items.slice(0, 10);
  const metaParts = [
    `<span class="chart-filter-text">Showing ${visibleItems.length} of ${items.length} project${items.length === 1 ? "" : "s"} with proactive risk signals in the current filter set.</span>`,
  ];
  if (state.attentionFilters.reason) {
    metaParts.push(`<span>Attention filter: ${escapeHtml(state.attentionFilters.reason)}</span>`);
  }
  if (state.attentionFilters.reason || state.attentionFilters.atRiskOnly) {
    metaParts.push('<button type="button" class="chart-filter-clear" id="clearAttentionFilterButton">Clear</button>');
  }
  meta.innerHTML = metaParts.join("");

  visibleItems.forEach(({ row, attention }) => {
    const article = document.createElement("article");
    article.className = `attention-item attention-${attention.tone}`;
    const rowUrl = projectUrl(row);
    const titleHtml = rowUrl
      ? `<a class="project-link attention-title" href="${escapeHtml(rowUrl)}" target="_blank" rel="noreferrer">${escapeHtml(row.title || "")}</a>`
      : `<div class="attention-title">${escapeHtml(row.title || "")}</div>`;
    const metaBits = [
      `Status ${escapeHtml(statusLabel(row.project_status))}`,
      normalize(row.go_live) ? `Go-live ${escapeHtml(formatGoLiveDate(row.go_live))}` : "Go-live missing",
      canonicalPersonName(row.project_manager) ? `PM ${escapeHtml(canonicalPersonName(row.project_manager))}` : "PM missing",
      canonicalPersonName(row.implementation_manager) ? `IM ${escapeHtml(canonicalPersonName(row.implementation_manager))}` : "IM missing",
    ];

    article.innerHTML = `
      <div class="attention-head">
        ${titleHtml}
        <div class="attention-score">Score ${attention.score}</div>
      </div>
      <div class="attention-meta">${metaBits.join(" | ")}</div>
      <div class="attention-reasons">${attention.reasons.map((reason) => `<button type="button" class="attention-reason attention-reason-button${state.attentionFilters.reason === reason ? " is-active" : ""}" data-attention-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`).join("")}</div>
    `;
    list.appendChild(article);
  });

  list.querySelectorAll("[data-attention-reason]").forEach((button) => {
    button.addEventListener("click", () => {
      const reason = normalize(button.dataset.attentionReason);
      state.attentionFilters.reason = state.attentionFilters.reason === reason ? "" : reason;
      applyFilters();
    });
  });

  document.getElementById("clearAttentionFilterButton")?.addEventListener("click", () => {
    state.attentionFilters.reason = "";
    state.attentionFilters.atRiskOnly = false;
    const toggle = document.getElementById("atRiskOnlyToggle");
    if (toggle) {
      toggle.checked = false;
    }
    applyFilters();
  });
}

function renderTable(rows) {
  const tbody = document.querySelector("#projectsTable tbody");
  const count = document.getElementById("resultsCount");
  const mode = dashboardMode();
  tbody.innerHTML = "";
  count.textContent = `${rows.length} project${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = mode === "go-lives" ? 4 : 9;
    td.className = "empty";
    td.textContent = "No matching projects.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  sortedRows(rows).forEach((row) => {
    const tr = document.createElement("tr");
    if (mode === "go-lives") {
      const rowUrl = projectUrl(row);
      tr.innerHTML = `
        <td>${rowUrl ? `<a class="project-link" href="${rowUrl}" target="_blank" rel="noreferrer">${row.title || ""}</a>` : row.title || ""}</td>
        <td>${formatGoLiveDate(row.go_live)}</td>
        <td>${canonicalPersonName(row.project_manager)}</td>
        <td>${canonicalPersonName(row.implementation_manager)}</td>
      `;
    } else {
      const rowUrl = projectUrl(row);
      tr.innerHTML = `
        <td>
          <div class="project-name-cell">
            ${rowUrl ? `<a class="project-link" href="${rowUrl}" target="_blank" rel="noreferrer">${row.title || ""}</a>` : row.title || ""}
            <button type="button" class="project-history-button" data-project-history="true" data-page-id="${escapeHtml(row.page_id || "")}" data-project-title="${escapeHtml(row.title || "")}">History</button>
          </div>
        </td>
        <td>${formatGoLiveDate(row.go_live)}</td>
        <td>${formatStartDate(row.implementation_start_date)}</td>
        <td>${canonicalPersonName(row.project_manager)}</td>
        <td>${canonicalPersonName(row.implementation_manager)}</td>
        <td>${healthCellHtmlWithOptions(row.project_status, row.project_health, {
          editable: canEditProjectStatus(),
          pageId: row.page_id,
          title: row.title,
          issueTags: projectRiskIssueTags(row),
        })}</td>
        <td>${healthCellHtml(row.client_status, row.client_health)}</td>
        <td>${normalize(row.epl_version)}</td>
        <td>${projectState(row)}</td>
      `;
    }
    tbody.appendChild(tr);
  });
  applyHeaderSortState("projectsTable");
}

function applyFilters() {
  closeStatusEditorMenu();

  if (dashboardMode() === "changes") {
    const search = normalize(document.getElementById("searchInput").value).toLowerCase();
    const changeType = normalize(document.getElementById("changeTypeFilter").value);
    const field = normalize(document.getElementById("fieldFilter").value);

    state.filteredChanges = state.changes
      .filter((row) => !changeType || row.type === changeType)
      .filter((row) => !field || row.changedFields.includes(field))
      .filter((row) => {
        if (!search) return true;
        const haystack = [
          row.type,
          row.sourceLabel,
          row.title,
          row.detailText,
          row.go_live,
          row.project_status,
          ...row.changedFields,
          ...row.changes.flatMap((change) => [change.field, change.before, change.after]),
        ]
          .map((value) => normalize(value).toLowerCase())
          .join(" ");
        return haystack.includes(search);
      });

    renderMetrics([]);
    renderChangesDataNote();
    renderChangesSelectionMeta();
    renderChangesTable(state.filteredChanges);
    renderChangeHistory();
    return;
  }

  const filters = currentFilterValues();
  syncPeopleFilters(filters);
  const activeFilters = dashboardMode() === "go-lives" ? currentFilterValues() : filters;

  state.filtered = filterProjectRows(state.projects, activeFilters)
    .sort((a, b) => compareGoLiveDates(a.go_live, b.go_live, dashboardMode() === "go-lives"));

  renderMetrics(state.filtered);
  renderNeedsAttention(state.filtered);
  renderCharts(state.filtered);
  renderChartFilterSummary();
  renderTable(state.filtered);
  renderGoLivesDrilldown();
}

async function loadData() {
  if (window.PROJECT_DASHBOARD_DATA) {
    return window.PROJECT_DASHBOARD_DATA;
  }

  const response = await fetch(DATA_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${DATA_PATH} (${response.status})`);
  }
  return response.json();
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status})`);
  }
  return response.json();
}

async function refreshGoLivesData() {
  const button = document.getElementById("refreshGoLivesButton");
  if (button) {
    button.disabled = true;
    button.textContent = "Refreshing...";
  }

  try {
    const response = await fetch("/api/refresh-go-lives", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Refresh endpoint not available (404). Relaunch the dashboard so the local server restarts, then try again.");
      }
      throw new Error(payload.error || `Refresh failed (${response.status})`);
    }

    const refreshed = await loadJson(`./data/closed_projects.json?refresh=${Date.now()}`);
    await loadActiveProjectsForGoLives();
    state.source = refreshed.source || state.source;
    state.projects = (refreshed.projects || [])
      .map((row) => normalizeProjectRow(row))
      .filter((row) => !isTemplateTitle(row.title));

    document.getElementById("stamp").textContent = refreshed.generated_at
      ? `Last generated: ${formatTimestamp(refreshed.generated_at)}`
      : "Dataset loaded.";

    const statusFilter = document.getElementById("statusFilter");
    if (statusFilter) {
      statusFilter.innerHTML = '<option value="">All</option>';
      populateSelect("statusFilter", statusFilterOptions(state.projects));
    }

    const imFilter = document.getElementById("imFilter");
    if (imFilter) {
      imFilter.innerHTML = '<option value="">All</option>';
    }

    const pmFilter = document.getElementById("pmFilter");
    if (pmFilter) {
      pmFilter.innerHTML = '<option value="">All</option>';
    }

    const yearFilter = document.getElementById("yearFilter");
    if (yearFilter) {
      const currentValue = yearFilter.value;
      const availableYears = goLivesAvailableYears();
      populateYearFilter(availableYears);
      if (availableYears.includes(currentValue)) {
        yearFilter.value = currentValue;
      } else if (availableYears.includes("2026")) {
        yearFilter.value = "2026";
      }
    }

    const stateFilter = document.getElementById("stateFilter");
    if (stateFilter) {
      const currentValue = stateFilter.value;
      stateFilter.innerHTML = '<option value="">All</option>';
      populateSelect("stateFilter", uniqueSorted(state.projects.map((row) => projectState(row))));
      if ([...stateFilter.options].some((option) => option.value === currentValue)) {
        stateFilter.value = currentValue;
      }
    }

    syncPeopleFilters();
    applyFilters();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Refresh Go-Lives";
    }
  }
}

async function loadServerConfig() {
  if (!window.location || !window.location.origin || window.location.origin === "null") {
    return {
      project_status_editable: false,
      status_options: state.server.statusOptions,
    };
  }

  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load server config (${response.status})`);
    }
    return response.json();
  } catch (error) {
    return {
      project_status_editable: false,
      status_options: state.server.statusOptions,
    };
  }
}

async function loadChangesData() {
  const report = window.PROJECT_CHANGES_DATA
    ? window.PROJECT_CHANGES_DATA
    : await loadJson(CHANGES_DATA_PATH).catch(() => null);
  const log = window.PROJECT_CHANGE_LOG_DATA
    ? window.PROJECT_CHANGE_LOG_DATA
    : await loadJson(CHANGE_LOG_PATH).catch(() => []);

  return { report, log: Array.isArray(log) ? log : [] };
}

async function loadSnapshotPayload(snapshotFile) {
  const normalized = normalize(snapshotFile);
  if (!normalized) {
    return null;
  }

  if (state.snapshotPayloads[normalized]) {
    return state.snapshotPayloads[normalized];
  }

  const payload = await loadJson(`./data/history/${normalized}`);
  state.snapshotPayloads[normalized] = payload;
  return payload;
}

async function buildProjectNoteHistory(pageId) {
  const normalizedPageId = normalize(pageId);
  if (!normalizedPageId) {
    return [];
  }

  const entries = changeLogEntriesAscending()
    .map((entry) => ({ generated_at: entry.generated_at, snapshot_file: normalize(entry.snapshot_file) }))
    .filter((entry) => entry.snapshot_file);
  const history = [];
  let previousProjectSignature = "";
  let previousClientSignature = "";
  let isFirstSeen = true;

  for (const entry of entries) {
    const payload = await loadSnapshotPayload(entry.snapshot_file).catch(() => null);
    const snapshotRow = (payload?.projects || []).find((row) => normalize(row?.page_id) === normalizedPageId);
    if (!snapshotRow) {
      continue;
    }

    const normalizedRow = normalizeProjectRow(snapshotRow);
    const projectStatus = statusLabel(normalizedRow.project_status);
    const clientStatus = statusLabel(normalizedRow.client_status);
    const projectNotes = normalize(normalizedRow.project_health);
    const clientNotes = normalize(normalizedRow.client_health);
    const projectSignature = [
      projectStatus,
      comparableHistoryNotes(projectStatus, projectNotes),
    ].join("||");
    const clientSignature = [
      clientStatus,
      comparableHistoryNotes(clientStatus, clientNotes),
    ].join("||");
    const projectChanged = projectSignature !== previousProjectSignature;
    const clientChanged = clientSignature !== previousClientSignature;

    if (!projectChanged && !clientChanged) {
      continue;
    }

    previousProjectSignature = projectSignature;
    previousClientSignature = clientSignature;
    history.push({
      generated_at: entry.generated_at || payload?.generated_at || "",
      is_added: isFirstSeen,
      project_changed: projectChanged,
      project_status: projectChanged ? projectStatus : "",
      project_health: projectChanged ? projectNotes : "",
      client_changed: clientChanged,
      client_status: clientChanged ? clientStatus : "",
      client_health: clientChanged ? clientNotes : "",
      project_full_signature: projectSignature,
      project_full_status: projectStatus,
      project_full_health: projectNotes,
      client_full_signature: clientSignature,
      client_full_status: clientStatus,
      client_full_health: clientNotes,
    });
    isFirstSeen = false;
  }

  const groupedHistory = [];
  history.forEach((entry) => {
    const parsed = Date.parse(entry.generated_at || "");
    const dayKey = Number.isNaN(parsed)
      ? normalize(entry.generated_at).slice(0, 10)
      : new Date(parsed).toISOString().slice(0, 10);
    const previous = groupedHistory[groupedHistory.length - 1];

    if (previous && previous.day_key === dayKey) {
      previous.generated_at = entry.generated_at || previous.generated_at;
      previous.project_full_signature = entry.project_full_signature;
      previous.project_full_status = entry.project_full_status;
      previous.project_full_health = entry.project_full_health;
      previous.client_full_signature = entry.client_full_signature;
      previous.client_full_status = entry.client_full_status;
      previous.client_full_health = entry.client_full_health;
      if (entry.project_changed) {
        previous.project_changed = true;
        previous.project_status = entry.project_status;
        previous.project_health = entry.project_health;
      }
      if (entry.client_changed) {
        previous.client_changed = true;
        previous.client_status = entry.client_status;
        previous.client_health = entry.client_health;
      }
      return;
    }

    groupedHistory.push({
      ...entry,
      day_key: dayKey,
    });
  });

  const dedupedHistory = [];
  let lastVisibleProjectSignature = "";
  let lastVisibleClientSignature = "";

  groupedHistory.forEach((entry) => {
    const projectChanged = entry.project_full_signature !== lastVisibleProjectSignature;
    const clientChanged = entry.client_full_signature !== lastVisibleClientSignature;

    if (!entry.is_added && !projectChanged && !clientChanged) {
      return;
    }

    dedupedHistory.push({
      ...entry,
      project_changed: projectChanged,
      project_status: projectChanged ? entry.project_full_status : "",
      project_health: projectChanged ? entry.project_full_health : "",
      client_changed: clientChanged,
      client_status: clientChanged ? entry.client_full_status : "",
      client_health: clientChanged ? entry.client_full_health : "",
    });

    lastVisibleProjectSignature = entry.project_full_signature;
    lastVisibleClientSignature = entry.client_full_signature;
  });

  state.noteHistoryCache[normalizedPageId] = dedupedHistory;
  return dedupedHistory;
}

function ensureProjectHistoryModal() {
  let modal = document.getElementById("projectHistoryModal");
  if (modal) {
    return modal;
  }

  modal = document.createElement("div");
  modal.id = "projectHistoryModal";
  modal.className = "project-history-modal project-history-hidden";
  document.body.appendChild(modal);
  return modal;
}

function closeProjectHistoryModal() {
  const modal = document.getElementById("projectHistoryModal");
  if (!modal) {
    return;
  }
  modal.classList.add("project-history-hidden");
  modal.innerHTML = "";
}

async function openProjectHistoryModal(trigger) {
  const pageId = normalize(trigger.dataset.pageId);
  const projectTitle = normalize(trigger.dataset.projectTitle);
  if (!pageId) {
    return;
  }

  const modal = ensureProjectHistoryModal();
  modal.innerHTML = `
    <div class="project-history-backdrop" data-project-history-close="true"></div>
    <div class="project-history-card">
      <div class="project-history-head">
        <div>
          <h3>${escapeHtml(projectTitle || "Project Note History")}</h3>
          <p>Loading note history from saved dashboard snapshots...</p>
        </div>
        <button type="button" class="action-button action-button-secondary project-history-close" data-project-history-close="true">Close</button>
      </div>
    </div>
  `;
  modal.classList.remove("project-history-hidden");

  const history = await buildProjectNoteHistory(pageId).catch(() => []);
  const rowsHtml = history.length
    ? history.slice().reverse().map((entry) => `
        <article class="project-history-entry">
          <div class="project-history-date">${escapeHtml(formatTimestamp(entry.generated_at))}${entry.is_added ? " | Added" : ""}</div>
          <div class="project-history-grid">
            ${entry.project_changed ? `
              <div class="project-history-section">
                <div class="project-history-label">Project Health</div>
                <div>${healthCellHtml(entry.project_status, entry.project_health)}</div>
              </div>
            ` : ""}
            ${entry.client_changed ? `
              <div class="project-history-section">
                <div class="project-history-label">Client Health</div>
                <div>${healthCellHtml(entry.client_status, entry.client_health)}</div>
              </div>
            ` : ""}
          </div>
        </article>
      `).join("")
    : '<p class="empty">No saved note history found for this project yet.</p>';

  modal.innerHTML = `
    <div class="project-history-backdrop" data-project-history-close="true"></div>
    <div class="project-history-card">
      <div class="project-history-head">
        <div>
          <h3>${escapeHtml(projectTitle || "Project Note History")}</h3>
          <p>${history.length} saved note snapshot${history.length === 1 ? "" : "s"} with note or status changes.</p>
        </div>
        <button type="button" class="action-button action-button-secondary project-history-close" data-project-history-close="true">Close</button>
      </div>
      <div class="project-history-body">${rowsHtml}</div>
    </div>
  `;
}

async function activateMonthChangeReport(monthKey) {
  const normalized = normalize(monthKey);
  if (!normalized) {
    state.activeChangeMonthKey = "";
    state.changes = state.changeMonths.length
      ? await buildMonthDisplayChanges(state.changeMonths[0], state.changesReport)
      : flattenChanges(state.changesReport);
    syncChangeFilterOptions();
    applyFilters();
    return;
  }

  const monthEntry = state.changeMonths.find((row) => normalize(row.month_key) === normalized);
  if (!monthEntry) {
    return;
  }

  const report = await ensureMonthlyChangeReport(monthEntry);
  state.activeChangeMonthKey = normalized;
  state.changes = await buildMonthDisplayChanges(monthEntry, report);
  syncChangeFilterOptions();
  applyFilters();
}

function ensureStatusEditorMenu() {
  let menu = document.getElementById("statusEditorMenu");
  if (menu) {
    return menu;
  }

  menu = document.createElement("div");
  menu.id = "statusEditorMenu";
  menu.className = "status-editor-menu status-editor-hidden";
  document.body.appendChild(menu);
  return menu;
}

function closeStatusEditorMenu() {
  const menu = document.getElementById("statusEditorMenu");
  if (!menu) {
    return;
  }
  menu.classList.add("status-editor-hidden");
  menu.innerHTML = "";
  state.server.menuOpenFor = "";
}

function openStatusEditorMenu(trigger) {
  const pageId = normalize(trigger.dataset.pageId);
  const currentStatus = statusLabel(trigger.dataset.currentStatus);
  const projectTitle = normalize(trigger.dataset.projectTitle);
  const menu = ensureStatusEditorMenu();
  const options = state.server.statusOptions || [];

  menu.innerHTML = `
    <div class="status-editor-card">
      <div class="status-editor-title">${escapeHtml(projectTitle || "Update Project Status")}</div>
      <div class="status-editor-actions">
        ${options.map((option) => `
          <button
            type="button"
            class="status-editor-option ${option === currentStatus ? "is-active" : ""}"
            data-status-option="${escapeHtml(option)}"
            data-page-id="${escapeHtml(pageId)}"
          >${escapeHtml(option)}</button>
        `).join("")}
      </div>
      <div class="status-editor-footer">
        <button
          type="button"
          class="action-button action-button-secondary status-editor-cancel"
          data-status-cancel="true"
        >Cancel</button>
        <button
          type="button"
          class="action-button status-editor-save"
          data-status-save="true"
          data-page-id="${escapeHtml(pageId)}"
          data-current-status="${escapeHtml(currentStatus)}"
          disabled
        >Save Status</button>
      </div>
    </div>
  `;

  const rect = trigger.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 8}px`;
  menu.style.left = `${Math.max(16, rect.left + window.scrollX)}px`;
  menu.classList.remove("status-editor-hidden");
  state.server.menuOpenFor = pageId;
}

async function updateProjectStatus(pageId, newStatus) {
  const response = await fetch("/api/project-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      page_id: pageId,
      status: newStatus,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Update failed (${response.status})`);
  }

  const project = state.projects.find((row) => normalize(row.page_id) === normalize(pageId));
  if (project) {
    project.project_status = payload.project_status || newStatus;
    project.project_health = payload.project_health || project.project_health;
    project.last_modified = payload.last_modified || project.last_modified;
  }

  if (payload.warning) {
    console.warn(payload.warning);
  }

  applyFilters();
}

function handleStatusEditorSelection(button) {
  const newStatus = statusLabel(button.dataset.statusOption);
  const menu = document.getElementById("statusEditorMenu");
  if (!menu || !newStatus) {
    return;
  }

  menu.querySelectorAll("[data-status-option]").forEach((optionButton) => {
    optionButton.classList.toggle("is-active", optionButton === button);
  });

  const saveButton = menu.querySelector("[data-status-save='true']");
  if (saveButton) {
    saveButton.dataset.selectedStatus = newStatus;
    saveButton.disabled = newStatus === statusLabel(saveButton.dataset.currentStatus);
  }
}

async function handleStatusEditorSave(button) {
  const pageId = normalize(button.dataset.pageId);
  const newStatus = statusLabel(button.dataset.selectedStatus);
  if (!pageId || !newStatus) {
    return;
  }

  const menu = document.getElementById("statusEditorMenu");
  if (menu) {
    menu.classList.add("status-editor-busy");
  }

  try {
    await updateProjectStatus(pageId, newStatus);
    closeStatusEditorMenu();
  } catch (error) {
    window.alert(error.message || "Project status update failed.");
    if (menu) {
      menu.classList.remove("status-editor-busy");
    }
  }
}

function downloadCsv() {
  const mode = dashboardMode();
  const exportRows = mode === "changes" ? state.filteredChanges : state.filtered;
  if (!exportRows.length) {
    return;
  }

  const rows = mode === "go-lives"
    ? exportRows.map((row) => ({
        Project: row.title || "",
        "Go Live": formatGoLiveDate(row.go_live),
        PM: canonicalPersonName(row.project_manager),
        IM: canonicalPersonName(row.implementation_manager),
        State: projectState(row),
        Year: goLiveYear(row.go_live),
      }))
    : mode === "changes"
      ? exportRows.map((row) => ({
          "Change Date": formatTimestamp(row.changed_at),
          Type: row.type,
          Project: row.title || "",
          "Changed Fields": row.changedFields.map((field) => fieldLabel(field)).join(" | "),
          Details: row.changes.map((change) => `${fieldLabel(change.field)}: ${normalize(change.before) || "Empty"} -> ${normalize(change.after) || "Empty"}`).join(" || ") || row.detailText,
        }))
    : state.filtered.map((row) => {
        const riskLevel = calculateRiskLevel(row);
        const riskCategories = getProjectRiskCategories(row);
        const goLiveDate = parseGoLiveDate(row.go_live);
        const now = new Date();
        const daysUntil = goLiveDate ? Math.floor((goLiveDate - now) / (1000 * 60 * 60 * 24)) : null;

        return {
          Project: row.title || "",
          Status: statusLabel(row.project_status),
          "Client Status": statusLabel(row.client_status),
          "Risk Level": riskLevel,
          "Risk Categories": riskCategories.map(c => c.label).join(" | "),
          "Days to Go-Live": daysUntil !== null ? daysUntil : "TBD",
          "Project Health Notes": normalize(row.project_health),
          "Client Health Notes": normalize(row.client_health),
          "Go Live": formatGoLiveDate(row.go_live),
          Start: formatStartDate(row.implementation_start_date),
          PM: canonicalPersonName(row.project_manager),
          IM: canonicalPersonName(row.implementation_manager),
          Version: normalize(row.epl_version),
          State: projectState(row),
          Modules: normalizeList(row.contracted_products).join(" | "),
        };
      });

  const headers = Object.keys(rows[0]);
  const escapeCell = (value) => `"${String(value || "").replace(/"/g, '""')}"`;
  const csv = [headers.join(",")]
    .concat(rows.map((row) => headers.map((header) => escapeCell(row[header])).join(",")))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = mode === "go-lives"
    ? "closed-project-go-lives.csv"
    : mode === "changes"
      ? "project-changes.csv"
      : mode === "risk"
        ? "project-risk-list.csv"
        : "project-dashboard.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bindControls() {
  ["searchInput", "statusFilter", "imFilter", "pmFilter", "yearFilter", "stateFilter", "startYearFilter", "changeTypeFilter", "fieldFilter", "groupChangesToggle", "atRiskOnlyToggle", "riskLevelFilter", "riskCategoryFilter", "daysToGoLiveFilter"].forEach((id) => {
    const element = document.getElementById(id);
    if (!element) {
      return;
    }
    element.addEventListener("input", applyFilters);
    element.addEventListener("change", applyFilters);
  });

  const atRiskOnlyToggle = document.getElementById("atRiskOnlyToggle");
  if (atRiskOnlyToggle) {
    atRiskOnlyToggle.addEventListener("change", () => {
      state.attentionFilters.atRiskOnly = !!atRiskOnlyToggle.checked;
      if (!atRiskOnlyToggle.checked) {
        state.attentionFilters.reason = "";
      }
      applyFilters();
    });
  }

  const exportButton = document.getElementById("exportButton");
  if (exportButton) {
    exportButton.addEventListener("click", downloadCsv);
  }

  const refreshGoLivesButton = document.getElementById("refreshGoLivesButton");
  if (refreshGoLivesButton) {
    refreshGoLivesButton.addEventListener("click", () => {
      refreshGoLivesData().catch((error) => {
        window.alert(error.message || "Go-Lives refresh failed.");
      });
    });
  }

  const showLatestButton = document.getElementById("showLatestChangesButton");
  if (showLatestButton) {
    showLatestButton.addEventListener("click", () => {
      activateMonthChangeReport("");
    });
  }

  const closeRemainingGoLivesButton = document.getElementById("closeRemainingGoLivesButton");
  if (closeRemainingGoLivesButton) {
    closeRemainingGoLivesButton.addEventListener("click", () => {
      state.goLivesDetail.mode = "";
      renderGoLivesDrilldown();
    });
  }

  const moduleTrigger = document.getElementById("moduleFilterTrigger");
  if (moduleTrigger) {
    moduleTrigger.addEventListener("click", () => {
      const isOpen = moduleTrigger.getAttribute("aria-expanded") === "true";
      setModuleFilterOpen(!isOpen);
    });
  }

  document.querySelectorAll("table thead th[data-sort-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const table = th.closest("table");
      if (!table) {
        return;
      }
      const mode = table.id === "changesTable" ? "changes" : table.id === "historyTable" ? "history" : dashboardMode();
      setSort(mode, th.dataset.sortKey);
      if (mode === "changes") {
        renderChangesTable(state.filteredChanges);
      } else if (mode === "history") {
        renderChangeHistory();
      } else {
        renderTable(state.filtered);
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (!event.target.closest("#moduleFilter")) {
      setModuleFilterOpen(false);
    }

    const historyRow = event.target.closest("#historyTable tbody tr[data-month-key]");
    if (historyRow) {
      event.preventDefault();
      activateMonthChangeReport(historyRow.dataset.monthKey);
      return;
    }

    const editorTrigger = event.target.closest("[data-status-editor='project']");
    if (editorTrigger) {
      event.preventDefault();
      openStatusEditorMenu(editorTrigger);
      return;
    }

    const projectHistoryButton = event.target.closest("[data-project-history='true']");
    if (projectHistoryButton) {
      event.preventDefault();
      openProjectHistoryModal(projectHistoryButton);
      return;
    }

    const projectHistoryClose = event.target.closest("[data-project-history-close='true']");
    if (projectHistoryClose) {
      event.preventDefault();
      closeProjectHistoryModal();
      return;
    }

    const optionButton = event.target.closest("[data-status-option]");
    if (optionButton) {
      event.preventDefault();
      handleStatusEditorSelection(optionButton);
      return;
    }

    const saveButton = event.target.closest("[data-status-save='true']");
    if (saveButton) {
      event.preventDefault();
      handleStatusEditorSave(saveButton);
      return;
    }

    const cancelButton = event.target.closest("[data-status-cancel='true']");
    if (cancelButton) {
      event.preventDefault();
      closeStatusEditorMenu();
      return;
    }

    if (!event.target.closest("#statusEditorMenu")) {
      closeStatusEditorMenu();
    }
  });
}

async function init() {
  bindControls();
  const serverConfig = await loadServerConfig();
  state.server.projectStatusEditable = !!serverConfig.project_status_editable;
  if (Array.isArray(serverConfig.status_options) && serverConfig.status_options.length) {
    state.server.statusOptions = serverConfig.status_options.map((option) => statusLabel(option));
  }

  try {
    if (window.PROJECT_CHANGE_LOG_DATA && Array.isArray(window.PROJECT_CHANGE_LOG_DATA)) {
      state.changeLog = window.PROJECT_CHANGE_LOG_DATA;
    }

    if (dashboardMode() === "changes") {
      const { report, log } = await loadChangesData();
      state.changeLog = log;
      state.changeMonths = buildMonthlyChangeHistory(log);

      if (state.changeMonths.length) {
        await ensureMonthlyChangeReports(state.changeMonths);
        const latestMonth = state.changeMonths[0];
        state.activeChangeMonthKey = "";
        state.changesReport = state.snapshotChangeReports[`month:${normalize(latestMonth.month_key)}`] || report;
        state.changes = await buildMonthDisplayChanges(latestMonth, state.changesReport);
      } else {
        state.changesReport = report;
        state.changes = flattenChanges(report);
      }

      const stampValue = state.changesReport?.generated_at || report?.generated_at || log[log.length - 1]?.generated_at || "";
      document.getElementById("stamp").textContent = stampValue
        ? `Last generated: ${formatTimestamp(stampValue)}`
        : "Change history loaded.";

      syncChangeFilterOptions();

      applyFilters();
      return;
    }

    await loadActiveProjectsForGoLives();
    const payload = await loadData();
    state.source = payload.source || state.source;
    if (window.PROJECT_CHANGES_DATA) {
      state.changesReport = window.PROJECT_CHANGES_DATA;
      state.changes = flattenChanges(window.PROJECT_CHANGES_DATA);
    }
    state.projects = (payload.projects || [])
      .map((row) => normalizeProjectRow(row))
      .filter((row) => !isTemplateTitle(row.title));

    document.getElementById("stamp").textContent = payload.generated_at
      ? `Last generated: ${formatTimestamp(payload.generated_at)}`
      : "Dataset loaded.";

    populateSelect("statusFilter", statusFilterOptions(state.projects));
    syncPeopleFilters();

    const yearFilter = document.getElementById("yearFilter");
    if (yearFilter) {
      const availableYears = goLivesAvailableYears();
      populateYearFilter(availableYears);
      if (dashboardMode() === "go-lives" && availableYears.includes("2026")) {
        yearFilter.value = "2026";
      }
    }

    const stateFilter = document.getElementById("stateFilter");
    if (stateFilter) {
      populateSelect("stateFilter", uniqueSorted(state.projects.map((row) => projectState(row))));
    }

    const moduleFilter = document.getElementById("moduleFilter");
    if (moduleFilter) {
      renderModuleFilter(uniqueSorted(state.projects.flatMap((row) => normalizeList(row.contracted_products))));
      updateModuleFilterTrigger();
    }

    const startYearFilter = document.getElementById("startYearFilter");
    if (startYearFilter) {
      populateSelect("startYearFilter", uniqueSorted(state.projects.map((row) => implementationStartYear(row.implementation_start_date))));
    }

    state.issueHistoryComparison = await buildLatestMonthlyIssueComparison(state.changeLog).catch(() => null);

    applyFilters();

    // Dispatch event for custom dashboard pages
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent('dashboardReady', { detail: { state } }));
    }
  } catch (error) {
    document.getElementById("stamp").textContent = `Dashboard data not loaded: ${error.message}`;
    renderMetrics([]);
    if (dashboardMode() === "changes") {
      renderChangesDataNote();
      renderChangesTable([]);
      renderChangeHistory();
    } else {
      renderTable([]);
    }
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  init();
}
