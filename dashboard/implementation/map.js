// Project Map: US states shaded by project count, contract value or planned hours.

// One-hue sequential ramp (blue, light to dark) for magnitude. Zero gets its own neutral.
const MAP_RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const MAP_ZERO = "#eceae4";
const MAP_INK = "#0b0b0b";
const MAP_SVG = "http://www.w3.org/2000/svg";
// States too small to hold their label get a callout in the Atlantic, in this order (north to south).
const MAP_CALLOUTS = ["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", "DC"];
const MAP_CALLOUT_X = 936;
const MAP_CALLOUT_Y0 = 128;
const MAP_CALLOUT_STEP = 22;
const MAP_LABEL_MIN_AREA = 1500;

const mapState = { closed: [], scope: "active", metric: "count", region: "", selected: "", byState: new Map(), max: 0 };

function mapRows() {
  const active = state.projects || [];
  const seen = new Set(active.map((row) => row.page_id || row.title));
  const closed = mapState.closed.filter((row) => !seen.has(row.page_id || row.title));
  const rows = mapState.scope === "active" ? active : mapState.scope === "went-live" ? mapState.closed : [...active, ...closed];
  return rows
    .filter((row) => row.portfolio?.list_status !== "Pending Sales" && row.project_status !== "Pending Sales")
    .filter((row) => projectInRegionOption(row, mapState.region));
}

function mapContractValue(row) {
  const value = contractValueForRow(row);
  return value.complete ? value.saas + value.services : 0;
}

function mapAggregate() {
  const byState = new Map();
  mapRows().forEach((row) => {
    const code = projectState(row);
    if (!window.US_STATES[code]) return;
    const entry = byState.get(code) || { code, count: 0, value: 0, hours: 0, rows: [] };
    entry.count += 1;
    entry.value += mapContractValue(row);
    entry.hours += plannedHoursOf(row);
    entry.rows.push(row);
    byState.set(code, entry);
  });
  mapState.byState = byState;
  mapState.max = Math.max(0, ...[...byState.values()].map((entry) => entry[mapState.metric === "count" ? "count" : mapState.metric]));
}

const mapMetricValue = (entry) => (entry ? entry[mapState.metric === "count" ? "count" : mapState.metric] : 0);

