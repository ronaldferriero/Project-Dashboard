function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      value += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(value);
      value = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      continue;
    }
    value += ch;
  }
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const out = {};
    headers.forEach((h, idx) => {
      out[h] = (r[idx] || "").trim();
    });
    return out;
  });
}

const DASHBOARD_STATE = {
  statusRows: [],
  allProjectsRows: [],
  goLiveYearRows: [],
  goLiveStateRows: [],
  goLiveStateDetailRows: [],
  pieDrillRows: [],
  closureRows: [],
  changeRows: [],
  dataQualityRows: [],
  manualAuditRows: [],
};
const RYG_TREND_START_MONTH = "2026-01";
const MANUAL_OVERRIDES_KEY = "project_dashboard_manual_overrides_v1";
const MANUAL_AUDIT_KEY = "project_dashboard_manual_audit_v1";
const MANUAL_EDITS_API_BASE = "/api/manual-edits";
let REMOTE_MANUAL_OVERRIDES = null;
let REMOTE_MANUAL_AUDIT = null;
const ROOT_CAUSE_OPTIONS = [
  "Budget",
  "Client - Hold",
  "Client - Lack of engagement",
  "Client - legal/legislation",
  "Client - workload/resource issues",
  "Conversion",
  "GIS",
  "Integrations",
  "Other",
  "Other Tyler product",
  "Payments",
  "Reports",
  "Scope",
  "Tyler - Resources",
  "Tyler - Rework",
  "Tyler - Software Issues/development",
].sort((a, b) => a.localeCompare(b));

