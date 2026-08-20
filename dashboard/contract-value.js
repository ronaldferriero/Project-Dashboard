// Contract Value Dashboard Logic

// Cumulative % complete by month, per the 5/15/20/30/25/5 stage-weighted S-curve.
// Index 0 = project start (0%); final index = project close (100%).
const SCHEDULE_CURVE_12MO = [0, 5, 12.5, 20, 30, 40, 47.5, 55, 62.5, 70, 82.5, 95, 100];
const SCHEDULE_CURVE_18MO = [0, 5, 12.5, 20, 26.7, 33.3, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
const AVG_DAYS_PER_MONTH = 30.4368; // 365.2425 / 12

function addMonthsUTC(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function monthsBetween(start, end) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return (end.getTime() - start.getTime()) / msPerDay / AVG_DAYS_PER_MONTH;
}

function isDecember31Placeholder(goLiveDate) {
  return goLiveDate.getUTCMonth() === 11 && goLiveDate.getUTCDate() === 31;
}

// Reads a % complete off the curve using normalized progress (0-1 = start-to-close), not
// absolute months. That way a project whose actual duration is longer than the curve's own
// span (e.g. 28 months, snapped to the 18-month curve shape) still reaches 100% at its own
// close date instead of being clamped to 100% once 18 literal months have elapsed.
function interpolateCurve(curve, progressFraction) {
  const clamped = Math.max(0, Math.min(progressFraction, 1));
  const position = clamped * (curve.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, curve.length - 1);
  const frac = position - lower;
  return curve[lower] + (curve[upper] - curve[lower]) * frac;
}

// Assumes project close = go-live + 1 month. Snaps the implementation duration to
// whichever stage-weighted curve (12mo or 18mo) it's closer to, then reads the
// cumulative % complete off that curve for "today". A go-live pinned to Dec 31 is a
// known Confluence placeholder rather than a real date, so those projects are treated
// as already fully consumed instead of run through the curve.
function scheduleForRow(row) {
  const startDate = parseGoLiveDate(row.implementation_start_date);
  const goLiveDate = parseGoLiveDate(row.go_live);
  if (!startDate || !goLiveDate) {
    return { available: false };
  }

  if (isDecember31Placeholder(goLiveDate)) {
    return { available: true, isPlaceholder: true, totalMonths: 12, pctComplete: 100 };
  }

  const closeDate = addMonthsUTC(goLiveDate, 1);
  const rawMonths = monthsBetween(startDate, closeDate);
  if (!Number.isFinite(rawMonths) || rawMonths <= 0) {
    return { available: false };
  }

  const roundedMonths = Math.round(rawMonths);
  const curveShapeMonths = roundedMonths <= 15 ? 12 : 18;
  const curve = curveShapeMonths === 12 ? SCHEDULE_CURVE_12MO : SCHEDULE_CURVE_18MO;
  const elapsedMonths = monthsBetween(startDate, new Date());
  const progressFraction = elapsedMonths / rawMonths;
  const pctComplete = interpolateCurve(curve, progressFraction);

  return { available: true, isPlaceholder: false, totalMonths: roundedMonths, curveShapeMonths, pctComplete };
}

function servicesConsumptionForRow(row, value) {
  const schedule = scheduleForRow(row);
  if (!schedule.available || !value.complete) {
    return { available: false };
  }

  const pctComplete = schedule.pctComplete;
  const consumed = value.services * (pctComplete / 100);
  const remaining = value.services - consumed;

  return {
    available: true,
    isPlaceholder: schedule.isPlaceholder,
    totalMonths: schedule.totalMonths,
    pctComplete,
    consumed,
    remaining,
  };
}

function isPastGoLive(row) {
  const goLiveDate = parseGoLiveDate(row.go_live);
  if (!goLiveDate) {
    return false;
  }
  return goLiveDate.getTime() < Date.now();
}

function currentContractValueRows() {
  return (state.projects || []).filter((row) => !isPastGoLive(row));
}

function renderMetricRow(containerId, cards) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }
  container.innerHTML = "";
  cards.forEach(({ label, value, tone, detail }) => {
    const card = document.createElement("article");
    card.className = tone ? `metric metric-${tone}` : "metric";
    card.innerHTML = `<h3>${label}</h3><p>${value}</p>${detail ? `<div class="metric-detail">${detail}</div>` : ""}`;
    container.appendChild(card);
  });
}