function mapFormat(metric, value) {
  if (metric === "value") {
    if (value >= 1e6) return `$${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
    if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
    return `$${Math.round(value)}`;
  }
  if (metric === "hours") return `${Math.round(value).toLocaleString()} hrs`;
  return `${value.toLocaleString()} project${value === 1 ? "" : "s"}`;
}

// Seven classes on a square-root scale, so one or two heavy states do not wash out the rest.
function mapClass(value) {
  if (!value || !mapState.max) return -1;
  return Math.min(MAP_RAMP.length - 1, Math.floor(Math.sqrt(value / mapState.max) * MAP_RAMP.length));
}

function mapFill(value) {
  const index = mapClass(value);
  return index < 0 ? MAP_ZERO : MAP_RAMP[index];
}

const mapLabelColor = (value) => (mapClass(value) >= 3 ? "#ffffff" : MAP_INK);

function svgEl(name, attrs = {}, text) {
  const element = document.createElementNS(MAP_SVG, name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function mapTooltipHtml(code) {
  const entry = mapState.byState.get(code);
  const tooltip = document.getElementById("mapTooltip");
  tooltip.textContent = "";
  const name = document.createElement("div");
  name.className = "tt-name";
  name.textContent = window.US_STATES[code].name;
  const value = document.createElement("div");
  value.className = "tt-value";
  value.textContent = mapFormat(mapState.metric, mapMetricValue(entry));
  tooltip.append(name, value);
  if (entry && mapState.metric !== "count") {
    const extra = document.createElement("div");
    extra.className = "tt-extra";
    extra.textContent = mapFormat("count", entry.count);
    tooltip.append(extra);
  }
}

function mapShowTooltip(code, event, element) {
  const tooltip = document.getElementById("mapTooltip");
  mapTooltipHtml(code);
  tooltip.style.display = "block";
  const box = element.getBoundingClientRect();
  const x = event && event.clientX ? event.clientX : box.left + box.width / 2;
  const y = event && event.clientY ? event.clientY : box.top;
  tooltip.style.left = `${Math.min(x + 14, window.innerWidth - 270)}px`;
  tooltip.style.top = `${Math.max(8, y - 12 - tooltip.offsetHeight)}px`;
}

function mapHideTooltip() {
  document.getElementById("mapTooltip").style.display = "none";
}

function renderMap() {
  const svg = document.getElementById("usMap");
  svg.textContent = "";
  const shapes = svgEl("g");
  const labels = svgEl("g");
  Object.entries(window.US_STATES).forEach(([code, geo]) => {
    const entry = mapState.byState.get(code);
    const value = mapMetricValue(entry);
    const path = svgEl("path", {
      d: geo.d,
      fill: mapFill(value),
      class: `state${mapState.selected === code ? " is-selected" : ""}`,
      tabindex: "0",
      role: "button",
      "aria-label": `${geo.name}: ${mapFormat(mapState.metric, value)}`,
    });
    path.addEventListener("pointermove", (event) => mapShowTooltip(code, event, path));
    path.addEventListener("pointerleave", mapHideTooltip);
    path.addEventListener("focus", () => mapShowTooltip(code, null, path));
    path.addEventListener("blur", mapHideTooltip);
    path.addEventListener("click", () => selectMapState(code));
    path.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMapState(code);
      }
    });
    shapes.append(path);

    const calloutIndex = MAP_CALLOUTS.indexOf(code);
    if (calloutIndex >= 0) {
      const y = MAP_CALLOUT_Y0 + calloutIndex * MAP_CALLOUT_STEP;
      labels.append(
        svgEl("path", { d: `M${geo.cx},${geo.cy}L${MAP_CALLOUT_X - 6},${y}`, class: "callout-line" }),
        svgEl("rect", { x: MAP_CALLOUT_X - 4, y: y - 6, width: 12, height: 12, fill: mapFill(value), stroke: "#898781", "stroke-width": 0.8 }),
        svgEl("text", { x: MAP_CALLOUT_X + 12, y, class: "callout-label" }, code),
      );
    } else if (code === "HI") {
      labels.append(svgEl("text", { x: geo.cx, y: geo.cy + 20, class: "state-label", fill: MAP_INK }, code));
    } else if (geo.area >= MAP_LABEL_MIN_AREA) {
      labels.append(svgEl("text", { x: geo.cx, y: geo.cy, class: "state-label", fill: mapLabelColor(value) }, code));
    }
  });
  svg.append(shapes, labels);
}

function renderMapLegend() {
  const legend = document.getElementById("mapLegend");
  legend.textContent = "";
  const block = document.createElement("div");
  const ramp = document.createElement("div");
  ramp.className = "ramp";
  MAP_RAMP.forEach((color) => {
    const swatch = document.createElement("span");
    swatch.style.background = color;
    ramp.append(swatch);
  });
  const labels = document.createElement("div");
  labels.className = "ramp-labels";
  const low = document.createElement("span");
  low.textContent = mapState.metric === "count" ? "1" : "above 0";
  const high = document.createElement("span");
  high.textContent = mapState.max ? mapFormat(mapState.metric, mapState.max) : "none";
  labels.append(low, high);
  block.append(ramp, labels);
  const zero = document.createElement("span");
  zero.className = "zero";
  const zeroSwatch = document.createElement("i");
  zero.append(zeroSwatch, document.createTextNode("No projects"));
  legend.append(block, zero);
}

function renderMapMetrics() {
  const entries = [...mapState.byState.values()];
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  const top = [...entries].sort((a, b) => mapMetricValue(b) - mapMetricValue(a))[0];
  const cards = [
    { label: "Projects on the map", value: total.toLocaleString() },
    { label: "States with projects", value: entries.length },
    { label: "Contract value", value: mapFormat("value", entries.reduce((sum, entry) => sum + entry.value, 0)) },
    { label: "Planned hours", value: Math.round(entries.reduce((sum, entry) => sum + entry.hours, 0)).toLocaleString() },
    { label: "Top state", value: top ? `${top.code}: ${mapFormat(mapState.metric, mapMetricValue(top)).replace(/ projects?$/, "")}` : "—" },
  ];
  const container = document.getElementById("mapMetrics");
  container.textContent = "";
  cards.forEach((card) => {
    const article = document.createElement("article");
    article.className = "metric";
    const h3 = document.createElement("h3");
    h3.textContent = card.label;
    const p = document.createElement("p");
    p.textContent = card.value;
    article.append(h3, p);
    container.append(article);
  });
}

function renderMapTable() {
  const tbody = document.querySelector("#mapTable tbody");
  tbody.textContent = "";
  [...mapState.byState.values()]
    .sort((a, b) => mapMetricValue(b) - mapMetricValue(a) || a.code.localeCompare(b.code))
    .forEach((entry) => {
      const tr = document.createElement("tr");
      [window.US_STATES[entry.code].name, entry.count, formatCurrency(entry.value), Math.round(entry.hours).toLocaleString()].forEach((text) => {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      });
      tbody.append(tr);
    });
  if (!tbody.children.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "No projects match these filters.";
    tr.append(td);
    tbody.append(tr);
  }
}

function renderStateDetail() {
  const code = mapState.selected;
  const title = document.getElementById("stateProjectsTitle");
  const note = document.getElementById("stateProjectsNote");
  const list = document.getElementById("stateProjectsList");
  list.textContent = "";
  if (!code) {
    title.textContent = "State detail";
    note.textContent = "Click a state on the map to list its projects.";
    return;
  }
  const entry = mapState.byState.get(code);
  title.textContent = window.US_STATES[code].name;
  if (!entry) {
    note.textContent = "No projects match the current filters in this state.";
    return;
  }
  note.textContent = `${mapFormat("count", entry.count)}, ${mapFormat("value", entry.value)} contract value, ${Math.round(entry.hours).toLocaleString()} planned hours.`;
  const ul = document.createElement("ul");
  [...entry.rows]
    .sort((a, b) => String(a.title).localeCompare(String(b.title)))
    .forEach((row) => {
      const li = document.createElement("li");
      li.append(document.createTextNode(row.title));
      const small = document.createElement("small");
      const goLive = row.go_live ? `go-live ${row.go_live}` : "no go-live date";
      small.textContent = `  ${row.portfolio?.list_status || row.project_status || ""}, ${goLive}`;
      li.append(small);
      ul.append(li);
    });
  list.append(ul);
}

function selectMapState(code) {
  mapState.selected = mapState.selected === code ? "" : code;
  renderMapAll();
}

function renderMapAll() {
  mapAggregate();
  const scopeText = { active: "active projects", "went-live": "projects that went live", all: "all projects" }[mapState.scope];
  const metricText = { count: "number of projects", value: "contract value", hours: "planned hours" }[mapState.metric];
  document.getElementById("mapTitle").textContent = `${scopeText[0].toUpperCase()}${scopeText.slice(1)} by state, shaded by ${metricText}`;
  renderMapMetrics();
  renderMap();
  renderMapLegend();
  renderStateDetail();
  renderMapTable();
}

let mapInitStarted = false;

async function initMapDashboard() {
  if (typeof dashboardMode !== "function" || dashboardMode() !== "map") return;
  if (!state || !state.projects || mapInitStarted) return;
  mapInitStarted = true;
  try {
    const response = await fetch("./data/closed_projects.json", { cache: "no-store" });
    mapState.closed = response.ok ? (await response.json()).projects || [] : [];
  } catch (error) {
    mapState.closed = [];
  }
  const regionSelect = document.getElementById("mapRegion");
  REGION_FILTER_OPTIONS.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    regionSelect.append(option);
  });
  // Links can preselect the view: map.html?scope=all&metric=value&region=Central&state=TX
  const params = new URLSearchParams(window.location.search);
  [["mapScope", "scope"], ["mapMetric", "metric"], ["mapRegion", "region"]].forEach(([id, key]) => {
    const element = document.getElementById(id);
    if (params.has(key)) element.value = params.get(key);
    mapState[key] = element.value || mapState[key];
    element.value = mapState[key];
    element.addEventListener("change", () => {
      mapState[key] = element.value;
      mapState.selected = "";
      renderMapAll();
    });
  });
  const wanted = (params.get("state") || "").toUpperCase();
  if (window.US_STATES[wanted]) mapState.selected = wanted;
  renderMapAll();
}

if (typeof window !== "undefined") {
  window.addEventListener("dashboardReady", initMapDashboard);
  if (typeof state !== "undefined" && state && state.projects && state.projects.length) {
    initMapDashboard();
  }
}
