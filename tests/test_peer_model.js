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
// With no core module listed the level is assumed to be 1, so every classified project has a number.
const noCore = P.classify({ products: ["Tyler Cashiering"], value: 1 });
assert.strictEqual(noCore.level, 1);
assert.strictEqual(noCore.label, `${noCore.tier} 1`);
assert.strictEqual(noCore.coreAssumed, true);
assert.strictEqual(P.classify({ products: [], value: 500000 }).level, 1);
assert.strictEqual(P.levelLabels().length, 9);
assert.deepStrictEqual(P.allLabels().slice(0, 3), ["Low", "Medium", "High"]);
assert.strictEqual(P.allLabels().length, 12);

// A bare tier filter matches every level in that tier; a level filter matches only itself.
assert.strictEqual(P.matchesLabel({ tier: "Low", label: "Low 2" }, "Low"), true);
assert.strictEqual(P.matchesLabel({ tier: "Low", label: "Low 2" }, "Low 2"), true);
assert.strictEqual(P.matchesLabel({ tier: "Low", label: "Low 2" }, "Low 3"), false);
assert.strictEqual(P.matchesLabel({ tier: "Low", label: "Low 2" }, "Medium"), false);
assert.strictEqual(P.matchesLabel(null, ""), true);

// Manual overrides replace the automatic label and keep a record of it.
const forced = P.applyOverride(noCore, "Medium 2");
assert.strictEqual(forced.label, "Medium 2");
assert.strictEqual(forced.level, 2);
assert.strictEqual(forced.autoLabel, noCore.label);
assert.strictEqual(P.applyOverride(noCore, "Bogus 9"), noCore);
assert.strictEqual(P.applyOverride(noCore, ""), noCore);

// "Enterprise Service Request" contains the letters "erp" but is workflow, not ERP/finance.
assert.deepStrictEqual(P.productLines(["Enterprise Service Request (ESR)"]), ["Workflow / Service Request"]);
assert.deepStrictEqual(P.productLines(["ERP Pro 10", "EERP"]), ["ERP / Finance"]);

// Product names listed in dashboard/category-guide.html map to the lines the guide says they do.
const guide = {
  "Community Development": ["EP&L Community Development", "Civic Access CD", "DigEplan"],
  "Business Management": ["EP&L Business Management", "Civic Access BM"],
  "Environmental Health": ["EP&L Environmental Health", "Civic Access EH"],
  "ERP / Finance": ["EAM", "EERP", "ERP Pro", "ERP Pro 10", "New World ERP", "Enterprise Assessment and Tax"],
  Payments: ["Tyler Cashiering"],
  "Field / Mobile": ["Workforce Mobile", "Fire Prevention Mobile"],
  Analytics: ["D&I Citizen Connect", "D&I Executive Insights"],
  "Content / Plan Review": ["Content Manager", "E-Reviews"],
  "Workflow / Service Request": ["Decision Engine", "Enterprise Service Request (ESR)"],
  "Resident Portal": ["Civic Access CD", "Civic Access BM", "Civic Access EH", "My Civic", "My Civic Bundle", "Resident Assistant", "Resident AI Assistant"],
};
Object.entries(guide).forEach(([line, names]) =>
  names.forEach((name) => assert(P.productLines([name]).includes(line), `${name} should count toward ${line}`)));

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
