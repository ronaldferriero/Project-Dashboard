// CRM ARR for Active Projects: per-project cells, Snapshot roll-ups, ARR by Region rows and the data stamp.
// Reads window.CRM_ARR_DATA (dashboard/data/crm/crm_arr.js, local only). Pure functions, no DOM access.
//
// A client is the CRM account family sharing the Account Number at the end of the project title. Projects that
// share a client show the same ARR, but roll-ups count each client once.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CrmArr = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  // Same rule as crm_arr_store.TITLE_ACCOUNT_NUMBER: a dash, an optional two-letter state code, then the number.
  const TITLE_ACCOUNT_NUMBER = /-\s*(?:[A-Z]{2}\s+)?(\d{3,7})\s*$/;
  const OVERDUE_DAYS = 8;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function accountNumberFromTitle(title) {
    const match = TITLE_ACCOUNT_NUMBER.exec(title || "");
    return match ? match[1] : null;
  }

  function hasData(data) {
    return !!(data && data.accounts && Object.keys(data.accounts).length);
  }

  function entryForRow(row, data) {
    const number = accountNumberFromTitle(row && row.title);
    if (!number) {
      return { number: null, status: "no_number", total: null, epl: null, reason: "No account number in project title" };
    }
    const entry = data && data.accounts ? data.accounts[number] : null;
    if (!entry) {
      return { number, status: "not_fetched", total: null, epl: null, reason: `Account ${number} not yet fetched from CRM` };
    }
    // An "error" entry keeps the last good values from an earlier refresh.
    const hasValues = (entry.status === "ok" || entry.status === "error") && typeof entry.total_arr === "number";
    return {
      number,
      status: entry.status,
      total: hasValues ? entry.total_arr : null,
      epl: hasValues ? (typeof entry.epl_arr === "number" ? entry.epl_arr : 0) : null,
      reason: entry.reason || "",
    };
  }

  function sortValue(row, data, key) {
    const entry = entryForRow(row, data);
    if (key === "crm_total_arr") return entry.total;
    if (key === "crm_epl_arr") return entry.epl;
    return null;
  }

  // Each client once: the first project in `rows` order that carries numbers for it.
  function uniqueClients(rows, data) {
    const seen = new Set();
    const clients = [];
    (rows || []).forEach((row) => {
      const entry = entryForRow(row, data);
      if (entry.total === null || seen.has(entry.number)) return;
      seen.add(entry.number);
      clients.push({ row, entry });
    });
    return clients;
  }

  function rollup(rows, data) {
    const list = rows || [];
    const matched = list.filter((row) => entryForRow(row, data).total !== null).length;
    let total = 0;
    let epl = 0;
    uniqueClients(list, data).forEach(({ entry }) => {
      total += entry.total;
      epl += entry.epl;
    });
    return { total, epl, matched, projects: list.length, eplShare: total > 0 ? epl / total : null };
  }

  function byRegion(rows, data, regionOf) {
    const regions = new Map();
    uniqueClients(rows, data).forEach(({ row, entry }) => {
      const label = (regionOf(row) || "").trim() || "Unassigned";
      const bucket = regions.get(label) || { label, epl: 0, other: 0, total: 0 };
      bucket.epl += entry.epl;
      bucket.other += entry.total - entry.epl;
      bucket.total += entry.total;
      regions.set(label, bucket);
    });
    return [...regions.values()].filter((bucket) => bucket.total !== 0).sort((a, b) => b.total - a.total);
  }

  function formatCompact(value) {
    const amount = Number(value) || 0;
    const sign = amount < 0 ? "-" : "";
    const abs = Math.abs(amount);
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
    return `${sign}$${Math.round(abs)}`;
  }

  function stampText(data, now = new Date()) {
    const checkedAt = (data && (data.last_weekly_check || data.generated_at)) || "";
    const checked = checkedAt ? new Date(checkedAt) : null;
    if (!checked || Number.isNaN(checked.getTime())) {
      return { text: "CRM ARR not checked yet", warning: "" };
    }
    const label = checked.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    let warning = "";
    if (now - checked > OVERDUE_DAYS * DAY_MS) {
      warning = "weekly CRM check overdue";
    } else if (data.last_run && data.last_run.errors > 0) {
      warning = "some accounts could not be refreshed";
    }
    return { text: `CRM ARR checked ${label}`, warning };
  }

  return { accountNumberFromTitle, hasData, entryForRow, sortValue, rollup, byRegion, formatCompact, stampText };
});
