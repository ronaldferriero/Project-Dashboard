// Tests for dashboard/peer-model.js (tier classification and peer benchmarks). Synthetic inputs only.
const assert = require("assert");
const P = require("../dashboard/peer-model.js");

const light = P.classify({ products: ["Tyler Cashiering", "E-Reviews", "Workforce Mobile"], value: 90000, hosting: "SaaS", title: "[SAMPLE] A" });
assert.strictEqual(light.tier, "Low");
assert.strictEqual(light.confidence, "high");

const complex = P.classify({
  products: ["EP&L Community Development", "EP&L Business Management", "EP&L Environmental Health", "Tyler Cashiering",
    "Workforce Mobile", "D&I Executive Insights", "Content Manager", "Enterprise Service Request (ESR)", "Civic Access CD", "EERP"],
  value: 900000,
  hosting: "SaaS",
  title: "[SAMPLE] B",
});
assert.strictEqual(complex.tier, "High");

// Missing data degrades confidence instead of failing.
assert.strictEqual(P.classify({ products: [], value: null }).tier, null);
const valueOnly = P.classify({ products: [], value: 500000 });
assert.strictEqual(valueOnly.tier, "High");
assert.strictEqual(valueOnly.confidence, "low");

// On-prem raises and Phase 2 lowers complexity.
const base = { products: ["Tyler Cashiering"], value: null, title: "x" };
assert.strictEqual(P.classify({ ...base, hosting: "On-Prem" }).dims.complexity, 1);
assert.strictEqual(P.classify({ ...base, hosting: "SaaS" }).dims.complexity, 0);
assert.strictEqual(P.classify({ ...base, hosting: "SaaS", title: "Town P2" }).dims.complexity, 0);

// Level = number of core modules (Community Development, Business Management, Environmental Health).
const core = (n) => ["EP&L Community Development", "EP&L Business Management", "EP&L Environmental Health"].slice(0, n);
assert.strictEqual(P.classify({ products: core(1), value: 1 }).level, 1);
assert.strictEqual(P.classify({ products: core(2), value: 1 }).level, 2);
assert.strictEqual(P.classify({ products: core(3), value: 1 }).label, "Low 3");
// Portal products of the same line do not add a level; non-core products leave the level unknown.
assert.strictEqual(P.classify({ products: ["EP&L Community Development", "Civic Access CD"], value: 1 }).level, 1);
const noCore = P.classify({ products: ["Tyler Cashiering"], value: 1 });
assert.strictEqual(noCore.level, null);
assert.strictEqual(noCore.label, noCore.tier);
assert.strictEqual(P.allLabels().length, 12);

// Benchmarks fall back level -> tier -> portfolio.
const completed = [
  ...[8, 9, 10, 11, 12].map((m) => ({ tier: "Low", level: 1, label: "Low 1", ttvMonths: m })),
  ...[14, 15, 16, 17, 18].map((m) => ({ tier: "Low", level: 2, label: "Low 2", ttvMonths: m })),
  { tier: "High", level: 3, label: "High 3", ttvMonths: 20 },
];
const stats = P.peerStats(completed);
assert.strictEqual(stats.byLabel["Low 1"].median, 10);
assert.strictEqual(P.benchmarkFor({ tier: "Low", level: 1, label: "Low 1" }, stats).basis, "Low 1");
assert.strictEqual(P.benchmarkFor({ tier: "Low", level: 3, label: "Low 3" }, stats).basis, "Low");
assert.strictEqual(P.benchmarkFor({ tier: "Low", level: null, label: "Low" }, stats).basis, "Low");
assert.strictEqual(P.benchmarkFor({ tier: "High", level: 3, label: "High 3" }, stats).basis, "All projects");
assert.strictEqual(P.benchmarkFor(null, stats).basis, "All projects");
assert.strictEqual(P.summarize([]).median, null);

console.log("peer model tests passed");
