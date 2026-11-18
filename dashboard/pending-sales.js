// Pending Sales tab: projects on the Central Project Portfolio list with status "Pending Sales".
const FILTERS = [
  ["regionFilter", (r) => regionOf(r)],
  ["stateFilter", (r) => stateOf(r)],
  ["repFilter", (r) => r.portfolio?.sales_rep || ""],
  ["imFilter", (r) => r.implementation_manager || ""],
];

const payload = window.PROJECT_DASHBOARD_DATA || { projects: [] };
const allRows = (payload.projects || []).filter((r) => r.project_status === "Pending Sales");

function regionOf(r) {
  return (r.region_state || "").split(" - ")[0].trim();
}

function stateOf(r) {
  const parts = (r.region_state || "").split(" - ");
  return parts.length > 1 ? parts[parts.length - 1].trim() : "";
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

function fmtMoney(n) {
  return typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "";
}

function productsOf(r) {
  const p = r.contracted_products;
  return Array.isArray(p) ? p.join(", ") : String(p || "").replace(/[\[\]']/g, "");
}

function populateFilters() {
  FILTERS.forEach(([id, get]) => {
    const values = [...new Set(allRows.map(get).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    document.getElementById(id).innerHTML =
      '<option value="">All</option>' + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  });
}

function filtered() {
  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  return allRows
    .filter((r) => FILTERS.every(([id, get]) => !document.getElementById(id).value || get(r) === document.getElementById(id).value))
    .filter((r) =>
      !q ||
      [r.title, r.portfolio?.sales_rep, r.implementation_manager, productsOf(r), r.portfolio?.legacy_system, r.region_state]
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
    .sort((a, b) => (a.portfolio?.expected_close_date || "9999").localeCompare(b.portfolio?.expected_close_date || "9999"));
}

function render() {
  const rows = filtered();
  const total = rows.reduce((t, r) => t + (r.portfolio?.contract_total || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const closingSoon = rows.filter((r) => {
    const d = r.portfolio?.expected_close_date || "";
    return d && d >= today && d <= in30;
  }).length;
  const pastDue = rows.filter((r) => (r.portfolio?.expected_close_date || "9999") < today).length;
  const cards = [
    ["Pending Projects", rows.length],
    ["Contract Total", fmtMoney(total) || "$0"],
    ["Closing in 30 Days", closingSoon],
    ["Past Expected Close", pastDue],
  ];
  document.getElementById("psMetrics").innerHTML = cards
    .map(([label, value]) => `<div class="metric"><h3>${label}</h3><p>${value}</p></div>`)
    .join("");

  document.getElementById("resultsCount").textContent = `${rows.length} of ${allRows.length} projects`;
  document.querySelector("#psTable tbody").innerHTML = rows
    .map((r) => {
      const link = /^https?:\/\//.test(r.url || "")
        ? `<a class="project-link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>`
        : esc(r.title);
      return `
      <tr>
        <td>${link}</td>
        <td>${esc(r.region_state)}</td>
        <td>${esc(fmtDate(r.portfolio?.expected_close_date))}</td>
        <td>${esc(fmtDate(r.implementation_start_date))}</td>
        <td>${esc(fmtMoney(r.portfolio?.contract_total))}</td>
        <td>${esc(r.portfolio?.contract_type)}</td>
        <td>${esc(productsOf(r))}</td>
        <td>${esc(r.portfolio?.sales_rep)}</td>
        <td>${esc(r.implementation_manager)}</td>
        <td>${esc(r.portfolio?.legacy_system)}</td>
      </tr>`;
    })
    .join("");
}

document.getElementById("stamp").textContent = payload.generated_at
  ? `Last generated: ${new Date(payload.generated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
  : "No dataset loaded yet.";

populateFilters();
document.getElementById("searchInput").addEventListener("input", render);
FILTERS.forEach(([id]) => document.getElementById(id).addEventListener("change", render));
render();
