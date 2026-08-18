// Contract Value Dashboard Logic

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

function renderContractMetrics(rows) {
  const container = document.getElementById("contractMetrics");
  if (!container) {
    return;
  }

  let totalSaas = 0;
  let totalServices = 0;
  let withValue = 0;
  let missing = 0;

  rows.forEach((row) => {
    const value = contractValueForRow(row);
    if (value.complete) {
      totalSaas += value.saas;
      totalServices += value.services;
      withValue += 1;
    } else {
      missing += 1;
    }
  });

  const cards = [
    { label: "Active Projects", value: rows.length },
    { label: "Total SaaS", value: formatCurrency(totalSaas), tone: "blue" },
    { label: "Total Services", value: formatCurrency(totalServices), tone: "blue" },
    { label: "Total Contract Value", value: formatCurrency(totalSaas + totalServices), tone: "green" },
    {
      label: "Missing Contract Data",
      value: missing,
      tone: missing ? "yellow" : "green",
      detail: `${withValue} of ${rows.length} projects have usable data`,
    },
  ];

  container.innerHTML = "";
  cards.forEach(({ label, value, tone, detail }) => {
    const card = document.createElement("article");
    card.className = tone ? `metric metric-${tone}` : "metric";
    card.innerHTML = `<h3>${label}</h3><p>${value}</p>${detail ? `<div class="metric-detail">${detail}</div>` : ""}`;
    container.appendChild(card);
  });
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
}

if (typeof window !== "undefined") {
  window.addEventListener("dashboardReady", () => {
    initContractValueDashboard();
  });

  if (typeof state !== "undefined" && state && state.projects && state.projects.length) {
    initContractValueDashboard();
  }
}