function renderContractMetrics(rows) {
  let originalTotalSaas = 0;
  let originalTotalServices = 0;
  let currentTotalServices = 0;
  let withValue = 0;
  let missing = 0;

  rows.forEach((row) => {
    const value = contractValueForRow(row);
    if (!value.complete) {
      missing += 1;
      return;
    }
    withValue += 1;
    originalTotalSaas += value.saas;
    originalTotalServices += value.services;

    const consumption = servicesConsumptionForRow(row, value);
    currentTotalServices += consumption.available ? consumption.remaining : value.services;
  });

  const ratioLabel = originalTotalSaas > 0 ? `${(originalTotalServices / originalTotalSaas).toFixed(1)}x` : "—";

  renderMetricRow("contractMetricsOriginal", [
    { label: "Active Projects", value: rows.length },
    { label: "Original Total SaaS", value: formatCurrency(originalTotalSaas), tone: "blue" },
    { label: "Original Total Services", value: formatCurrency(originalTotalServices), tone: "blue" },
    { label: "Original Total Contract Value", value: formatCurrency(originalTotalSaas + originalTotalServices), tone: "green" },
    {
      label: "Missing Contract Data",
      value: missing,
      tone: missing ? "yellow" : "green",
      detail: `${withValue} of ${rows.length} projects have usable data`,
    },
  ]);

  renderMetricRow("contractMetricsCurrent", [
    { label: "Current Estimated Services", value: formatCurrency(currentTotalServices), tone: "yellow" },
    { label: "Services ÷ SaaS Ratio", value: ratioLabel, detail: "Original Services vs Original SaaS" },
  ]);
}

const MISSING_ISSUE_LABELS = {
  placeholder: "value not entered (XX placeholder)",
  "no-amount": "no amount found",
  ambiguous: "ambiguous — multiple numbers in one field",
  "out-of-range": "amount looks like a data entry error",
  zero: "amount is zero or invalid",
};

function missingReasonLabels(value) {
  if (value.issues && value.issues.length) {
    return value.issues.map((issue) => {
      const [field, kind] = issue.split(": ");
      return `${field} ${MISSING_ISSUE_LABELS[kind] || kind}`;
    });
  }
  if (value.saas === null && value.services === null) {
    return ["No SaaS or Services value found"];
  }
  if (value.saas === null) {
    return ["Missing SaaS value"];
  }
  if (value.services === null) {
    return ["Missing Services value"];
  }
  return ["Unparseable contract value"];
}

function renderMissingTable(rows) {
  const tbody = document.querySelector("#missingTable tbody");
  const countLabel = document.getElementById("missingCount");
  if (!tbody) {
    return;
  }

  const missingRows = rows
    .map((row) => ({ row, value: contractValueForRow(row) }))
    .filter((entry) => !entry.value.complete)
    .sort((a, b) => compareText(a.row.title, b.row.title));

  if (countLabel) {
    countLabel.textContent = `${missingRows.length} project${missingRows.length === 1 ? "" : "s"} missing data`;
  }

  if (!missingRows.length) {
    tbody.innerHTML = `<tr><td colspan="5">No missing contract data among active projects.</td></tr>`;
    return;
  }

  tbody.innerHTML = missingRows
    .map(({ row, value }) => {
      const reasons = missingReasonLabels(value)
        .map((reason) => `<span class="missing-reason">${escapeHtml(reason)}</span>`)
        .join("");
      return `
        <tr>
          <td><a href="${escapeHtml(row.url || "#")}" target="_blank">${escapeHtml(row.title || "Untitled")}</a></td>
          <td>${escapeHtml(formatGoLiveDate(row.go_live))}</td>
          <td>${escapeHtml(row.project_manager || "")}</td>
          <td>${reasons}</td>
          <td><small>${escapeHtml(value.raw || "")}</small></td>
        </tr>
      `;
    })
    .join("");
}

