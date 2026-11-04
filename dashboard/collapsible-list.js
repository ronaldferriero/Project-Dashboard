// Collapsible lists: long tables and card lists show their first rows with "Show all N" / "Show first N".
// One document click listener serves every list on the page; each list registers the function that
// re-renders it, so a toggle redraws only that list. State lasts for the page load.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CollapsibleList = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const LIMIT = 10;
  const CARD_LIMIT = 6;
  let expanded = new Set();
  let renderers = new Map();
  let installed = false;

  function escape(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function isExpanded(key) {
    return expanded.has(key);
  }

  function setExpanded(key, value) {
    if (value) expanded.add(key);
    else expanded.delete(key);
  }

  function reset() {
    expanded = new Set();
    renderers = new Map();
  }

  function visibleRows(rows, key, limit = LIMIT) {
    const list = rows || [];
    if (list.length <= limit || isExpanded(key)) return list;
    return list.slice(0, limit);
  }

  function toggleHtml({ key, total, limit = LIMIT, noun, controls }) {
    if (!total || total <= limit) return "";
    const open = isExpanded(key);
    const status = open ? `Showing all ${total} ${noun}` : `Showing ${limit} of ${total} ${noun}`;
    const label = open ? `Show first ${limit}` : `Show all ${total} ${noun}`;
    return `
      <span class="list-toggle-status">${escape(status)}</span>
      <button type="button" class="action-button action-button-secondary forge-button forge-button--outlined list-toggle-button"
        data-collapse-key="${escape(key)}" aria-expanded="${open}" aria-controls="${escape(controls)}">${escape(label)}</button>
    `;
  }

  function findButton(key) {
    if (typeof document === "undefined" || !document.querySelectorAll) return null;
    return [...document.querySelectorAll("[data-collapse-key]")].find((el) => el.dataset.collapseKey === key) || null;
  }

  function handleClick(event) {
    const button = event && event.target && event.target.closest ? event.target.closest("[data-collapse-key]") : null;
    if (!button) return false;
    const key = button.dataset.collapseKey;
    const nowOpen = !isExpanded(key);
    setExpanded(key, nowOpen);
    const rerender = renderers.get(key);
    if (rerender) rerender();
    const next = findButton(key);
    if (next) {
      next.focus({ preventScroll: true });
      // Collapsing removes rows above the button; keep it in view.
      if (!nowOpen && next.scrollIntoView) next.scrollIntoView({ block: "nearest" });
    }
    return true;
  }

  function install() {
    if (installed || typeof document === "undefined" || !document.addEventListener) return;
    document.addEventListener("click", handleClick);
    installed = true;
  }

  function register(key, rerender) {
    renderers.set(key, rerender);
    install();
  }

  return { LIMIT, CARD_LIMIT, isExpanded, setExpanded, reset, visibleRows, toggleHtml, register, handleClick };
});
