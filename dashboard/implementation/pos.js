// POs tab: contract / PO / amendment routings from the SharePoint list (see load_po_csv.py).
const PO_FILTERS = [
  ["routingTypeFilter", "routing_type"],
  ["psaFilter", "psa_status"],
  ["contractTypeFilter", "contract_type"],
  ["oppFilter", "opportunity_type"],
  ["teamFilter", "team"],
  ["stateFilter", "state"],
  ["repFilter", "sales_rep"],
];

const poData = window.PO_DASHBOARD_DATA || { pos: [] };
const allPos = poData.pos || [];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function daysText(r) {
  return [r.api_days, r.report_days, r.training_days, r.conversion_days].map((n) => n || 0).join(" / ");
}

function populateFilters() {
  PO_FILTERS.forEach(([id, key]) => {
    const values = [...new Set(allPos.map((r) => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    document.getElementById(id).innerHTML =
      '<option value="">All</option>' + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  });
}

function filteredPos() {
  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  return allPos.filter((r) => {
    for (const [id, key] of PO_FILTERS) {
      const v = document.getElementById(id).value;
      if (v && r[key] !== v) return false;
    }
    if (!q) return true;
    return [r.client, r.quote, r.sales_rep, r.project_manager, r.implementation_manager, r.order_comments, r.products, r.account, r.psa_project_name]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

function renderBars(id, counts, sortByKey) {
  let entries = Object.entries(counts);
  entries = sortByKey ? entries.sort((a, b) => a[0].localeCompare(b[0])) : entries.sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  document.getElementById(id).innerHTML = entries.length
    ? entries
        .map(
          ([label, n]) =>
            `<div class="po-bar-row"><span>${esc(label)}</span><div class="po-bar-track"><div class="po-bar-fill" style="width:${(n / max) * 100}%"></div></div><strong>${n}</strong></div>`
        )
        .join("")
    : '<p class="po-note">No data.</p>';
}

function tally(rows, fn) {
  const out = {};
  rows.forEach((r) => {
    const k = fn(r) || "(blank)";
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

function monthLabel(iso) {
  const [y, m] = iso.split("-");
  return `${y}-${m}`;
}

function render() {
  const rows = filteredPos();
  const sum = (k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
  const clients = new Set(rows.map((r) => r.client)).size;
  const cards = [
    ["Routings", rows.length],
    ["Clients", clients],
    ["API Consulting Days", sum("api_days")],
    ["Report Dev Days", sum("report_days")],
    ["Training Days", sum("training_days")],
    ["Conversion Days", sum("conversion_days")],
  ];
  document.getElementById("poMetrics").innerHTML = cards
    .map(([label, value]) => `<div class="metric"><h3>${label}</h3><p>${value}</p></div>`)
    .join("");

  renderBars("byMonth", tally(rows, (r) => monthLabel(r.routing_date_iso)), true);
  renderBars("byRoutingType", tally(rows, (r) => r.routing_type));
  renderBars("byOpp", tally(rows, (r) => r.opportunity_type));
  renderBars("byPsa", tally(rows, (r) => r.psa_status));

  document.getElementById("resultsCount").textContent = `${rows.length} of ${allPos.length} routings`;
  document.querySelector("#poTable tbody").innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${esc(fmtDate(r.routing_date_iso))}</td>
        <td>${esc(r.client)}</td>
        <td>${esc(r.state)}</td>
        <td>${esc(r.quote)}</td>
        <td>${esc(r.routing_type)}</td>
        <td>${esc(r.contract_type)}</td>
        <td>${esc(r.opportunity_type)}</td>
        <td>${esc(r.psa_status)}</td>
        <td>${esc(r.sales_rep)}</td>
        <td>${esc(r.project_manager)}</td>
        <td>${esc(daysText(r))}</td>
        <td>${esc(r.order_comments)}</td>
        <td>${/^https?:\/\//.test(r.document_link) ? `<a href="${esc(r.document_link)}" target="_blank" rel="noopener">Open</a>` : ""}</td>
      </tr>`
    )
    .join("");
}

document.getElementById("stamp").textContent = poData.generated_at
  ? `Last generated: ${new Date(poData.generated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} | Routed ${fmtDate(poData.cutoff)} or later`
  : "No PO data loaded yet. Export the Routing list to CSV and run load_po_csv.py.";

populateFilters();
document.getElementById("searchInput").addEventListener("input", render);
PO_FILTERS.forEach(([id]) => document.getElementById(id).addEventListener("change", render));
render();