function csvEscape(value) {
  const v = String(value ?? "");
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function exportRowsToCsv(filename, headers, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((h) => csvEscape(row[h] || "")).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function bindExportButton(id, filename, headers, rowsGetter) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener("click", () => {
    const rows = rowsGetter();
    exportRowsToCsv(filename, headers, rows);
  });
}

function getPageFlags() {
  return {
    home: !!document.getElementById("homeCards"),
    projects: !!document.getElementById("projectSelect"),
    allProjects: !!document.getElementById("allProjectsTable"),
    goLiveYear: !!document.getElementById("goLiveYearSelect"),
    goLiveState: !!document.getElementById("goLiveStateYearA"),
    changes: !!document.getElementById("changesTable"),
    dataQuality: !!document.getElementById("dataQualityIssueFilter") || !!document.getElementById("dataQualityTable"),
  };
}

function getPageDataNeeds(flags) {
  return {
    needsStatusHistory: !!(flags.home || flags.projects || flags.allProjects || flags.goLiveYear || flags.changes || flags.dataQuality),
    needsClosedAllYears: !!(flags.home || flags.allProjects || flags.goLiveYear || flags.goLiveState),
    needsClosedCurrentYear: !!flags.home,
    needsManualEdits: !!(flags.home || flags.projects || flags.allProjects || flags.changes || flags.dataQuality || flags.goLiveYear),
  };
}

function setUrlParam(key, value) {
  const url = new URL(window.location.href);
  if (value === "" || value == null) {
    url.searchParams.delete(key);
  } else {
    url.searchParams.set(key, String(value));
  }
  window.history.replaceState({}, "", url);
}

function getUrlParam(key, fallback = "") {
  const url = new URL(window.location.href);
  return url.searchParams.get(key) || fallback;
}

function decodeQuotedPrintableUtf8(value) {
  const input = String(value || "");
  if (!/=([0-9A-F]{2})/i.test(input)) return input;
  try {
    const bytes = [];
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (ch === "=" && /^[0-9A-F]{2}$/i.test(input.slice(i + 1, i + 3))) {
        bytes.push(parseInt(input.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(ch.charCodeAt(0));
      }
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  } catch (_err) {
    return input;
  }
}

function cleanTextValue(value) {
  const normalized = String(value || "")
    .replace(/=\s+(?=[0-9A-F]{2})/gi, "=")
    .replace(/=\r?\n/g, "")
    .replace(/&nsbsp;/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/ /g, " ");
  return decodeQuotedPrintableUtf8(normalized)
    .replace(/([A-Za-z])=\s+(?=[A-Za-z])/g, "$1")
    .replace(/\s=\s+/g, " ")
    .replace(/=\s*\|/g, " |")
    .replace(/·/g, "•")
    .replace(/\s+\|/g, " |")
    .replace(/\|\s+/g, "| ")
    .replace(/\s+•/g, " •")
    .replace(/•\s+/g, "• ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([/(])\s+/g, "$1")
    .replace(/\s+\)/g, ")")
    .replace(/\bTylerhas\b/g, "Tyler has")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSegmentKey(value) {
  return cleanTextValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isLikelyDuplicateSegment(a, b) {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aWords = new Set(a.split(/\s+/).filter(Boolean));
  const bWords = new Set(b.split(/\s+/).filter(Boolean));
  if (!aWords.size || !bWords.size) return false;
  let overlap = 0;
  aWords.forEach((word) => {
    if (bWords.has(word)) overlap += 1;
  });
  const ratio = overlap / Math.min(aWords.size, bWords.size);
  return ratio >= 0.78;
}

function cleanNotesValue(value) {
  const cleaned = cleanTextValue(value);
  const segments = cleaned.split(/\s*\|\s*/).map((item) => item.trim()).filter(Boolean);
  const kept = [];
  const keys = [];
  segments.forEach((segment) => {
    const key = makeSegmentKey(segment);
    if (!key) return;
    if (keys.some((existing) => isLikelyDuplicateSegment(existing, key))) return;
    keys.push(key);
    kept.push(segment);
  });
  return kept.join(" | ");
}

function normalizeRowText(row) {
  const out = { ...row };
  Object.keys(out).forEach((key) => {
    if (typeof out[key] !== "string") return;
    out[key] = key === "notes" ? cleanNotesValue(out[key]) : cleanTextValue(out[key]);
  });
  return out;
}

async function loadStatusHistory() {
  if (Array.isArray(window.STATUS_HISTORY) && window.STATUS_HISTORY.length > 0) {
    return window.STATUS_HISTORY.map(normalizeRowText);
  }
  const candidates = [
    "./data/status_history.csv",
    "../dashboard/data/status_history.csv",
    "/dashboard/data/status_history.csv",
  ];
  let lastErr = null;
  for (const path of candidates) {
    try {
      const res = await fetch(path);
      if (!res.ok) {
        lastErr = new Error(`Failed to load ${path} (${res.status})`);
        continue;
      }
      return parseCsv(await res.text()).map(normalizeRowText);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Could not load status_history.csv");
}

async function loadClosedAllYears() {
  if (Array.isArray(window.CLOSED_PROJECTS_ALL_YEARS) && window.CLOSED_PROJECTS_ALL_YEARS.length > 0) {
    return window.CLOSED_PROJECTS_ALL_YEARS.map(normalizeRowText);
  }
  const candidates = [
    "./data/closed_projects_all_years.csv",
    "../dashboard/data/closed_projects_all_years.csv",
    "/dashboard/data/closed_projects_all_years.csv",
  ];
  for (const path of candidates) {
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      return parseCsv(await res.text()).map(normalizeRowText);
    } catch (_err) {
      // try next path
    }
  }
  return [];
}

async function loadClosedCurrentYear() {
  if (Array.isArray(window.CLOSED_PROJECTS_CURRENT_YEAR) && window.CLOSED_PROJECTS_CURRENT_YEAR.length > 0) {
    return window.CLOSED_PROJECTS_CURRENT_YEAR.map(normalizeRowText);
  }
  const candidates = [
    "./data/closed_projects_current_year.csv",
    "../dashboard/data/closed_projects_current_year.csv",
    "/dashboard/data/closed_projects_current_year.csv",
  ];
  for (const path of candidates) {
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      return parseCsv(await res.text()).map(normalizeRowText);
    } catch (_err) {
      // try next path
    }
  }
  return [];
}

function sortByMonthAsc(a, b) {
  return monthRank(a.month) - monthRank(b.month);
}

function getLatestMonth(data) {
  return data.reduce((max, row) => (monthRank(row.month) > monthRank(max) ? normalizeMonthValue(row.month) : max), "");
}

function normalizeMonthValue(value) {
  const v = String(value || "").trim();
  let m = v.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    const y = m[1];
    const mo = String(Number(m[2])).padStart(2, "0");
    return `${y}-${mo}`;
  }
  m = v.match(/^(\d{1,2})-(\d{2})$/);
  if (m) {
    const y = `20${m[2]}`;
    const mo = String(Number(m[1])).padStart(2, "0");
    return `${y}-${mo}`;
  }
  return v;
}

function monthRank(value) {
  const v = normalizeMonthValue(value);
  const m = v.match(/^(\d{4})-(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 100 + Number(m[2]);
}

function isTemplateProject(name) {
  return (name || "").toLowerCase().includes("template");
}

function isExcludedProject(name) {
  const n = (name || "").toLowerCase();
  return n.includes("fargo") || n.includes("bossier city");
}

function parseIsoDate(value) {
  const v = (value || "").trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const out = new Date(y, mo - 1, d);
    if (out.getFullYear() !== y || out.getMonth() !== mo - 1 || out.getDate() !== d) return null;
    return out;
  }
  m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const out = new Date(y, mo - 1, d);
  if (out.getFullYear() !== y || out.getMonth() !== mo - 1 || out.getDate() !== d) return null;
  return out;
}

function toIsoDateString(value) {
  const d = parseIsoDate(value);
  if (!d) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function toUsDateString(value) {
  const d = parseIsoDate(value);
  if (!d) return String(value || "").trim();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const y = d.getFullYear();
  return `${mo}/${day}/${y}`;
}

function formatDisplayDate(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const iso = toIsoDateString(v);
  return iso ? toUsDateString(iso) : v;
}

function formatDisplayDateTime(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDisplayValue(field, value) {
  if (["go_live_date", "original_go_live_date", "changed_go_live_date"].includes(field)) {
    return formatDisplayDate(value);
  }
  if (field === "updated_at" || field === "manual_updated_at" || field === "generated_at") {
    return formatDisplayDateTime(value);
  }
  return value || "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatRichText(value) {
  const escaped = escapeHtml(value || "");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/==(.+?)==/g, "<mark>$1</mark>")
    .replace(/\n/g, "<br>");
}

function setFormattedNoteContent(el, value) {
  if (!el) return;
  el.classList.add("formatted-note");
  el.innerHTML = formatRichText(formatDisplayValue("notes", value || ""));
}

function setRootCauseTagContent(el, value) {
  if (!el) return;
  const items = parseRootCauseValue(value);
  el.innerHTML = "";
  if (!items.length) {
    el.textContent = "";
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "root-cause-cell";
  items.forEach((item) => {
    const tag = document.createElement("span");
    tag.className = "root-cause-tag";
    tag.textContent = item;
    wrap.appendChild(tag);
  });
  el.appendChild(wrap);
}

function getStatusDisplayClass(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "red") return "status-red";
  if (s === "yellow") return "status-yellow";
  if (s === "green") return "status-green";
  if (s === "on hold") return "status-hold";
  if (s === "not started") return "status-not-started";
  if (s === "canceled") return "status-canceled";
  if (s === "in progress") return "status-in-progress";
  if (s === "completed") return "status-completed";
  return "";
}

function setStatusChangeContent(el, value) {
  if (!el) return;
  const raw = String(value || "").trim();
  if (!raw || raw === "No Change") {
    el.textContent = raw;
    return;
  }
  const parts = raw.split(/\s*->\s*/).map((item) => item.trim()).filter(Boolean);
  el.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "status-change-wrap";
  parts.forEach((part, idx) => {
    const pill = document.createElement("span");
    pill.className = `status-cell status-change-pill ${getStatusDisplayClass(part)}`.trim();
    pill.textContent = part;
    wrap.appendChild(pill);
    if (idx < parts.length - 1) {
      const arrow = document.createElement("span");
      arrow.className = "status-change-arrow";
      arrow.textContent = "->";
      wrap.appendChild(arrow);
    }
  });
  el.appendChild(wrap);
}

function wrapTextareaSelection(textarea, marker) {
  if (!textarea) return;
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const value = textarea.value || "";
  const selected = value.slice(start, end) || "text";
  const replacement = `${marker}${selected}${marker}`;
  textarea.value = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  textarea.focus();
  textarea.setSelectionRange(start + marker.length, start + marker.length + selected.length);
}

function parseRootCauseValue(value) {
  return String(value || "")
    .split("|")
    .map((item) => cleanTextValue(item))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .sort((a, b) => a.localeCompare(b));
}

function formatRootCauseValue(values) {
  return (Array.isArray(values) ? values : parseRootCauseValue(values)).join(" | ");
}

function setMultiSelectValues(selectEl, values) {
  if (!selectEl) return;
  const selected = new Set(Array.isArray(values) ? values : parseRootCauseValue(values));
  Array.from(selectEl.options).forEach((option) => {
    option.selected = selected.has(option.value);
  });
}

function getMultiSelectValues(selectEl) {
  if (!selectEl) return [];
  return Array.from(selectEl.selectedOptions || []).map((option) => option.value).sort((a, b) => a.localeCompare(b));
}

function isLocalhostOrigin() {
  const { protocol, hostname } = window.location;
  return protocol.startsWith("http") && (hostname === "localhost" || hostname === "127.0.0.1");
}

function mergeManualOverrides(primary = {}, secondary = {}) {
  const merged = { ...(secondary || {}), ...(primary || {}) };
  const normalized = new Map();
  Object.entries(merged).forEach(([project, value]) => {
    const key = normalizeProjectKey(project || "");
    if (!key || !value || typeof value !== "object") return;
    const current = normalized.get(key);
    const currentTs = Date.parse(current?.updated_at || "") || 0;
    const nextTs = Date.parse(value.updated_at || "") || 0;
    if (!current || nextTs >= currentTs) normalized.set(key, { project, value });
  });
  const out = {};
  normalized.forEach(({ project, value }) => {
    out[project] = value;
  });
  return out;
}

function mergeManualAudit(primary = [], secondary = []) {
  const seen = new Set();
  return ([]).concat(primary || [], secondary || []).filter((row) => {
    const key = [row.updated_at || "", row.project || "", row.field || "", row.new_value || "", row.source || ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (Date.parse(b.updated_at || "") || 0) - (Date.parse(a.updated_at || "") || 0));
}

async function fetchRemoteManualEdits() {
  if (!isLocalhostOrigin()) return { overrides: {}, audit: [] };
  try {
    const res = await fetch(`${MANUAL_EDITS_API_BASE}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    return {
      overrides: payload && payload.overrides && typeof payload.overrides === "object" ? payload.overrides : {},
      audit: Array.isArray(payload?.audit) ? payload.audit : [],
    };
  } catch (_err) {
    return { overrides: {}, audit: [] };
  }
}

async function persistRemoteManualEdits(overrides, audit) {
  if (!isLocalhostOrigin()) return;
  try {
    await fetch(`${MANUAL_EDITS_API_BASE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ overrides: overrides || {}, audit: audit || [] }),
    });
  } catch (_err) {
    // Keep localStorage as fallback when the local API is unavailable.
  }
}

async function loadManualEdits() {
  let localOverrides = {};
  let localAudit = [];
  try {
    const raw = localStorage.getItem(MANUAL_OVERRIDES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") localOverrides = parsed;
    }
  } catch (_err) {}
  try {
    const raw = localStorage.getItem(MANUAL_AUDIT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) localAudit = parsed;
    }
  } catch (_err) {}
  const fileOverrides = window.DASHBOARD_MANUAL_OVERRIDES && typeof window.DASHBOARD_MANUAL_OVERRIDES === "object"
    ? window.DASHBOARD_MANUAL_OVERRIDES
    : (window.DASHBOARD_MANUAL_EDITS?.overrides && typeof window.DASHBOARD_MANUAL_EDITS.overrides === "object"
      ? window.DASHBOARD_MANUAL_EDITS.overrides
      : {});
  const fileAudit = Array.isArray(window.DASHBOARD_MANUAL_AUDIT)
    ? window.DASHBOARD_MANUAL_AUDIT
    : (Array.isArray(window.DASHBOARD_MANUAL_EDITS?.audit)
      ? window.DASHBOARD_MANUAL_EDITS.audit
      : []);
  const remote = await fetchRemoteManualEdits();
  const mergedOverrides = mergeManualOverrides(localOverrides, mergeManualOverrides(remote.overrides, fileOverrides));
  const mergedAudit = mergeManualAudit(localAudit, mergeManualAudit(remote.audit, fileAudit)).slice(0, 1000);
  REMOTE_MANUAL_OVERRIDES = mergeManualOverrides(remote.overrides || {}, fileOverrides || {});
  REMOTE_MANUAL_AUDIT = mergeManualAudit(remote.audit || [], fileAudit || []).slice(0, 1000);
  localStorage.setItem(MANUAL_OVERRIDES_KEY, JSON.stringify(mergedOverrides));
  localStorage.setItem(MANUAL_AUDIT_KEY, JSON.stringify(mergedAudit));
  return { overrides: mergedOverrides, audit: mergedAudit };
}

function loadManualOverrides() {
  try {
    const raw = localStorage.getItem(MANUAL_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function saveManualOverrides(overrides) {
  const normalized = mergeManualOverrides(overrides || {}, REMOTE_MANUAL_OVERRIDES || {});
  localStorage.setItem(MANUAL_OVERRIDES_KEY, JSON.stringify(normalized));
  REMOTE_MANUAL_OVERRIDES = normalized;
  persistRemoteManualEdits(normalized, loadManualAudit());
}

function loadManualAudit() {
  try {
    const raw = localStorage.getItem(MANUAL_AUDIT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function saveManualAudit(rows) {
  const normalized = mergeManualAudit(rows || [], REMOTE_MANUAL_AUDIT || []).slice(0, 1000);
  localStorage.setItem(MANUAL_AUDIT_KEY, JSON.stringify(normalized));
  REMOTE_MANUAL_AUDIT = normalized;
  persistRemoteManualEdits(loadManualOverrides(), normalized);
}

function appendManualAudit(entry) {
  const rows = loadManualAudit();
  rows.unshift(entry);
  saveManualAudit(rows.slice(0, 1000));
}

function applyManualOverridesToData(data, overrides) {
  const byProjectLatestMonth = new Map();
  const byNormalizedProjectLatestMonth = new Map();
  data.forEach((r) => {
    const key = r.project || "";
    if (!key) return;
    const current = byProjectLatestMonth.get(key);
    if (!current || monthRank(r.month) > monthRank(current.month)) {
      byProjectLatestMonth.set(key, r);
    }
    const normalizedKey = normalizeProjectKey(key);
    if (!normalizedKey) return;
    const currentNormalized = byNormalizedProjectLatestMonth.get(normalizedKey);
    if (!currentNormalized || monthRank(r.month) > monthRank(currentNormalized.month)) {
      byNormalizedProjectLatestMonth.set(normalizedKey, r);
    }
  });

  Object.entries(overrides || {}).forEach(([project, ov]) => {
    const latest = byProjectLatestMonth.get(project) || byNormalizedProjectLatestMonth.get(normalizeProjectKey(project));
    if (!latest || !ov) return;
    if (ov.status) latest.status = ov.status;
    if (ov.client_status) latest.client_status = ov.client_status;
    if (ov.go_live_date) latest.go_live_date = ov.go_live_date;
    if (ov.project_manager) latest.project_manager = ov.project_manager;
    if (ov.im_manager) latest.im_manager = ov.im_manager;
    if (ov.root_cause) latest.root_cause = ov.root_cause;
    if (ov.notes) latest.notes = ov.notes;
    latest.manual_override = "Manual";
    latest.manual_updated_at = ov.updated_at || "";
  });
}

function getGoLiveYear(row) {
  const explicitYear = String((row?.year || row?.go_live_year || "")).trim();
  if (/^\d{4}$/.test(explicitYear)) return explicitYear;
  const d = parseIsoDate((row?.go_live_date || "").trim());
  return d ? String(d.getFullYear()) : "";
}

function normalizeProjectKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^\s*[a-z]\s*-\s+/, "")
    .replace(/&nbsp;/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function monthToDateStart(value) {
  const v = normalizeMonthValue(value);
  const m = v.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}

function dedupeProjectRows(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const projectKey = normalizeProjectKey(row.project || "");
    const goLiveKey = toIsoDateString(row.go_live_date || "") || String(row.go_live_date || "").trim();
    const key = `${projectKey}|${goLiveKey}`;
    if (!projectKey) return;
    const current = map.get(key);
    if (!current) {
      map.set(key, { ...row });
      return;
    }
    const score = (r) => [r.status, r.client_status, r.project_manager, r.im_manager, r.root_cause, r.notes]
      .filter((v) => String(v || "").trim() !== "")
      .length;
    const currentScore = score(current);
    const nextScore = score(row);
    if (nextScore > currentScore) {
      map.set(key, { ...row });
      return;
    }
    if (nextScore === currentScore) {
      map.set(key, {
        ...current,
        status: current.status || row.status || "",
        client_status: current.client_status || row.client_status || "",
        project_manager: current.project_manager || row.project_manager || "",
        im_manager: current.im_manager || row.im_manager || "",
        root_cause: current.root_cause || row.root_cause || "",
        notes: current.notes || row.notes || "",
        manual_override: current.manual_override || row.manual_override || "",
      });
    }
  });
  return [...map.values()];
}

function isPastGoLive(value) {
  const d = parseIsoDate(value);
  if (!d) return false;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return d.getTime() < todayStart.getTime();
}

function buildPreviousHistoryLookup(data) {
  const byProject = new Map();
  data.forEach((row) => {
    const project = row.project || "";
    if (!project) return;
    if (!byProject.has(project)) byProject.set(project, []);
    byProject.get(project).push(row);
  });

  const lookup = new Map();
  byProject.forEach((rows, project) => {
    const sorted = [...rows].sort(sortByMonthAsc);
    const latestMonth = sorted.length ? sorted[sorted.length - 1].month : "";
    const latestRank = monthRank(latestMonth);
    const prev = sorted
      .filter((r) => monthRank(r.month || "") < latestRank)
      .map((r) => ({
        month: r.month || "",
        status: r.status || "",
        root_cause: r.root_cause || "",
        notes: r.notes || "",
      }))
      .filter((r) => r.status || r.root_cause || r.notes);
    lookup.set(project, prev);
  });
  return lookup;
}

function makeHistoryToggle(project, historyRows) {
  const wrap = document.createElement("div");
  wrap.className = "history-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "history-toggle";
  btn.textContent = "View history";

  const panel = document.createElement("div");
  panel.className = "history-panel";
  panel.style.display = "none";

  historyRows.forEach((h) => {
    const row = document.createElement("div");
    row.className = "history-row";
    row.innerHTML = formatRichText(`${h.month}: ${h.status}${h.root_cause ? ` | Root Cause: ${h.root_cause}` : ""}${h.notes ? ` | ${h.notes}` : ""}`);
    panel.appendChild(row);
  });

  btn.addEventListener("click", () => {
    const open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "block";
    btn.textContent = open ? "View history" : "Hide history";
  });

  wrap.appendChild(btn);
  wrap.appendChild(panel);
  return wrap;
}

function renderTable(tableId, rows, previousHistoryLookup = new Map()) {
  const table = document.getElementById(tableId);
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  if (!rows.length) return;

  const headers = [
    "month",
    "status",
    "status_change_from_last_month",
    "go_live_date",
    "im_manager",
    "root_cause",
    "go_live_change_from_last_month",
    "notes",
  ];

  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = formatDisplayValue(h, r[h] || "");
      if (h === "status") {
        td.classList.add("status-cell");
        const s = (r[h] || "").toLowerCase();
        if (s === "red") td.classList.add("status-red");
        if (s === "yellow") td.classList.add("status-yellow");
        if (s === "green") td.classList.add("status-green");
        if (s === "on hold") td.classList.add("status-hold");
        if (s === "not started") td.classList.add("status-not-started");
        if (s === "canceled") td.classList.add("status-canceled");
        if (s === "in progress") td.classList.add("status-in-progress");
        if (s === "completed") td.classList.add("status-completed");
      }
      if (h === "notes") {
        td.classList.add("notes-cell");
        td.style.whiteSpace = "normal";
        const prev = previousHistoryLookup.get(r.project || "") || [];
        if (prev.length > 0) {
          td.appendChild(document.createElement("br"));
          td.appendChild(makeHistoryToggle(r.project || "", prev));
        }
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  DASHBOARD_STATE.statusRows = rows.map((r) => ({ ...r }));
}

function setProjectMetricCards(rows) {
  const el = document.getElementById("metricCards");
  if (!el) return;
  el.innerHTML = "";
  if (!rows.length) return;
  const latest = rows[rows.length - 1];
  const cards = [
    ["Latest Month", latest.month],
    ["Current Status", latest.status],
    ["Status Change", latest.status_change_from_last_month],
    ["Go-Live Change", latest.go_live_change_from_last_month],
  ];
  cards.forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "metric";
    card.innerHTML = `<h3>${label}</h3><p>${value || ""}</p>`;
    el.appendChild(card);
  });
}

function initProjectsPage(data, previousHistoryLookup) {
  const selector = document.getElementById("projectSelect");
  if (!selector) return;
  const projects = [...new Set(filterOutCanceledProjects(data).map((r) => r.project))].sort();
  selector.innerHTML = projects.map((p) => `<option value="${p}">${p}</option>`).join("");

  const render = (project) => {
    const rows = data.filter((r) => r.project === project).sort(sortByMonthAsc);
    const latest = rows.length ? [rows[rows.length - 1]] : [];
    setProjectMetricCards(latest);
    renderTable("statusTable", rows, previousHistoryLookup);
    setUrlParam("prj_project", project);
  };

  selector.addEventListener("change", (e) => render(e.target.value));
  const fromUrl = getUrlParam("prj_project", "");
  const initial = projects.includes(fromUrl) ? fromUrl : projects[0];
  if (initial) {
    selector.value = initial;
    render(initial);
  }
}

function toDateRank(v) {
  const t = (v || "").trim();
  if (!t) return Number.POSITIVE_INFINITY;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime();
}

function latestRowsByProject(data) {
  const map = new Map();
  data.forEach((row) => {
    const key = row.project || "";
    if (!key) return;
    const current = map.get(key);
    if (!current || (row.month || "") > (current.month || "")) {
      map.set(key, row);
    }
  });
  return [...map.values()];
}

function isCanceledStatus(value) {
  return String(value || "").trim().toLowerCase() === "canceled";
}

function buildCanceledProjectSet(data) {
  const set = new Set();
  latestRowsByProject(data || []).forEach((row) => {
    if (isCanceledStatus(row.status)) {
      set.add(row.project || "");
      set.add(normalizeProjectKey(row.project || ""));
    }
  });
  return set;
}

function filterOutCanceledProjects(data, canceledProjects = null) {
  const canceled = canceledProjects || buildCanceledProjectSet(data);
  return (data || []).filter((row) => !canceled.has(row.project || "") && !canceled.has(normalizeProjectKey(row.project || "")));
}

function filterToActiveProjects(data) {
  const latestRows = latestRowsByProject(data);
  const activeProjects = new Set(
    latestRows.filter((r) => !isCanceledStatus(r.status)).filter((r) => !isPastGoLive(r.go_live_date)).map((r) => r.project)
  );
  return data.filter((r) => activeProjects.has(r.project));
}

function renderAllProjectsSummary(rows, viewMode = "current") {
  const el = document.getElementById("allProjectsSummary");
  if (!el) return;
  const upcoming60 = rows.filter((r) => {
    const date = parseIsoDate(r.go_live_date || "");
    if (!date) return false;
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffDays = Math.round((date.getTime() - todayStart.getTime()) / 86400000);
    return diffDays >= 0 && diffDays <= 60;
  }).length;
  const redCount = rows.filter((r) => (r.status || "") === "Red").length;
  const yellowCount = rows.filter((r) => (r.status || "") === "Yellow").length;
  const missingManagerCount = rows.filter((r) => !(r.im_manager || "").trim() || !(r.project_manager || "").trim()).length;
  const summaryItems = [
    { title: "Visible Projects", value: rows.length, tone: "is-green", note: viewMode === "live" ? "Live client rows" : viewMode === "combined" ? "Current + live rows" : "Current active rows" },
    { title: "Red Status", value: redCount, tone: redCount ? "is-red" : "", note: "Project status only" },
    { title: "Yellow Status", value: yellowCount, tone: yellowCount ? "is-yellow" : "", note: "Project status only" },
    { title: "Upcoming 60 Days", value: upcoming60, tone: upcoming60 ? "is-not-started" : "", note: "By go-live date" },
    { title: "Missing IM / PM", value: missingManagerCount, tone: missingManagerCount ? "is-hold" : "", note: "Visible rows only" },
  ];
  el.innerHTML = summaryItems.map((item) => `
    <article class="metric ${item.tone}">
      <h3>${item.title}</h3>
      <p>${item.value}</p>
      <small>${item.note}</small>
    </article>
  `).join("");
}

function renderAllProjectsTable(rows, onHeaderSort, previousHistoryLookup = new Map(), onEdit = null, groupBy = "") {
  const getProjectState = (row) => extractStateFromProjectName(row.project || "");
  const getGroupLabel = (row) => {
    if (groupBy === "state") return getProjectState(row);
    if (groupBy === "im_manager") return (row.im_manager || "Unassigned").trim() || "Unassigned";
    if (groupBy === "project_manager") return (row.project_manager || "Unassigned").trim() || "Unassigned";
    return "";
  };
  const table = document.getElementById("allProjectsTable");
  if (!table) return;
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const headers = ["project", "state", "status", "client_status", "go_live_date", "project_manager", "im_manager", "notes", "root_cause", "manual_override"];
  const labels = {
    project: "Project",
    state: "State",
    status: "Project Status",
    client_status: "Client Status",
    go_live_date: "Go-Live Date",
    project_manager: "Project Manager",
    im_manager: "Implementation Manager",
    root_cause: "Root Cause",
    notes: "Notes",
    manual_override: "Manual",
  };

  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = labels[h] || h;
    if (["status", "go_live_date", "im_manager", "project_manager", "state"].includes(h)) {
      th.classList.add("th-sortable");
      th.title = "Click to sort";
      th.addEventListener("click", () => onHeaderSort(h));
    }
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = headers.length;
    td.className = "empty-state";
    td.textContent = "No projects match the current filters.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    DASHBOARD_STATE.allProjectsRows = [];
    return;
  }

  const groupCounts = new Map();
  if (groupBy) {
    rows.forEach((row) => {
      const label = getGroupLabel(row);
      groupCounts.set(label, (groupCounts.get(label) || 0) + 1);
    });
  }

  let currentGroup = "";
  rows.forEach((r) => {
    const rowGroup = getGroupLabel(r);
    if (groupBy && rowGroup !== currentGroup) {
      currentGroup = rowGroup;
      const groupTr = document.createElement("tr");
      groupTr.className = "group-row";
      const groupTd = document.createElement("td");
      groupTd.colSpan = headers.length;
      const count = groupCounts.get(currentGroup) || 0;
      groupTd.textContent = groupBy === "state" ? `${currentGroup} Projects (${count})` : `${currentGroup} (${count})`;
      groupTr.appendChild(groupTd);
      tbody.appendChild(groupTr);
    }
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      const value = h === "state" ? getProjectState(r) : (r[h] || "");
      if (h === "project" && onEdit) {
        const nameBtn = document.createElement("button");
        nameBtn.type = "button";
        nameBtn.className = "project-edit-link";
        nameBtn.textContent = r[h] || "";
        nameBtn.dataset.project = r.project || "";
        nameBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onEdit(r);
        });
        td.appendChild(nameBtn);
      } else if (h === "notes") {
        setFormattedNoteContent(td, value);
      } else if (h === "root_cause") {
        setRootCauseTagContent(td, value);
      } else {
        td.textContent = formatDisplayValue(h, value);
      }
      if (h === "status" || h === "client_status") {
        td.classList.add("status-cell");
        const s = (r[h] || "").toLowerCase();
        if (s === "red") td.classList.add("status-red");
        if (s === "yellow") td.classList.add("status-yellow");
        if (s === "green") td.classList.add("status-green");
        if (s === "on hold") td.classList.add("status-hold");
        if (s === "not started") td.classList.add("status-not-started");
        if (s === "canceled") td.classList.add("status-canceled");
        if (s === "in progress") td.classList.add("status-in-progress");
        if (s === "completed") td.classList.add("status-completed");
      }
      if (h === "notes") {
        td.classList.add("notes-cell");
        td.style.whiteSpace = "normal";
        const prev = previousHistoryLookup.get(r.project || "") || [];
        if (prev.length > 0) {
          td.appendChild(document.createElement("br"));
          td.appendChild(makeHistoryToggle(r.project || "", prev));
        }
      }
      if (h === "manual_override" && (r.manual_override || "") === "Manual") {
        td.classList.add("status-green");
      }
      tr.appendChild(td);
    });
    if (onEdit) {
      tr.addEventListener("dblclick", () => onEdit(r));
    }
    tbody.appendChild(tr);
  });
  DASHBOARD_STATE.allProjectsRows = rows.map((r) => ({ ...r, state: getProjectState(r) }));
}

function renderManualChangesTable() {
  const table = document.getElementById("manualChangesTable");
  if (!table) return;
  const rows = loadManualAudit();
  DASHBOARD_STATE.manualAuditRows = rows.map((r) => ({ ...r }));
  const headers = ["updated_at", "project", "field", "new_value", "source"];
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = formatDisplayValue(h, r[h] || "");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function initAllProjectsPage(data, previousHistoryLookup, closedAllYearsRows = []) {
  const sortBy = document.getElementById("sortBy");
  const sortDir = document.getElementById("sortDir");
  const filterState = document.getElementById("filterState");
  const filterStatus = document.getElementById("filterStatus");
  const filterImManager = document.getElementById("filterImManager");
  const filterProjectManager = document.getElementById("filterProjectManager");
  const searchProject = document.getElementById("searchProject");
  const viewMode = document.getElementById("viewMode");
  const groupBy = document.getElementById("groupBy");
  const resetBtn = document.getElementById("resetAllProjectsBtn");
  if (!sortBy || !sortDir || !filterState || !filterStatus || !filterImManager || !filterProjectManager || !searchProject || !viewMode || !groupBy) return;

  const statusRank = { Red: 1, Yellow: 2, "On Hold": 3, "Not Started": 4, "Canceled": 5, "In Progress": 6, Green: 7, Completed: 8, Unknown: 9 };
  const latestRows = latestRowsByProject(data).map((r) => ({ ...r }));
  const latestByProject = new Map(latestRows.map((r) => [r.project || "", r]));
  const latestByNormalizedProject = new Map();
  latestRows.forEach((r) => {
    const key = normalizeProjectKey(r.project || "");
    if (!key || latestByNormalizedProject.has(key)) return;
    latestByNormalizedProject.set(key, r);
  });
  const liveClientRowsRaw = [];
  const seenLive = new Set();
  (Array.isArray(closedAllYearsRows) ? closedAllYearsRows : []).forEach((r) => {
    const project = (r.project || "").trim();
    const goLiveDate = (r.go_live_date || "").trim();
    if (!project || !goLiveDate) return;
    const key = `${normalizeProjectKey(project)}|${toIsoDateString(goLiveDate) || goLiveDate}`;
    if (seenLive.has(key)) return;
    seenLive.add(key);
    const latest = latestByProject.get(project) || latestByNormalizedProject.get(normalizeProjectKey(project)) || {};
    liveClientRowsRaw.push({
      project,
      status: latest.status || "Live",
      client_status: latest.client_status || "Live",
      go_live_date: goLiveDate,
      project_manager: latest.project_manager || "",
      im_manager: latest.im_manager || "",
      root_cause: latest.root_cause || "",
      notes: latest.notes || "",
      manual_override: latest.manual_override || "",
    });
  });
  const liveClientRows = dedupeProjectRows(liveClientRowsRaw);
  const combinedRows = dedupeProjectRows([].concat(latestRows.map((r) => ({ ...r })), liveClientRows.map((r) => ({ ...r }))));
  const manualOverrides = loadManualOverrides();
  const modal = document.getElementById("editProjectModal");
  const titleEl = document.getElementById("editProjectTitle");
  const editStatus = document.getElementById("editStatus");
  const editClientStatus = document.getElementById("editClientStatus");
  const editGoLiveDate = document.getElementById("editGoLiveDate");
  const editProjectManager = document.getElementById("editProjectManager");
  const editImManager = document.getElementById("editImManager");
  const editRootCause = document.getElementById("editRootCause");
  const editNotes = document.getElementById("editNotes");
  const notesBoldBtn = document.getElementById("notesBoldBtn");
  const notesHighlightBtn = document.getElementById("notesHighlightBtn");
  const saveBtn = document.getElementById("saveProjectEditBtn");
  const cancelBtn = document.getElementById("cancelProjectEditBtn");
  let editingProject = "";

  const showModal = () => {
    if (modal) modal.style.display = "flex";
  };
  const hideModal = () => {
    if (modal) modal.style.display = "none";
    editingProject = "";
  };

  const fillSelect = (el, values, selected = "") => {
    if (!el) return;
    const previous = selected || el.value || "";
    el.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All";
    el.appendChild(allOption);
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      el.appendChild(option);
    });
    el.value = values.includes(previous) ? previous : "";
  };
  if (editRootCause) {
    editRootCause.innerHTML = ROOT_CAUSE_OPTIONS.map((item) => `<option value="${item}">${item}</option>`).join("");
  }
  const getBaseRows = () => {
    if (viewMode.value === "live") return liveClientRows;
    if (viewMode.value === "combined") return combinedRows;
    return latestRows;
  };
  const refreshFilterOptions = () => {
    const rows = getBaseRows();
    const selected = {
      state: filterState.value,
      status: filterStatus.value,
      im: filterImManager.value,
      pm: filterProjectManager.value,
    };
    fillSelect(filterState, [...new Set(rows.map((r) => extractStateFromProjectName(r.project || "")).filter(Boolean))].sort(), selected.state);
    fillSelect(filterStatus, [...new Set(rows.map((r) => r.status || "").filter(Boolean))].sort(), selected.status);
    fillSelect(filterImManager, [...new Set(rows.map((r) => (r.im_manager || "").trim()).filter(Boolean))].sort(), selected.im);
    fillSelect(filterProjectManager, [...new Set(rows.map((r) => (r.project_manager || "").trim()).filter(Boolean))].sort(), selected.pm);
  };
  refreshFilterOptions();

  const toggleSortFromHeader = (field) => {
    if (sortBy.value !== field) {
      sortBy.value = field;
      sortDir.value = "asc";
    } else {
      sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
    }
    applySort();
  };

  const openEdit = (row) => {
    if (!row || !modal) return;
    editingProject = row.project || "";
    if (titleEl) titleEl.textContent = `Edit Project: ${editingProject}`;
    if (editStatus) editStatus.value = row.status || "";
    if (editClientStatus) editClientStatus.value = row.client_status || "";
    if (editGoLiveDate) editGoLiveDate.value = toIsoDateString(row.go_live_date || "");
    if (editProjectManager) editProjectManager.value = row.project_manager || "";
    if (editImManager) editImManager.value = row.im_manager || "";
    if (editRootCause) setMultiSelectValues(editRootCause, row.root_cause || "");
    if (editNotes) editNotes.value = row.notes || "";
    showModal();
  };

  const allProjectsTable = document.getElementById("allProjectsTable");
  if (allProjectsTable && !allProjectsTable.dataset.editBound) {
    allProjectsTable.dataset.editBound = "1";
    allProjectsTable.addEventListener("click", (e) => {
      const btn = e.target.closest(".action-btn, .project-edit-link");
      if (!btn) return;
      e.preventDefault();
      const project = btn.dataset.project || "";
      const row = latestRows.find((r) => (r.project || "") === project);
      if (row) openEdit(row);
    });
  }

  const applySort = () => {
    const by = sortBy.value;
    const dir = sortDir.value === "desc" ? -1 : 1;
    const q = (searchProject.value || "").trim().toLowerCase();
    const rows = [...getBaseRows()]
      .filter((r) => !q || (r.project || "").toLowerCase().includes(q))
      .filter((r) => filterStatus.value === "Canceled" ? (r.status || "") === "Canceled" : (r.status || "") !== "Canceled")
      .filter((r) => !filterState.value || extractStateFromProjectName(r.project || "") === filterState.value)
      .filter((r) => !filterStatus.value || (r.status || "") === filterStatus.value)
      .filter((r) => !filterImManager.value || (r.im_manager || "").trim() === filterImManager.value)
      .filter((r) => !filterProjectManager.value || (r.project_manager || "").trim() === filterProjectManager.value)
      .sort((a, b) => {
      if (groupBy.value) {
        const groupValue = (row) => {
          if (groupBy.value === "state") return extractStateFromProjectName(row.project || "");
          if (groupBy.value === "im_manager") return (row.im_manager || "Unassigned").trim() || "Unassigned";
          if (groupBy.value === "project_manager") return (row.project_manager || "Unassigned").trim() || "Unassigned";
          return "";
        };
        const cmp = groupValue(a).localeCompare(groupValue(b));
        if (cmp !== 0) return cmp;
      }
      if (by === "status") {
        const av = statusRank[a.status] || 99;
        const bv = statusRank[b.status] || 99;
        if (av !== bv) return (av - bv) * dir;
        return (a.project || "").localeCompare(b.project || "") * dir;
      }
      if (by === "go_live_date") {
        const av = toDateRank(a.go_live_date);
        const bv = toDateRank(b.go_live_date);
        if (av !== bv) return (av - bv) * dir;
        return (a.project || "").localeCompare(b.project || "") * dir;
      }
      if (by === "im_manager") {
        return ((a.im_manager || "").localeCompare(b.im_manager || "") || (a.project || "").localeCompare(b.project || "")) * dir;
      }
      if (by === "project_manager") {
        return ((a.project_manager || "").localeCompare(b.project_manager || "") || (a.project || "").localeCompare(b.project || "")) * dir;
      }
      if (by === "state") {
        return (extractStateFromProjectName(a.project || "").localeCompare(extractStateFromProjectName(b.project || "")) || (a.project || "").localeCompare(b.project || "")) * dir;
      }
      return 0;
    });
    setUrlParam("ap_sort_by", sortBy.value);
    setUrlParam("ap_sort_dir", sortDir.value);
    setUrlParam("ap_state", filterState.value);
    setUrlParam("ap_status", filterStatus.value);
    setUrlParam("ap_im", filterImManager.value);
    setUrlParam("ap_pm", filterProjectManager.value);
    setUrlParam("ap_q", searchProject.value);
    setUrlParam("ap_view", viewMode.value);
    setUrlParam("ap_group", groupBy.value);
    renderAllProjectsSummary(rows, viewMode.value);
    renderAllProjectsTable(rows, toggleSortFromHeader, previousHistoryLookup, openEdit, groupBy.value);
  };

  sortBy.value = getUrlParam("ap_sort_by", "go_live_date");
  sortDir.value = getUrlParam("ap_sort_dir", "asc");
  searchProject.value = getUrlParam("ap_q", "");
  viewMode.value = getUrlParam("ap_view", "current");
  if (!["current", "live", "combined"].includes(viewMode.value)) viewMode.value = "current";
  groupBy.value = getUrlParam("ap_group", "");
  refreshFilterOptions();
  filterState.value = getUrlParam("ap_state", filterState.value);
  filterStatus.value = getUrlParam("ap_status", filterStatus.value);
  filterImManager.value = getUrlParam("ap_im", filterImManager.value);
  filterProjectManager.value = getUrlParam("ap_pm", filterProjectManager.value);
  sortBy.addEventListener("change", applySort);
  sortDir.addEventListener("change", applySort);
  filterState.addEventListener("change", applySort);
  filterStatus.addEventListener("change", applySort);
  filterImManager.addEventListener("change", applySort);
  filterProjectManager.addEventListener("change", applySort);
  searchProject.addEventListener("input", applySort);
  viewMode.addEventListener("change", () => {
    refreshFilterOptions();
    applySort();
  });
  groupBy.addEventListener("change", applySort);
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      sortBy.value = "go_live_date";
      sortDir.value = "asc";
      filterState.value = "";
      filterStatus.value = "";
      filterImManager.value = "";
      filterProjectManager.value = "";
      searchProject.value = "";
      viewMode.value = "current";
      groupBy.value = "";
      applySort();
    });
  }
  if (notesBoldBtn) notesBoldBtn.addEventListener("click", () => wrapTextareaSelection(editNotes, "**"));
  if (notesHighlightBtn) notesHighlightBtn.addEventListener("click", () => wrapTextareaSelection(editNotes, "=="));
  if (cancelBtn) cancelBtn.addEventListener("click", hideModal);
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) hideModal();
    });
  }
  window.addEventListener("pageshow", () => {
    window.requestAnimationFrame(() => {
      refreshFilterOptions();
      applySort();
    });
  });
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if (!editingProject) return;
      const row = latestRows.find((r) => (r.project || "") === editingProject);
      if (!row) return;
      const updates = {
        status: editStatus ? (editStatus.value || "").trim() : "",
        client_status: editClientStatus ? (editClientStatus.value || "").trim() : "",
        go_live_date: "",
        project_manager: editProjectManager ? (editProjectManager.value || "").trim() : "",
        im_manager: editImManager ? (editImManager.value || "").trim() : "",
        root_cause: formatRootCauseValue(getMultiSelectValues(editRootCause)),
        notes: editNotes ? (editNotes.value || "").trim() : "",
      };
      const goLiveRaw = editGoLiveDate ? (editGoLiveDate.value || "").trim() : "";
      if (goLiveRaw) {
        const goLiveIso = toIsoDateString(goLiveRaw);
        if (!goLiveIso) {
          window.alert("Invalid Go-Live date. Use YYYY-MM-DD or MM/DD/YYYY.");
          return;
        }
        updates.go_live_date = toUsDateString(goLiveIso);
      }

      const timestamp = new Date().toISOString();
      Object.keys(updates).forEach((field) => {
        const next = updates[field];
        if (next === "" || String(row[field] || "") === next) return;
        appendManualAudit({
          updated_at: timestamp,
          project: editingProject,
          field,
          old_value: row[field] || "",
          new_value: next,
          source: "manual dashboard edit",
        });
        row[field] = next;
      });
      row.manual_override = "Manual";
      row.manual_updated_at = timestamp;
      manualOverrides[editingProject] = {
        status: row.status || "",
        client_status: row.client_status || "",
        go_live_date: row.go_live_date || "",
        project_manager: row.project_manager || "",
        im_manager: row.im_manager || "",
        root_cause: row.root_cause || "",
        notes: row.notes || "",
        updated_at: timestamp,
      };
      saveManualOverrides(manualOverrides);
      hideModal();
      applySort();
    });
  }
  applySort();
}