function renderContractTable(rows) {
  const tbody = document.querySelector("#contractTable tbody");
  const resultsCount = document.getElementById("resultsCount");
  if (!tbody) {
    return;
  }

  const valueRows = rows
    .map((row) => ({ row, value: contractValueForRow(row) }))
    .filter((entry) => entry.value.complete)
    .sort((a, b) => b.value.total - a.value.total);

  if (resultsCount) {
    resultsCount.textContent = `${valueRows.length} project${valueRows.length === 1 ? "" : "s"} with contract value`;
  }

  if (!valueRows.length) {
    tbody.innerHTML = `<tr><td colspan="5">No active projects with usable contract value.</td></tr>`;
    return;
  }

  tbody.innerHTML = valueRows
    .map(({ row, value }) => {
      const servicesNote = value.zeroFilled.includes("services") ? ' <small title="No Services line item found for this contract">(N/A)</small>' : "";
      const saasNote = value.zeroFilled.includes("saas") ? ' <small title="No SaaS line item found for this contract">(N/A)</small>' : "";
      return `
      <tr>
        <td><a href="${escapeHtml(row.url || "#")}" target="_blank">${escapeHtml(row.title || "Untitled")}</a></td>
        <td>${escapeHtml(formatGoLiveDate(row.go_live))}</td>
        <td>${formatCurrency(value.services)}${servicesNote}</td>
        <td>${formatCurrency(value.saas)}${saasNote}</td>
        <td>${formatCurrency(value.total)}</td>
      </tr>
    `;
    })
    .join("");
}

function renderServicesConsumptionTable(rows) {
  const tbody = document.querySelector("#servicesConsumptionTable tbody");
  const countLabel = document.getElementById("servicesConsumptionCount");
  if (!tbody) {
    return;
  }

  const entries = rows
    .map((row) => {
      const value = contractValueForRow(row);
      if (!value.complete) {
        return null;
      }
      const consumption = servicesConsumptionForRow(row, value);
      if (!consumption.available) {
        return null;
      }
      return { row, value, consumption };
    })
    .filter(Boolean)
    .sort((a, b) => b.consumption.remaining - a.consumption.remaining);

  if (countLabel) {
    countLabel.textContent = `${entries.length} project${entries.length === 1 ? "" : "s"} with a schedule model`;
  }

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="7">No active projects have both a services value and a usable start/go-live date.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries
    .map(({ row, value, consumption }) => {
      const durationLabel = consumption.isPlaceholder
        ? `${consumption.totalMonths}mo (assumed)`
        : `${consumption.totalMonths}mo`;
      const pctLabel = `${consumption.pctComplete.toFixed(1)}%`;
      return `
      <tr>
        <td><a href="${escapeHtml(row.url || "#")}" target="_blank">${escapeHtml(row.title || "Untitled")}</a></td>
        <td>${escapeHtml(formatGoLiveDate(row.go_live))}</td>
        <td>${durationLabel}</td>
        <td>${pctLabel}</td>
        <td>${formatCurrency(value.services)}</td>
        <td>${formatCurrency(consumption.consumed)}</td>
        <td>${formatCurrency(consumption.remaining)}</td>
      </tr>
    `;
    })
    .join("");
}

function initContractValueDashboard() {
  if (typeof dashboardMode !== "function" || dashboardMode() !== "contract-value") {
    return;
  }
  if (!state || !state.projects) {
    return;
  }

  const rows = currentContractValueRows();
  renderContractMetrics(rows);
  renderMissingTable(rows);
  renderContractTable(rows);
  renderServicesConsumptionTable(rows);
}

if (typeof window !== "undefined") {
  window.addEventListener("dashboardReady", () => {
    initContractValueDashboard();
  });

  if (typeof state !== "undefined" && state && state.projects && state.projects.length) {
    initContractValueDashboard();
  }
}