function statusCountsByMonth(data) {
  const map = new Map();
  data.forEach((row) => {
    const month = row.month || "";
    if (!map.has(month)) {
      map.set(month, {
        month,
        Red: 0,
        Yellow: 0,
        Green: 0,
        "On Hold": 0,
        "Not Started": 0,
        "In Progress": 0,
        Completed: 0,
      });
    }
    const item = map.get(month);
    if (row.status === "Red") item.Red += 1;
    if (row.status === "Yellow") item.Yellow += 1;
    if (row.status === "Green") item.Green += 1;
    if (row.status === "On Hold") item["On Hold"] += 1;
    if (row.status === "Not Started") item["Not Started"] += 1;
    if (row.status === "In Progress") item["In Progress"] += 1;
    if (row.status === "Completed") item.Completed += 1;
  });
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function renderHomeCards(allData, currentMonthOverride = "") {
  const el = document.getElementById("homeCards");
  if (!el) return;
  el.innerHTML = "";
  const months = statusCountsByMonth(allData);
  if (!months.length) return;
  const latest =
    (currentMonthOverride && months.find((m) => m.month === currentMonthOverride)) ||
    months[months.length - 1];
  const prevCandidates = months.filter((m) => (m.month || "") < (latest.month || ""));
  const prev = prevCandidates.length
    ? prevCandidates[prevCandidates.length - 1]
    : { Red: 0, Yellow: 0, Green: 0, "On Hold": 0, "Not Started": 0 };
  const rows = [
    ["Red", latest.Red, latest.Red - prev.Red, "is-red"],
    ["Yellow", latest.Yellow, latest.Yellow - prev.Yellow, "is-yellow"],
    ["Green", latest.Green, latest.Green - prev.Green, "is-green"],
    ["On Hold", latest["On Hold"], latest["On Hold"] - prev["On Hold"], "is-hold"],
    ["Not Started", latest["Not Started"], latest["Not Started"] - prev["Not Started"], "is-not-started"],
    ["Current Month", latest.month, "", ""],
  ];
  rows.forEach(([label, value, delta, cls]) => {
    const card = document.createElement("article");
    card.className = `metric ${cls}`;
    if (["Red", "Yellow", "Green", "On Hold", "Not Started", "In Progress", "Completed"].includes(label)) {
      card.classList.add("clickable-metric");
      card.dataset.statusName = label;
      card.title = "Click to view project list";
    }
    const deltaText = delta === "" ? "" : `vs prev month: ${delta >= 0 ? "+" : ""}${delta}`;
    card.innerHTML = `<h3>${label}</h3><p>${value}</p><small>${deltaText}</small>`;
    el.appendChild(card);
  });
}

function buildChangesSummaryRows(data, latestMonth) {
  const months = [...new Set(data.map((r) => r.month || "").filter(Boolean))].sort();
  const prevMonth = months.filter((m) => m < latestMonth).slice(-1)[0] || "";
  if (!prevMonth) return [];
  const byProject = new Map();
  data.forEach((row) => {
    const project = row.project || "";
    if (!project) return;
    if (!byProject.has(project)) byProject.set(project, {});
    byProject.get(project)[row.month || ""] = row;
  });
  const rows = [];
  byProject.forEach((monthsMap, project) => {
    const current = monthsMap[latestMonth];
    const prev = monthsMap[prevMonth];
    if (!current || !prev) return;
    const statusChanged = (current.status || "") !== (prev.status || "");
    const goLiveChanged = (current.go_live_date || "") !== (prev.go_live_date || "");
    const notesChanged = (current.notes || "") !== (prev.notes || "");
    if (!statusChanged && !goLiveChanged && !notesChanged) return;
    rows.push({
      project,
      statusChanged,
      goLiveChanged,
      notesChanged,
    });
  });
  return rows;
}

function renderPortfolioKpis(allData, closedRows, latestMonth) {
  const el = document.getElementById("portfolioKpis");
  if (!el) return;
  const latestRows = latestRowsByProject(allData)
    .filter((r) => (r.month || "") === latestMonth)
    .filter((r) => !isCanceledStatus(r.status))
    .filter((r) => !isPastGoLive(r.go_live_date));
  const total = latestRows.length;
  const green = latestRows.filter((r) => (r.status || "") === "Green").length;
  const yellow = latestRows.filter((r) => (r.status || "") === "Yellow").length;
  const red = latestRows.filter((r) => (r.status || "") === "Red").length;
  const onHold = latestRows.filter((r) => (r.status || "") === "On Hold").length;
  const notStarted = latestRows.filter((r) => (r.status || "") === "Not Started").length;
  const today = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const upcoming30 = latestRows.filter((r) => {
    const d = parseIsoDate(r.go_live_date || "");
    if (!d) return false;
    const diff = Math.ceil((d.getTime() - today.getTime()) / msPerDay);
    return diff >= 0 && diff <= 30;
  }).length;
  const upcoming60 = latestRows.filter((r) => {
    const d = parseIsoDate(r.go_live_date || "");
    if (!d) return false;
    const diff = Math.ceil((d.getTime() - today.getTime()) / msPerDay);
    return diff >= 0 && diff <= 60;
  }).length;
  const upcoming90 = latestRows.filter((r) => {
    const d = parseIsoDate(r.go_live_date || "");
    if (!d) return false;
    const diff = Math.ceil((d.getTime() - today.getTime()) / msPerDay);
    return diff >= 0 && diff <= 90;
  }).length;
  const changes = buildChangesSummaryRows(allData, latestMonth);
  const cards = [
    ["Active Projects", total, `${green} green / ${yellow + red} at risk`, "is-green"],
    ["At Risk", yellow + red, `${red} red, ${yellow} yellow`, "is-red"],
    ["Upcoming 30 Days", upcoming30, "Near-term go-lives", "is-yellow"],
    ["Upcoming 60 Days", upcoming60, "Medium-term go-lives", "is-yellow"],
    ["Upcoming 90 Days", upcoming90, "Quarter look-ahead", "is-green"],
    ["YTD Closures", closedRows.length, "Closed projects this year", "is-green"],
    ["On Hold", onHold, `${notStarted} not started`, "is-hold"],
    ["Changes Since Last Refresh", changes.length, "Status, notes, or go-live changed", "is-not-started"],
  ];
  el.innerHTML = "";
  cards.forEach(([label, value, detail, cls]) => {
    const card = document.createElement("article");
    card.className = `metric ${cls}`;
    card.innerHTML = `<h3>${label}</h3><p>${value}</p><small>${detail}</small>`;
    el.appendChild(card);
  });
}

function drawBarChart(svgId, labels, values, color, titleSuffix = "") {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  svg.innerHTML = "";
  if (!labels.length) return;
  const w = 920;
  const h = 320;
  const m = { top: 20, right: 20, bottom: 80, left: 42 };
  const innerW = w - m.left - m.right;
  const innerH = h - m.top - m.bottom;
  const maxVal = Math.max(...values, 1);
  const barGap = 12;
  const barW = Math.max(18, (innerW - barGap * (labels.length - 1)) / labels.length);
  const mk = (name) => document.createElementNS("http://www.w3.org/2000/svg", name);
  const axis = mk("path");
  axis.setAttribute("d", `M ${m.left} ${m.top} L ${m.left} ${m.top + innerH} L ${m.left + innerW} ${m.top + innerH}`);
  axis.setAttribute("class", "axis");
  svg.appendChild(axis);
  labels.forEach((label, idx) => {
    const value = values[idx] || 0;
    const x = m.left + idx * (barW + barGap);
    const barH = (value / maxVal) * innerH;
    const y = m.top + innerH - barH;
    const rect = mk("rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", barW);
    rect.setAttribute("height", barH);
    rect.setAttribute("rx", 6);
    rect.setAttribute("fill", color);
    svg.appendChild(rect);
    const valueText = mk("text");
    valueText.setAttribute("x", x + barW / 2);
    valueText.setAttribute("y", y - 6);
    valueText.setAttribute("text-anchor", "middle");
    valueText.setAttribute("class", "tick");
    valueText.textContent = String(value);
    svg.appendChild(valueText);
    const labelText = mk("text");
    labelText.setAttribute("x", x + barW / 2);
    labelText.setAttribute("y", m.top + innerH + 16);
    labelText.setAttribute("text-anchor", "end");
    labelText.setAttribute("transform", `rotate(-35 ${x + barW / 2} ${m.top + innerH + 16})`);
    labelText.setAttribute("class", "tick");
    labelText.textContent = label;
    svg.appendChild(labelText);
  });
  const ttl = mk("text");
  ttl.setAttribute("x", m.left + innerW / 2);
  ttl.setAttribute("y", h - 10);
  ttl.setAttribute("text-anchor", "middle");
  ttl.setAttribute("fill", "#35556b");
  ttl.setAttribute("font-size", "12");
  ttl.textContent = titleSuffix;
  svg.appendChild(ttl);
}

function renderUpcomingGoLiveChart(allData, latestMonth) {
  const latestRows = latestRowsByProject(allData)
    .filter((r) => (r.month || "") === latestMonth)
    .filter((r) => !isCanceledStatus(r.status))
    .filter((r) => !isPastGoLive(r.go_live_date));
  const buckets = new Map();
  latestRows.forEach((r) => {
    const d = parseIsoDate(r.go_live_date || "");
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });
  const labels = [...buckets.keys()].sort().slice(0, 12);
  const values = labels.map((k) => buckets.get(k) || 0);
  drawBarChart("upcomingGoLiveChart", labels, values, "#0078a6", "Next 12 scheduled go-live months");
}

function renderManagerWorkloadCharts(allData, latestMonth) {
  const latestRows = latestRowsByProject(allData)
    .filter((r) => (r.month || "") === latestMonth)
    .filter((r) => !isCanceledStatus(r.status))
    .filter((r) => !isPastGoLive(r.go_live_date));
  const build = (field) => {
    const counts = new Map();
    latestRows.forEach((r) => {
      const key = (r[field] || "Unassigned").trim() || "Unassigned";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const pairs = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
    return {
      labels: pairs.map((p) => p[0]),
      values: pairs.map((p) => p[1]),
    };
  };
  const im = build("im_manager");
  const pm = build("project_manager");
  drawBarChart("imWorkloadChart", im.labels, im.values, "#00a3a1", "Top 10 implementation managers");
  drawBarChart("pmWorkloadChart", pm.labels, pm.values, "#174a7c", "Top 10 project managers");
}

function renderManagerStatusTable(allData, latestMonth) {
  const table = document.getElementById("managerStatusTable");
  if (!table) return;
  const latestRows = latestRowsByProject(allData)
    .filter((r) => (r.month || "") === latestMonth)
    .filter((r) => !isCanceledStatus(r.status))
    .filter((r) => !isPastGoLive(r.go_live_date));
  const map = new Map();
  latestRows.forEach((r) => {
    const key = (r.im_manager || "Unassigned").trim() || "Unassigned";
    if (!map.has(key)) {
      map.set(key, { manager: key, total: 0, red: 0, yellow: 0, green: 0, on_hold: 0, not_started: 0 });
    }
    const item = map.get(key);
    item.total += 1;
    const s = r.status || "";
    if (s === "Red") item.red += 1;
    if (s === "Yellow") item.yellow += 1;
    if (s === "Green") item.green += 1;
    if (s === "On Hold") item.on_hold += 1;
    if (s === "Not Started") item.not_started += 1;
  });
  const rows = [...map.values()].sort((a, b) => b.total - a.total || a.manager.localeCompare(b.manager));
  const headers = ["manager", "total", "red", "yellow", "green", "on_hold", "not_started"];
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = r[h] || 0;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderClosureCards(closedRows) {
  const el = document.getElementById("closureCards");
  if (!el) return;
  el.innerHTML = "";
  const currentYear = new Date().getFullYear();
  const total = closedRows.length;
  const card = document.createElement("article");
  card.className = "metric is-green";
  card.innerHTML = `<h3>Total Go-Live (${currentYear})</h3><p>${total}</p><small>Projects closed in ${currentYear}</small>`;
  el.appendChild(card);
}

function renderClosuresTable(rows) {
  const table = document.getElementById("closuresTable");
  if (!table) return;
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const headers = ["project", "go_live_date"];
  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = formatDisplayValue(h, r[h] || "");
      if (h === "status" || h === "client_status") {
        td.classList.add("status-cell");
        const s = (r[h] || "").toLowerCase();
        if (s === "red") td.classList.add("status-red");
        if (s === "yellow") td.classList.add("status-yellow");
        if (s === "green") td.classList.add("status-green");
        if (s === "on hold") td.classList.add("status-hold");
        if (s === "not started") td.classList.add("status-not-started");
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  DASHBOARD_STATE.closureRows = rows.map((r) => ({ ...r }));
}

function initClosuresPanel(closedRows) {
  const currentYear = new Date().getFullYear();
  renderClosureCards(closedRows);
  renderClosuresTable(closedRows);
  const btn = document.getElementById("showClosuresBtn");
  const wrap = document.getElementById("closuresWrap");
  if (!btn || !wrap) return;
  btn.addEventListener("click", () => {
    const open = wrap.style.display !== "none";
    wrap.style.display = open ? "none" : "block";
    btn.textContent = open ? `Show ${currentYear} Project Closures` : `Hide ${currentYear} Project Closures`;
  });
}

function renderLastRefreshStamp() {
  const el = document.getElementById("lastRefreshStamp");
  if (!el) return;
  const meta = window.DASHBOARD_METADATA || {};
  const when = meta.generated_at ? formatDisplayDateTime(meta.generated_at) : "Unknown";
  const src = meta.source_status_dir || "Unknown source";
  el.textContent = `Last refresh: ${when} | Source: ${src}`;
}

function renderStatusLegend() {
  const el = document.getElementById("statusLegend");
  if (!el) return;
  el.innerHTML = [
    "Red: at risk / blocked",
    "Yellow: caution / needs attention",
    "Green: on track",
    "On Hold: intentionally paused",
    "Not Started: approved but not active",
    "In Progress and Completed are treated as Green",
  ].map((x) => `<div>${x}</div>`).join("");
}

function renderExceptionsTable() {
  const table = document.getElementById("exceptionsTable");
  if (!table) return;
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const headers = ["project", "go_live_date"];
  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);
  const overrides = Array.isArray(window.DASHBOARD_METADATA?.manual_overrides) ? window.DASHBOARD_METADATA.manual_overrides : [];
  overrides.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = formatDisplayValue(h, r[h] || "");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function computeDataQuality(data, latestMonth) {
  const latestRows = data.filter((r) => (r.month || "") === latestMonth);
  const missingRows = latestRows.filter((r) => !(r.go_live_date || "").trim());
  const unknownRows = latestRows.filter((r) => (r.status || "") === "Unknown");
  const missingPmRows = latestRows.filter((r) => !(r.project_manager || "").trim());
  const missingImRows = latestRows.filter((r) => !(r.im_manager || "").trim());
  const invalidRows = latestRows.filter((r) => {
    const v = (r.go_live_date || "").trim();
    return v && !parseIsoDate(v);
  });
  const dec31Rows = latestRows.filter((r) => {
    const d = parseIsoDate((r.go_live_date || "").trim());
    return d && d.getMonth() === 11 && d.getDate() === 31;
  });
  const missingOrIncorrectRows = [];
  const seenBad = new Set();
  missingRows.concat(invalidRows).concat(dec31Rows).forEach((r) => {
    const key = `${r.project || ""}|${r.go_live_date || ""}`;
    if (seenBad.has(key)) return;
    seenBad.add(key);
    missingOrIncorrectRows.push(r);
  });
  const dupeProjects = (() => {
    const m = new Map();
    latestRows.forEach((r) => m.set(r.project, (m.get(r.project) || 0) + 1));
    return [...m.entries()].filter(([, n]) => n > 1).map(([p]) => p);
  })();
  const issues = []
    .concat(missingRows.map((r) => ({ project: r.project || "", issue: "Missing/Incorrect GL Date", detail: "Missing date" })))
    .concat(invalidRows.map((r) => ({ project: r.project || "", issue: "Missing/Incorrect GL Date", detail: `Invalid format: ${r.go_live_date || ""}` })))
    .concat(dec31Rows.map((r) => ({ project: r.project || "", issue: "Missing/Incorrect GL Date", detail: `12-31 placeholder: ${r.go_live_date || ""}` })))
    .concat(unknownRows.map((r) => ({ project: r.project || "", issue: "Unknown Status", detail: r.status || "" })))
    .concat(missingPmRows.map((r) => ({ project: r.project || "", issue: "Missing Project Manager", detail: "" })))
    .concat(missingImRows.map((r) => ({ project: r.project || "", issue: "Missing Implementation Manager", detail: "" })))
    .concat(dupeProjects.map((p) => ({ project: p || "", issue: "Duplicate Project", detail: "Multiple rows in latest month" })));
  return {
    summary: {
      missingIncorrectGoLive: missingOrIncorrectRows.length,
      unknownStatus: unknownRows.length,
      missingProjectManager: missingPmRows.length,
      missingImplementationManager: missingImRows.length,
      duplicateProjects: dupeProjects.length,
    },
    issues,
  };
}

function renderDataQualityPanel(data, latestMonth) {
  const el = document.getElementById("dataQualityCards");
  if (!el) return;
  const quality = computeDataQuality(data, latestMonth);
  const cards = [
    ["Missing/Incorrect GL Dates", quality.summary.missingIncorrectGoLive],
    ["Unknown Status", quality.summary.unknownStatus],
    ["Missing Project Manager", quality.summary.missingProjectManager],
    ["Missing Implementation Manager", quality.summary.missingImplementationManager],
    ["Duplicate Projects", quality.summary.duplicateProjects],
  ];
  el.innerHTML = "";
  cards.forEach(([k, v]) => {
    const card = document.createElement("article");
    card.className = "metric";
    card.innerHTML = `<h3>${k}</h3><p>${v}</p>`;
    el.appendChild(card);
  });
}

function renderDataQualityIssuesTable(data, latestMonth) {
  const table = document.getElementById("dataQualityIssuesTable");
  if (!table) return;
  const issueFilter = document.getElementById("dataQualityIssueFilter");
  const quality = computeDataQuality(data, latestMonth);
  if (issueFilter) {
    const issues = [...new Set(quality.issues.map((r) => r.issue).filter(Boolean))].sort();
    const existing = issueFilter.value || "";
    issueFilter.innerHTML = [`<option value="">All Issues</option>`]
      .concat(issues.map((i) => `<option value="${i}">${i}</option>`))
      .join("");
    issueFilter.value = issues.includes(existing) ? existing : "";
  }
  const selectedIssue = issueFilter ? (issueFilter.value || "") : "";
  const headers = ["project", "issue", "detail"];
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);
  quality.issues
    .filter((r) => !selectedIssue || (r.issue || "") === selectedIssue)
    .sort((a, b) => (a.project || "").localeCompare(b.project || "") || (a.issue || "").localeCompare(b.issue || ""))
    .forEach((r) => {
      const tr = document.createElement("tr");
      headers.forEach((h) => {
        const td = document.createElement("td");
        if (h === "project" && (r.project || "").trim()) {
          const link = document.createElement("a");
          link.href = `./all-projects.html?ap_q=${encodeURIComponent(r.project || "")}&ap_view=current`;
          link.className = "project-edit-link";
          link.textContent = r.project || "";
          td.appendChild(link);
        } else {
          if (h === "notes") {
          setFormattedNoteContent(td, r[h] || "");
        } else {
          td.textContent = formatDisplayValue(h, r[h] || "");
        }
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  DASHBOARD_STATE.dataQualityRows = quality.issues.filter((r) => !selectedIssue || (r.issue || "") === selectedIssue);
}

function renderChangesTable(data, latestMonth) {
  const table = document.getElementById("changesTable");
  if (!table) return;
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const byProject = new Map();
  data.forEach((r) => {
    const p = r.project || "";
    if (!p) return;
    if (!byProject.has(p)) byProject.set(p, []);
    byProject.get(p).push(r);
  });

  const rows = [];
  byProject.forEach((projectRows, project) => {
    const sorted = [...projectRows].sort(sortByMonthAsc);
    const current = sorted.find((r) => (r.month || "") === latestMonth);
    if (!current) return;
    const latestRank = monthRank(latestMonth);
    const prevCandidates = sorted.filter((r) => monthRank(r.month || "") < latestRank);
    const prev = prevCandidates.length ? prevCandidates[prevCandidates.length - 1] : null;
    if (!prev) return;

    const currentStatus = current.status || "";
    const prevStatus = prev.status || "";
    const currentGoLive = current.go_live_date || "";
    const prevGoLive = prev.go_live_date || "";
    const currentNotes = current.notes || "";
    const prevNotes = prev.notes || "";

    const statusChanged = currentStatus !== prevStatus;
    const goLiveChanged = currentGoLive !== prevGoLive;
    const notesChanged = currentNotes !== prevNotes;
    if (!statusChanged && !goLiveChanged && !notesChanged) return;

    rows.push({
      project,
      status_change: statusChanged ? `${prevStatus} -> ${currentStatus}` : "No Change",
      go_live_change: goLiveChanged ? `${formatDisplayDate(prevGoLive)} -> ${formatDisplayDate(currentGoLive)}` : "No Change",
      original_go_live_date: prevGoLive,
      changed_go_live_date: currentGoLive,
      notes_change: notesChanged ? `${prevNotes} -> ${currentNotes}` : "No Change",
      notes: currentNotes,
    });
  });

  rows.sort((a, b) => (a.project || "").localeCompare(b.project || ""));

  const headers = ["project", "status_change", "go_live_change", "original_go_live_date", "changed_go_live_date", "notes_change", "notes"];
  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      if (h === "status_change") {
        setStatusChangeContent(td, r[h] || "");
      } else if (h === "notes" || h === "notes_change") {
        setFormattedNoteContent(td, r[h] || "");
      } else {
        td.textContent = formatDisplayValue(h, r[h] || "");
      }
      if ((h === "status_change" || h === "go_live_change" || h === "notes_change") && (r[h] || "") !== "No Change") {
        td.classList.add("change-highlight");
      }
      if ((h === "original_go_live_date" || h === "changed_go_live_date") && (r.go_live_change || "") !== "No Change") {
        td.classList.add("change-highlight");
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  DASHBOARD_STATE.changeRows = rows;
}

function renderGoLiveYearCards(year, pastCount, pendingCount, avgTimelineDays = 0, avgTimelineCount = 0) {
  const el = document.getElementById("goLiveYearCards");
  if (!el) return;
  el.innerHTML = "";

  const yearCard = document.createElement("article");
  yearCard.className = "metric";
  yearCard.innerHTML = `<h3>Year</h3><p>${year}</p><small>Selected go-live year</small>`;
  el.appendChild(yearCard);

  const card = document.createElement("article");
  card.className = "metric is-green";
  card.innerHTML = `<h3>${year} Go-live Summary</h3><p>${pastCount} go-lives (past date)</p><small>${pendingCount} upcoming</small>`;
  el.appendChild(card);

  const avgCard = document.createElement("article");
  avgCard.className = "metric is-not-started";
  const avgMonths = avgTimelineDays > 0 ? (avgTimelineDays / 30.4).toFixed(1) : "0.0";
  avgCard.innerHTML = `<h3>Average Timeline</h3><p>${avgMonths} months</p><small>${avgTimelineCount} projects with tracked start and go-live</small>`;
  el.appendChild(avgCard);
}

function renderGoLiveYearTable(year, rows) {
  const title = document.getElementById("goLiveYearTableTitle");
  const table = document.getElementById("goLiveYearTable");
  if (!table) return;
  if (title) title.textContent = `Go-live Projects (${year})`;

  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const headers = ["project", "go_live_date", "type", "project_manager", "im_manager"];
  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = formatDisplayValue(h, r[h] || "");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  DASHBOARD_STATE.goLiveYearRows = rows.map((r) => ({ ...r }));
}

function initGoLiveYearPage(data, closedAllYearsRows = []) {
  const selector = document.getElementById("goLiveYearSelect");
  const search = document.getElementById("goLiveSearch");
  if (!selector || !search) return;

  const allRows = Array.isArray(closedAllYearsRows) && closedAllYearsRows.length
    ? closedAllYearsRows
    : (Array.isArray(window.CLOSED_PROJECTS_ALL_YEARS) ? window.CLOSED_PROJECTS_ALL_YEARS : []);
  const managerByProject = new Map();
  const managerByNormalizedProject = new Map();
  const projectStartByNormalizedKey = new Map();
  (data || []).forEach((r) => {
    const key = normalizeProjectKey(r.project || "");
    const monthStart = monthToDateStart(r.month || "");
    if (!key || !monthStart) return;
    const current = projectStartByNormalizedKey.get(key);
    if (!current || monthStart.getTime() < current.getTime()) projectStartByNormalizedKey.set(key, monthStart);
  });
  latestRowsByProject(data || []).forEach((r) => {
    const payload = {
      project_manager: r.project_manager || "",
      im_manager: r.im_manager || "",
    };
    managerByProject.set(r.project || "", payload);
    const key = normalizeProjectKey(r.project || "");
    if (key && !managerByNormalizedProject.has(key)) managerByNormalizedProject.set(key, payload);
  });
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const goLiveByYear = new Map();
  allRows.forEach((r) => {
    const y = getGoLiveYear(r);
    if (!y) return;
    if (!goLiveByYear.has(y)) goLiveByYear.set(y, []);
    const mgr = managerByProject.get(r.project || "") || managerByNormalizedProject.get(normalizeProjectKey(r.project || "")) || {};
    const goLiveDate = r.go_live_date || "";
    const goLiveParsed = parseIsoDate(goLiveDate);
    goLiveByYear.get(y).push({
      project: r.project || "",
      go_live_date: goLiveDate,
      type: goLiveParsed && goLiveParsed.getTime() >= todayStart.getTime() ? "Upcoming" : "Went Live",
      project_manager: mgr.project_manager || "",
      im_manager: mgr.im_manager || "",
    });
  });

  const years = [
    ...new Set(
      allRows.map((r) => getGoLiveYear(r)).filter(Boolean)
    ),
  ]
    .sort((a, b) => b.localeCompare(a));
  selector.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");

  const render = (year) => {
    const q = (search.value || "").trim().toLowerCase();
    const yearRows = goLiveByYear.get(String(year)) || [];
    const seen = new Set();
    const rows = yearRows
      .filter((r) => !q || (r.project || "").toLowerCase().includes(q))
      .filter((r) => {
        const key = `${r.project}|${r.go_live_date}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => ((a.go_live_date || "").localeCompare(b.go_live_date || "") || (a.project || "").localeCompare(b.project || "")));
    const pastCount = yearRows.filter((r) => r.type === "Went Live").length;
    const pendingCount = yearRows.filter((r) => r.type === "Upcoming").length;
    const timelineDays = yearRows
      .map((r) => {
        const start = projectStartByNormalizedKey.get(normalizeProjectKey(r.project || ""));
        const end = parseIsoDate(r.go_live_date || "");
        if (!start || !end) return null;
        const diff = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
        return diff >= 0 ? diff : null;
      })
      .filter((v) => v != null);
    const avgTimelineDays = timelineDays.length ? Math.round(timelineDays.reduce((sum, v) => sum + v, 0) / timelineDays.length) : 0;
    renderGoLiveYearCards(year, pastCount, pendingCount, avgTimelineDays, timelineDays.length);
    renderGoLiveYearTable(year, rows);
    setUrlParam("gly_year", year);
    setUrlParam("gly_q", search.value);
  };

  selector.addEventListener("change", (e) => render(e.target.value));
  search.addEventListener("input", () => render(selector.value));

  if (years.length) {
    const currentYear = String(new Date().getFullYear());
    const defaultYear = years.includes(currentYear) ? currentYear : years[0];
    const fromUrl = getUrlParam("gly_year", defaultYear);
    selector.value = years.includes(fromUrl) ? fromUrl : defaultYear;
    search.value = getUrlParam("gly_q", "");
    render(selector.value);
  } else {
    renderGoLiveYearCards(new Date().getFullYear(), 0, 0, 0, 0);
    renderGoLiveYearTable(new Date().getFullYear(), []);
  }
}

const US_STATE_CODE_SET = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

const NON_US_REGION_CODE_SET = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]);

const STATE_NAME_TO_CODE = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};

const PROJECT_STATE_OVERRIDES = {
  "Columbia River Gorge Commission": "WA",
  "West Metro Fire Protection District": "CO",
  "Richmond Hill, Canada (P2)": "Other",
};

function extractStateFromProjectName(project) {
  const p = String(project || "").trim();
  if (!p) return "Unknown";
  if (PROJECT_STATE_OVERRIDES[p]) return PROJECT_STATE_OVERRIDES[p];
  const upper = p.toUpperCase().replace(/[–—]/g, "-");

  if (/\b(CANADA|ONTARIO|ALBERTA|BRITISH COLUMBIA|MANITOBA|NEW BRUNSWICK|NEWFOUNDLAND|LABRADOR|NOVA SCOTIA|NUNAVUT|NORTHWEST TERRITORIES|PRINCE EDWARD ISLAND|QUEBEC|SASKATCHEWAN|YUKON)\b/.test(upper)) {
    return "Other";
  }

  const stateNames = Object.keys(STATE_NAME_TO_CODE).sort((a, b) => b.length - a.length);
  for (const name of stateNames) {
    const rx = new RegExp(`(^|[^A-Z])${name.replace(/ /g, "\\s+")}([^A-Z]|$)`);
    if (rx.test(upper)) return STATE_NAME_TO_CODE[name];
  }

  const usCodes = [];
  const nonUsCodes = [];
  const re = /(^|[\s,()/-])([A-Z]{2})(?=$|[\s,()/-]|\d)/g;
  let m;
  while ((m = re.exec(upper)) !== null) {
    const code = m[2];
    if (US_STATE_CODE_SET.has(code)) usCodes.push(code);
    if (NON_US_REGION_CODE_SET.has(code)) nonUsCodes.push(code);
  }
  if (usCodes.length) return usCodes[usCodes.length - 1];
  if (nonUsCodes.length) return "Other";
  return "Unknown";
}


function renderGoLiveStateCards(yearA, yearB, totalA, totalB, unknownA, unknownB) {
  const el = document.getElementById("goLiveStateCards");
  if (!el) return;
  el.innerHTML = "";

  const cardA = document.createElement("article");
  cardA.className = "metric is-green";
  cardA.innerHTML = `<h3>${yearA}</h3><p>${totalA}</p><small>Total go-lives</small>`;
  el.appendChild(cardA);

  const cardB = document.createElement("article");
  cardB.className = "metric is-yellow";
  cardB.innerHTML = `<h3>${yearB}</h3><p>${totalB}</p><small>Total go-lives</small>`;
  el.appendChild(cardB);

  const unknownCard = document.createElement("article");
  unknownCard.className = "metric";
  unknownCard.innerHTML = `<h3>Unknown State</h3><p>${unknownA} / ${unknownB}</p><small>${yearA} / ${yearB}</small>`;
  el.appendChild(unknownCard);
}

function drawGoLiveStateBarChart(svgId, states, yearA, countsA, yearB, countsB) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  svg.innerHTML = "";
  if (!states.length) return;

  const w = 980;
  const h = 380;
  const m = { top: 22, right: 22, bottom: 90, left: 44 };
  const innerW = w - m.left - m.right;
  const innerH = h - m.top - m.bottom;
  const mk = (name) => document.createElementNS("http://www.w3.org/2000/svg", name);
  const yearAColor = "#0078a6";
  const yearBColor = "#00a3a1";
  const maxVal = Math.max(1, ...states.map((s) => Math.max(countsA.get(s) || 0, countsB.get(s) || 0)));
  const groupW = innerW / states.length;
  const barW = Math.max(6, Math.min(26, groupW * 0.32));

  const axis = mk("path");
  axis.setAttribute("class", "axis");
  axis.setAttribute("d", `M ${m.left} ${m.top} L ${m.left} ${m.top + innerH} L ${m.left + innerW} ${m.top + innerH}`);
  svg.appendChild(axis);

  states.forEach((state, idx) => {
    const gX = m.left + idx * groupW + groupW / 2;
    const a = countsA.get(state) || 0;
    const b = countsB.get(state) || 0;
    const aH = (a / maxVal) * innerH;
    const bH = (b / maxVal) * innerH;

    const rA = mk("rect");
    rA.setAttribute("x", `${gX - barW - 2}`);
    rA.setAttribute("y", `${m.top + innerH - aH}`);
    rA.setAttribute("width", `${barW}`);
    rA.setAttribute("height", `${aH}`);
    rA.setAttribute("fill", yearAColor);
    svg.appendChild(rA);

    const rB = mk("rect");
    rB.setAttribute("x", `${gX + 2}`);
    rB.setAttribute("y", `${m.top + innerH - bH}`);
    rB.setAttribute("width", `${barW}`);
    rB.setAttribute("height", `${bH}`);
    rB.setAttribute("fill", yearBColor);
    svg.appendChild(rB);

    const label = mk("text");
    label.setAttribute("x", `${gX}`);
    label.setAttribute("y", `${m.top + innerH + 18}`);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "#2e525a");
    label.setAttribute("font-size", "11");
    label.textContent = state;
    svg.appendChild(label);
  });

  const legendA = mk("text");
  legendA.setAttribute("x", `${m.left + 8}`);
  legendA.setAttribute("y", `${h - 16}`);
  legendA.setAttribute("fill", yearAColor);
  legendA.setAttribute("font-size", "12");
  legendA.textContent = `${yearA}`;
  svg.appendChild(legendA);

  const legendB = mk("text");
  legendB.setAttribute("x", `${m.left + 78}`);
  legendB.setAttribute("y", `${h - 16}`);
  legendB.setAttribute("fill", yearBColor);
  legendB.setAttribute("font-size", "12");
  legendB.textContent = `${yearB}`;
  svg.appendChild(legendB);
}

function renderGoLiveStateTable(rows) {
  const table = document.getElementById("goLiveStateTable");
  if (!table) return;
  const headers = ["state", "year_a", "count_a", "year_b", "count_b", "delta"];
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = formatDisplayValue(h, r[h] || "");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  DASHBOARD_STATE.goLiveStateRows = rows.map((r) => ({ ...r }));
}

function renderGoLiveStateUnknownTable(rows) {
  const table = document.getElementById("goLiveStateUnknownTable");
  if (!table) return;
  const headers = ["year", "project", "go_live_date"];
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = formatDisplayValue(h, r[h] || "");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderGoLiveStateDetailTable(rows) {
  const table = document.getElementById("goLiveStateDetailTable");
  const countEl = document.getElementById("goLiveStateFilterCount");
  if (!table) return;
  const headers = ["state", "year", "project", "go_live_date"];
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = formatDisplayValue(h, r[h] || "");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  if (countEl) {
    countEl.textContent = rows.length ? `${rows.length} go-live${rows.length === 1 ? "" : "s"}` : "0 go-lives";
  }
  DASHBOARD_STATE.goLiveStateDetailRows = rows.map((r) => ({ ...r }));
}

function initGoLiveStatePage(_data, closedAllYearsRows = []) {
  const yearASelect = document.getElementById("goLiveStateYearA");
  const yearBSelect = document.getElementById("goLiveStateYearB");
  const topNSelect = document.getElementById("goLiveStateTopN");
  const topTitle = document.getElementById("goLiveStateTopTitle");
  const stateFilter = document.getElementById("goLiveStateFilter");
  if (!yearASelect || !yearBSelect || !stateFilter) return;

  const allRows = Array.isArray(closedAllYearsRows) && closedAllYearsRows.length
    ? closedAllYearsRows
    : (Array.isArray(window.CLOSED_PROJECTS_ALL_YEARS) ? window.CLOSED_PROJECTS_ALL_YEARS : []);
  const uniqueRows = [];
  const seen = new Set();
  allRows.forEach((r) => {
    const key = `${r.project || ""}|${r.go_live_date || ""}|${getGoLiveYear(r)}`;
    if (seen.has(key)) return;
    seen.add(key);
    uniqueRows.push(r);
  });
  const years = [...new Set(uniqueRows.map((r) => getGoLiveYear(r)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  if (!years.length) return;
  const allStates = [...new Set(uniqueRows.map((r) => extractStateFromProjectName(r.project || "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  stateFilter.innerHTML = ['<option value="">All States</option>'].concat(allStates.map((s) => `<option value="${s}">${s}</option>`)).join("");

  const fillYearSelect = (el) => {
    el.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  };
  fillYearSelect(yearASelect);
  fillYearSelect(yearBSelect);

  const currentYear = String(new Date().getFullYear());
  const defaultA = years.includes(currentYear) ? currentYear : years[0];
  const defaultB = years.find((y) => y !== defaultA) || defaultA;
  const fromA = getUrlParam("gls_year_a", defaultA);
  const fromB = getUrlParam("gls_year_b", defaultB);
  yearASelect.value = years.includes(fromA) ? fromA : defaultA;
  yearBSelect.value = years.includes(fromB) ? fromB : defaultB;
  if (topNSelect) {
    const fromTop = getUrlParam("gls_top", topNSelect.value || "10");
    if (["0", "5", "10"].includes(fromTop)) topNSelect.value = fromTop;
  }
  const fromState = getUrlParam("gls_state", "");
  stateFilter.value = allStates.includes(fromState) ? fromState : "";
  if (yearASelect.value === yearBSelect.value && years.length > 1) {
    yearBSelect.value = years.find((y) => y !== yearASelect.value) || yearBSelect.value;
  }

  const render = () => {
    if (yearASelect.value === yearBSelect.value && years.length > 1) {
      const alt = years.find((y) => y !== yearASelect.value);
      if (alt) yearBSelect.value = alt;
    }
    const yearA = yearASelect.value;
    const yearB = yearBSelect.value;
    const yearRowsA = uniqueRows.filter((r) => getGoLiveYear(r) === yearA);
    const yearRowsB = uniqueRows.filter((r) => getGoLiveYear(r) === yearB);
    const countsA = new Map();
    const countsB = new Map();

    yearRowsA.forEach((r) => {
      const s = extractStateFromProjectName(r.project);
      countsA.set(s, (countsA.get(s) || 0) + 1);
    });
    yearRowsB.forEach((r) => {
      const s = extractStateFromProjectName(r.project);
      countsB.set(s, (countsB.get(s) || 0) + 1);
    });

    const states = [...new Set([...countsA.keys(), ...countsB.keys(), "Unknown"])]
      .sort((a, b) => {
        const da = Math.max(countsA.get(a) || 0, countsB.get(a) || 0);
        const db = Math.max(countsA.get(b) || 0, countsB.get(b) || 0);
        if (db !== da) return db - da;
        return a.localeCompare(b);
      });

    renderGoLiveStateCards(
      yearA,
      yearB,
      yearRowsA.length,
      yearRowsB.length,
      countsA.get("Unknown") || 0,
      countsB.get("Unknown") || 0
    );
    drawGoLiveStateBarChart("goLiveStateChart", states, yearA, countsA, yearB, countsB);
    const topN = topNSelect ? Number(topNSelect.value || "10") : 10;
    const topStates = topN > 0 ? states.slice(0, topN) : states;
    drawGoLiveStateBarChart("goLiveStateTopChart", topStates, yearA, countsA, yearB, countsB);
    if (topTitle) topTitle.textContent = topN > 0 ? `Top ${topN} States Comparison` : "All States Comparison";
    const tableRows = states.map((s) => {
      const a = countsA.get(s) || 0;
      const b = countsB.get(s) || 0;
      return {
        state: s,
        year_a: yearA,
        count_a: String(a),
        year_b: yearB,
        count_b: String(b),
        delta: String(a - b),
      };
    });
    renderGoLiveStateTable(tableRows);
    const filteredState = stateFilter.value || "";
    const detailRows = uniqueRows
      .map((r) => ({
        state: extractStateFromProjectName(r.project || ""),
        year: getGoLiveYear(r),
        project: r.project || "",
        go_live_date: r.go_live_date || "",
      }))
      .filter((r) => !filteredState || r.state === filteredState)
      .sort((a, b) => ((a.go_live_date || "").localeCompare(b.go_live_date || "") || (a.project || "").localeCompare(b.project || "")));
    renderGoLiveStateDetailTable(detailRows);
    const unknownRows = uniqueRows
      .filter((r) => {
        const y = getGoLiveYear(r);
        return y === yearA || y === yearB;
      })
      .filter((r) => extractStateFromProjectName(r.project) === "Unknown")
      .map((r) => ({
        year: getGoLiveYear(r),
        project: r.project || "",
        go_live_date: r.go_live_date || "",
      }))
      .sort((a, b) => ((a.year || "").localeCompare(b.year || "") || (a.project || "").localeCompare(b.project || "")));
    renderGoLiveStateUnknownTable(unknownRows);
    setUrlParam("gls_year_a", yearA);
    setUrlParam("gls_year_b", yearB);
    setUrlParam("gls_top", topNSelect ? topNSelect.value : "10");
    setUrlParam("gls_state", filteredState);
  };

  yearASelect.addEventListener("change", render);
  yearBSelect.addEventListener("change", render);
  stateFilter.addEventListener("change", render);
  if (topNSelect) topNSelect.addEventListener("change", render);
  render();
}

function drawMultiLineChart(svgId, labels, series) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  svg.innerHTML = "";
  if (!labels.length) return;

  const w = 920;
  const h = 320;
  const m = { top: 20, right: 24, bottom: 48, left: 42 };
  const innerW = w - m.left - m.right;
  const innerH = h - m.top - m.bottom;
  const allVals = series.flatMap((s) => s.values);
  const maxVal = Math.max(...allVals, 1);

  const mk = (name) => document.createElementNS("http://www.w3.org/2000/svg", name);
  const axis = mk("path");
  axis.setAttribute("d", `M ${m.left} ${m.top} L ${m.left} ${m.top + innerH} L ${m.left + innerW} ${m.top + innerH}`);
  axis.setAttribute("class", "axis");
  svg.appendChild(axis);

  function xAt(i) {
    return m.left + (i * innerW) / Math.max(labels.length - 1, 1);
  }
  function yAt(v) {
    return m.top + innerH - (v * innerH) / Math.max(maxVal, 1);
  }

  series.forEach((s) => {
    const p = mk("path");
    const d = s.values
      .map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(v)}`)
      .join(" ");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", s.color);
    p.setAttribute("stroke-width", "2.7");
    svg.appendChild(p);
  });

  labels.forEach((label, i) => {
    const t = mk("text");
    t.setAttribute("x", xAt(i));
    t.setAttribute("y", h - 16);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "tick");
    t.textContent = label;
    svg.appendChild(t);
  });

  series.forEach((s, idx) => {
    const t = mk("text");
    t.setAttribute("x", m.left + idx * 120);
    t.setAttribute("y", m.top + 14);
    t.setAttribute("fill", s.color);
    t.setAttribute("font-size", "12");
    t.textContent = s.name;
    svg.appendChild(t);
  });
}

function renderPieDrillTable(rows, titleText) {
  const title = document.getElementById("pieDrillTitle");
  const table = document.getElementById("pieDrillTable");
  if (!title || !table) return;
  title.textContent = titleText || "Pie Drill-Down";

  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const headers = ["project", "status", "client_status", "go_live_date", "project_manager", "im_manager"];
  const trHead = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = formatDisplayValue(h, r[h] || "");
      if (h === "status" || h === "client_status") {
        td.classList.add("status-cell");
        const s = (r[h] || "").toLowerCase();
        if (s === "red") td.classList.add("status-red");
        if (s === "yellow") td.classList.add("status-yellow");
        if (s === "green") td.classList.add("status-green");
        if (s === "on hold") td.classList.add("status-hold");
        if (s === "not started") td.classList.add("status-not-started");
        if (s === "canceled") td.classList.add("status-canceled");
        if (s === "in progress") td.classList.add("status-in-progress");
        if (s === "completed") td.classList.add("status-completed");
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  DASHBOARD_STATE.pieDrillRows = rows.map((r) => ({ ...r }));
}

function drawPieChart(svgId, counts, titleText, onSelect) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  svg.innerHTML = "";
  const total =
    counts.Red +
    counts.Yellow +
    counts.Green +
    (counts["On Hold"] || 0) +
    (counts["Not Started"] || 0);
  if (total <= 0) return;

  const cx = 130;
  const cy = 145;
  const r = 90;
  const colors = [
    { name: "Red", value: counts.Red, color: "#cb3a2e" },
    { name: "Yellow", value: counts.Yellow, color: "#b58500" },
    { name: "Green", value: counts.Green, color: "#1c8b5c" },
    { name: "On Hold", value: counts["On Hold"] || 0, color: "#6f52a8" },
    { name: "Not Started", value: counts["Not Started"] || 0, color: "#4068c9" },
  ];

  const mk = (name) => document.createElementNS("http://www.w3.org/2000/svg", name);
  let start = -Math.PI / 2;

  colors.filter((c) => c.value > 0).forEach((item) => {
    const frac = item.value / total;
    const end = start + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = end - start > Math.PI ? 1 : 0;
    const path = mk("path");
    path.setAttribute("d", `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`);
    path.setAttribute("fill", item.color);
    path.style.cursor = "pointer";
    path.addEventListener("click", () => onSelect(item.name, titleText));
    svg.appendChild(path);
    start = end;
  });

  const legendX = 250;
  colors.filter((c) => c.value > 0).forEach((item, i) => {
    const y = 105 + i * 34;
    const dot = mk("circle");
    dot.setAttribute("cx", legendX);
    dot.setAttribute("cy", y);
    dot.setAttribute("r", 7);
    dot.setAttribute("fill", item.color);
    svg.appendChild(dot);

    const text = mk("text");
    text.setAttribute("x", legendX + 14);
    text.setAttribute("y", y + 4);
    text.setAttribute("fill", "#244850");
    text.setAttribute("font-size", "12");
    text.textContent = `${item.name}: ${item.value}`;
    text.style.cursor = "pointer";
    text.addEventListener("click", () => onSelect(item.name, titleText));
    svg.appendChild(text);
  });

  const ttl = mk("text");
  ttl.setAttribute("x", cx);
  ttl.setAttribute("y", 282);
  ttl.setAttribute("text-anchor", "middle");
  ttl.setAttribute("fill", "#35556b");
  ttl.setAttribute("font-size", "12");
  ttl.textContent = `${titleText} (Total ${total})`;
  svg.appendChild(ttl);
}

async function uploadSourceFiles(files, target) {
  const body = new FormData();
  body.append("target", target);
  files.forEach((file) => body.append("files", file));
  const res = await fetch("/api/upload", {
    method: "POST",
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return data;
}

async function revertLastUpload() {
  const res = await fetch("/api/revert-last-upload", {
    method: "POST",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Revert failed (${res.status})`);
  }
  return data;
}

function initUploadPanel() {
  const panel = document.getElementById("uploadPanel");
  if (!panel) return;
  const targetEl = document.getElementById("uploadTarget");
  const filesEl = document.getElementById("uploadFiles");
  const buttonEl = document.getElementById("uploadFilesBtn");
  const revertEl = document.getElementById("revertUploadBtn");
  const hintEl = document.getElementById("uploadHint");
  const statusEl = document.getElementById("uploadStatus");
  if (!targetEl || !filesEl || !buttonEl || !hintEl || !statusEl || !revertEl) return;

  const setStatus = (message, className = "") => {
    statusEl.textContent = message;
    statusEl.className = `upload-status${className ? ` ${className}` : ""}`;
  };

  const isServedLocally = window.location.protocol !== "file:";
  if (!isServedLocally) {
    buttonEl.disabled = true;
    filesEl.disabled = true;
    targetEl.disabled = true;
    revertEl.disabled = true;
    hintEl.textContent = "Direct upload works from the localhost app only.";
    setStatus("Open the dashboard from the localhost command to upload files.", "is-error");
    return;
  }

  buttonEl.addEventListener("click", async () => {
    const files = Array.from(filesEl.files || []);
    if (!files.length) {
      setStatus("Choose one or more files to upload.", "is-error");
      return;
    }
    buttonEl.disabled = true;
    setStatus(`Uploading ${files.length} file${files.length === 1 ? "" : "s"} and refreshing dashboard...`);
    try {
      const data = await uploadSourceFiles(files, targetEl.value || "ai_dump");
      const uploaded = Array.isArray(data.files) ? data.files.join(", ") : "files uploaded";
      setStatus(`Upload complete: ${uploaded}. Reloading dashboard...`, "is-success");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setStatus(err.message || "Upload failed.", "is-error");
    } finally {
      buttonEl.disabled = false;
      filesEl.value = "";
    }
  });

  revertEl.addEventListener("click", async () => {
    revertEl.disabled = true;
    buttonEl.disabled = true;
    setStatus("Reverting last upload and refreshing dashboard...");
    try {
      const data = await revertLastUpload();
      const restored = []
        .concat(Array.isArray(data.restored) ? data.restored : [])
        .concat(Array.isArray(data.removed) ? data.removed : []);
      const message = restored.length ? restored.join(", ") : "last upload reverted";
      setStatus(`Revert complete: ${message}. Reloading dashboard...`, "is-success");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setStatus(err.message || "Revert failed.", "is-error");
    } finally {
      revertEl.disabled = false;
      buttonEl.disabled = false;
    }
  });
}

function initHomePage(historicalData, allData, closedRows, latestMonth) {
  if (!document.getElementById("homeCards")) return;
  initUploadPanel();
  initClosuresPanel(closedRows || []);
  renderHomeCards(allData, latestMonth);
  renderPortfolioKpis(allData, closedRows || [], latestMonth);
  renderDataQualityPanel(allData, latestMonth);
  renderStatusLegend();
  renderExceptionsTable();
  const months = statusCountsByMonth(historicalData).filter((m) => (m.month || "") >= RYG_TREND_START_MONTH);
  const selectStatus = (statusName, monthLabel) => {
    const rows = historicalData
      .filter((r) => (r.month || "") === (monthLabel || ""))
      .filter((r) => !isCanceledStatus(r.status))
      .filter((r) => !statusName || (r.status || "") === statusName)
      .sort((a, b) => (a.project || "").localeCompare(b.project || ""));
    const title = statusName
      ? `Pie Drill-Down: ${statusName} (${monthLabel})`
      : `Pie Drill-Down: All Statuses (${monthLabel})`;
    renderPieDrillTable(rows, title);
  };
  if (months.length) {
    const current = months[months.length - 1];
    const previous = months.length > 1 ? months[months.length - 2] : { Red: 0, Yellow: 0, Green: 0, month: "N/A" };
    drawPieChart("currentPieChart", current, current.month, selectStatus);
    drawPieChart("previousPieChart", previous, previous.month || "N/A", selectStatus);
    selectStatus("", current.month);
    const homeCards = document.getElementById("homeCards");
    if (homeCards) {
      homeCards.addEventListener("click", (event) => {
        const card = event.target.closest(".clickable-metric");
        if (!card) return;
        const status = card.dataset.statusName || "";
        selectStatus(status, current.month);
      });
    }
  }
  renderUpcomingGoLiveChart(allData, latestMonth);
  renderManagerWorkloadCharts(allData, latestMonth);
  renderManagerStatusTable(allData, latestMonth);
  drawMultiLineChart(
    "rygTrendChart",
    months.map((m) => m.month),
    [
      { name: "Red", color: "#cb3a2e", values: months.map((m) => m.Red) },
      { name: "Yellow", color: "#b58500", values: months.map((m) => m.Yellow) },
      { name: "Green", color: "#1c8b5c", values: months.map((m) => m.Green) },
      { name: "On Hold", color: "#6f52a8", values: months.map((m) => m["On Hold"]) },
      { name: "Not Started", color: "#4068c9", values: months.map((m) => m["Not Started"]) },
    ]
  );
}

async function init() {
  try {
    const pageFlags = getPageFlags();
    const needs = getPageDataNeeds(pageFlags);
    let data = [];
    let visibleData = [];
    let allClosedRows = [];
    let closedRows = [];
    let previousHistoryLookup = new Map();
    let latestMonth = "";
    let activeHistoricalData = [];
    let activeData = [];
    let canceledProjects = new Set();

    if (needs.needsManualEdits) {
      await loadManualEdits();
    }

    if (needs.needsStatusHistory) {
      const rawData = await loadStatusHistory();
      data = rawData
        .map((r) => ({ ...r, month: normalizeMonthValue(r.month) }))
        .filter((r) => !isTemplateProject(r.project || ""))
        .filter((r) => !isExcludedProject(r.project || ""));
      if (needs.needsManualEdits) {
        applyManualOverridesToData(data, loadManualOverrides());
      }
      canceledProjects = buildCanceledProjectSet(data);
      visibleData = filterOutCanceledProjects(data, canceledProjects);
      previousHistoryLookup = buildPreviousHistoryLookup(visibleData);
      latestMonth = getLatestMonth(visibleData);
      activeHistoricalData = filterToActiveProjects(visibleData);
      const latestDocumentData = visibleData.filter((r) => (r.month || "") === latestMonth);
      activeData = filterToActiveProjects(latestDocumentData);
    }

    if (needs.needsClosedAllYears) {
      const allClosedRowsRaw = await loadClosedAllYears();
      allClosedRows = allClosedRowsRaw
        .filter((r) => !isTemplateProject(r.project || ""))
        .filter((r) => !isExcludedProject(r.project || ""))
        .filter((r) => !canceledProjects.has(r.project || ""))
        .filter((r) => !canceledProjects.has(normalizeProjectKey(r.project || "")));
    }

    if (needs.needsClosedCurrentYear) {
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const currentYear = String(today.getFullYear());
      closedRows = (await loadClosedCurrentYear())
        .filter((r) => !isTemplateProject(r.project || ""))
        .filter((r) => !isExcludedProject(r.project || ""))
        .filter((r) => !canceledProjects.has(r.project || ""))
        .filter((r) => !canceledProjects.has(normalizeProjectKey(r.project || "")));
      if (!closedRows.length) {
        closedRows = allClosedRows
          .filter((r) => getGoLiveYear(r) === currentYear)
          .filter((r) => {
            const d = parseIsoDate(r.go_live_date || "");
            return d && d.getTime() < todayStart.getTime();
          });
      }
    }

    renderLastRefreshStamp();

    if (pageFlags.home) initHomePage(activeHistoricalData, visibleData, closedRows, latestMonth);
    if (pageFlags.changes) {
      renderChangesTable(visibleData, latestMonth);
      renderManualChangesTable();
    }
    if (pageFlags.dataQuality) {
      renderDataQualityPanel(visibleData, latestMonth);
      renderDataQualityIssuesTable(visibleData, latestMonth);
      const issueFilter = document.getElementById("dataQualityIssueFilter");
      if (issueFilter) {
        issueFilter.addEventListener("change", () => renderDataQualityIssuesTable(visibleData, latestMonth));
      }
    }
    if (pageFlags.projects) initProjectsPage(visibleData, previousHistoryLookup);
    if (pageFlags.allProjects) initAllProjectsPage(activeData, previousHistoryLookup, allClosedRows);
    if (pageFlags.goLiveYear) initGoLiveYearPage(visibleData, allClosedRows);
    if (pageFlags.goLiveState) initGoLiveStatePage(visibleData, allClosedRows);

    bindExportButton("exportStatusBtn", "project_status.csv", ["status", "status_change_from_last_month", "go_live_date", "im_manager", "root_cause", "go_live_change_from_last_month", "notes"], () => DASHBOARD_STATE.statusRows);
    bindExportButton("exportAllProjectsBtn", "all_projects.csv", ["project", "state", "status", "client_status", "go_live_date", "project_manager", "im_manager", "notes", "root_cause"], () => DASHBOARD_STATE.allProjectsRows);
    bindExportButton("exportGoLiveYearBtn", "go_live_by_year.csv", ["project", "go_live_date", "type", "project_manager", "im_manager"], () => DASHBOARD_STATE.goLiveYearRows);
    bindExportButton("exportGoLiveStateBtn", "go_live_by_state.csv", ["state", "year_a", "count_a", "year_b", "count_b", "delta"], () => DASHBOARD_STATE.goLiveStateRows);
    bindExportButton("exportClosuresBtn", "current_year_go_lives.csv", ["project", "go_live_date"], () => DASHBOARD_STATE.closureRows);
    bindExportButton("exportPieDrillBtn", "pie_drill_down.csv", ["project", "status", "client_status", "go_live_date", "project_manager", "im_manager"], () => DASHBOARD_STATE.pieDrillRows);
    bindExportButton("exportChangesBtn", "changes_since_last_refresh.csv", ["project", "status_change", "go_live_change", "original_go_live_date", "changed_go_live_date", "notes_change", "notes"], () => DASHBOARD_STATE.changeRows);
    bindExportButton("exportManualChangesBtn", "manual_changes.csv", ["updated_at", "project", "field", "new_value", "source"], () => loadManualAudit());
    bindExportButton("exportDataQualityBtn", "data_quality_issues.csv", ["project", "issue", "detail"], () => DASHBOARD_STATE.dataQualityRows);
  } catch (err) {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.textContent = `Could not load status history: ${err.message}`;
    document.querySelector(".page").appendChild(panel);
  }
}

init();
