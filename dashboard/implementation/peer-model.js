// Peer-group model: classifies projects into comparable tiers (Low / Medium / High) so timelines are
// compared like-for-like. Pure functions, no DOM access, so it can be unit tested in node.
//
// Level (1-3) = how many of the three core modules (Community Development, Business Management, Environmental
// Health) are contracted. Tier (Low / Medium / High) comes from the factors listed in CONFIG.tierFactors, each
// scored 0 (small) .. 2 (large) and averaged over the ones with data. Right now only contract value is used; the
// other factors below are kept so they can be switched back on by adding them to tierFactors.
//   scope      - total number of contracted products
//   value      - Services + SaaS contract value
//   complexity - number of non-core product lines, +1 for on-prem hosting, -1 for a Phase 2 add-on
// Three more dimensions are scored only when the data source supplies them (row.complexity_inputs):
//   integrations  - count of integration points (Tyler-to-Tyler and third-party)
//   conversion    - count of modules with data conversion
//   customization - count of custom form/report development items
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PeerModel = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const CONFIG = {
    // [upper bound of tier 0, upper bound of tier 1]; anything above is tier 2.
    moduleBands: [5, 8],
    valueBands: [200000, 450000],
    lineBands: [1, 3],
    integrationsBands: [1, 3],
    conversionBands: [0, 1],
    customizationBands: [4, 10],
    // Factors that decide the tier. Any of: scope, value, complexity, integrations, conversion, customization.
    tierFactors: ["value"],
    tierCutoffs: [0.67, 1.34],
    tierNames: ["Low", "Medium", "High"],
    levelsPerTier: 3,
    minPeerSample: 5,
  };

  const CORE_LINES = ["Community Development", "Business Management", "Environmental Health"];

  // Product line -> pattern. A line counts once no matter how many of its products are contracted.
  const PRODUCT_LINES = [
    ["Community Development", /community development|\bcd\b|digeplan/i],
    ["Business Management", /business management|\bbm\b/i],
    ["Environmental Health", /environmental health|\beh\b/i],
    ["ERP / Finance", /\berp\b|\beerp\b|enterprise assessment|\bnew world\b|\beam\b/i],
    ["Payments", /cashiering/i],
    ["Field / Mobile", /mobile/i],
    ["Analytics", /d&i|executive insights|citizen connect/i],
    ["Content / Plan Review", /content manager|e-reviews/i],
    ["Workflow / Service Request", /service request|decision engine/i],
    ["Resident Portal", /civic access|my civic|resident/i],
  ];

  function bandScore(value, bands) {
    if (value <= bands[0]) return 0;
    if (value <= bands[1]) return 1;
    return 2;
  }

  function productLines(products) {
    const list = Array.isArray(products) ? products : [];
    const found = [];
    PRODUCT_LINES.forEach(([name, pattern]) => {
      if (list.some((product) => pattern.test(String(product || "")))) {
        found.push(name);
      }
    });
    return found;
  }

  function isOnPrem(hosting) {
    return /on[\s-]?prem|self[\s-]?hosted|on perm/i.test(String(hosting || ""));
  }

  function isPhaseTwo(title) {
    return /\bP2\b|phase\s*2|add-?on/i.test(String(title || ""));
  }

  // input: { products: string[], value: number|null, hosting: string, title: string }
  function classify(input, config = CONFIG) {
    const products = Array.isArray(input?.products) ? input.products.filter(Boolean) : [];
    const dims = {};
    const reasons = [];

    const uses = (factor) => config.tierFactors.includes(factor);

    if (uses("scope") && products.length) {
      dims.scope = bandScore(products.length, config.moduleBands);
      reasons.push(`${products.length} modules`);
    }
    if (uses("value") && typeof input?.value === "number" && input.value > 0) {
      dims.value = bandScore(input.value, config.valueBands);
      reasons.push(input.value >= 1000000 ? `$${(input.value / 1000000).toFixed(1)}M contract` : `$${Math.round(input.value / 1000)}K contract`);
    }
    [
      ["integrations", "integration points"],
      ["conversion", "modules converting data"],
      ["customization", "custom form/report items"],
    ].forEach(([key, label]) => {
      const count = input?.[key];
      if (uses(key) && typeof count === "number" && count >= 0) {
        dims[key] = bandScore(count, config[`${key}Bands`]);
        reasons.push(`${count} ${label}`);
      }
    });
    const lines = productLines(products);
    const coreLines = lines.filter((name) => CORE_LINES.includes(name));
    const extraLines = lines.filter((name) => !CORE_LINES.includes(name));
    if (uses("complexity") && products.length) {
      let complexity = bandScore(extraLines.length, config.lineBands);
      reasons.push(`${extraLines.length} add-on product lines`);
      if (isOnPrem(input?.hosting)) {
        complexity = Math.min(2, complexity + 1);
        reasons.push("on-prem");
      }
      if (isPhaseTwo(input?.title)) {
        complexity = Math.max(0, complexity - 1);
        reasons.push("phase 2 add-on");
      }
      dims.complexity = complexity;
    }

    const scores = Object.values(dims);
    if (!scores.length) {
      return { tier: null, level: null, label: null, score: null, confidence: "none", dims, lines, reasons: ["no data for the tier factors"] };
    }
    const score = scores.reduce((sum, n) => sum + n, 0) / scores.length;
    const tierIndex = score < config.tierCutoffs[0] ? 0 : score < config.tierCutoffs[1] ? 1 : 2;
    const tier = config.tierNames[tierIndex];
    // Level is the number of core modules. A project always has at least one, so when none is listed
    // (empty product list, or only non-core products) the level is assumed to be 1.
    const coreAssumed = coreLines.length === 0;
    const level = Math.max(1, Math.min(config.levelsPerTier, coreLines.length));
    reasons.push(coreAssumed ? "no core module listed, level assumed 1" : `${coreLines.length} core module${coreLines.length === 1 ? "" : "s"}`);
    const confidence = scores.length >= Math.min(3, config.tierFactors.length) ? "high" : scores.length === 2 ? "medium" : "low";
    return { tier, level, label: `${tier} ${level}`, score, confidence, dims, lines, coreLines, coreAssumed, reasons };
  }

  // Integration / conversion / customization counts from a project row, or nulls when the source has none.
  function extraInputs(row) {
    const inputs = row?.complexity_inputs || {};
    const pick = (key) => (typeof inputs[key] === "number" ? inputs[key] : null);
    return { integrations: pick("integrations"), conversion: pick("conversion"), customization: pick("customization") };
  }

  // Apply a manual override label ("Medium 2", or a bare tier like "High") on top of an automatic classification.
  function applyOverride(classification, label, config = CONFIG) {
    const text = String(label || "").trim();
    if (!text) return classification;
    const [tier, levelText] = text.split(" ");
    if (!config.tierNames.includes(tier)) return classification;
    const level = levelText ? Number(levelText) : null;
    if (levelText && !(level >= 1 && level <= config.levelsPerTier)) return classification;
    return { ...classification, tier, level, label: text, overridden: true, autoLabel: classification.label, confidence: "manual" };
  }

  function percentile(sorted, fraction) {
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  }

  function summarize(values) {
    const sorted = values.filter((n) => typeof n === "number" && !Number.isNaN(n)).sort((a, b) => a - b);
    if (!sorted.length) {
      return { n: 0, median: null, mean: null, p25: null, p75: null };
    }
    return {
      n: sorted.length,
      median: percentile(sorted, 0.5),
      mean: sorted.reduce((sum, n) => sum + n, 0) / sorted.length,
      p25: percentile(sorted, 0.25),
      p75: percentile(sorted, 0.75),
    };
  }

  // Outlier fences by the 1.5 x IQR rule: values above `high` or below `low` are outliers. Null when the sample
  // is too small (fewer than 4 values) for quartiles to mean anything.
  function outlierFences(values) {
    const stat = summarize(values);
    if (stat.n < 4) return { low: null, high: null };
    const spread = (stat.p75 - stat.p25) * 1.5;
    return { low: stat.p25 - spread, high: stat.p75 + spread };
  }

  function isOutlier(value, fences) {
    return typeof value === "number" && ((fences.high !== null && value > fences.high) || (fences.low !== null && value < fences.low));
  }

  // Tier + level labels, e.g. "Low 1" .. "High 3".
  function levelLabels(config = CONFIG) {
    const labels = [];
    config.tierNames.forEach((tier) => {
      for (let level = 1; level <= config.levelsPerTier; level += 1) labels.push(`${tier} ${level}`);
    });
    return labels;
  }

  // Filter choices: the bare tiers first (each matches every level in the tier), then each tier + level.
  function allLabels(config = CONFIG) {
    return [...config.tierNames, ...levelLabels(config)];
  }

  // True when a classification matches a filter choice from allLabels().
  function matchesLabel(classification, filterLabel, config = CONFIG) {
    if (!filterLabel) return true;
    if (config.tierNames.includes(filterLabel)) return classification?.tier === filterLabel;
    return classification?.label === filterLabel;
  }

  // Group rows' time-to-value (months) by level label and by tier. `all` is the unsegmented fallback.
  function peerStats(rows) {
    const byLabel = {};
    levelLabels().forEach((label) => {
      byLabel[label] = summarize(rows.filter((row) => row.label === label).map((row) => row.ttvMonths));
    });
    const byTier = {};
    CONFIG.tierNames.forEach((name) => {
      byTier[name] = summarize(rows.filter((row) => row.tier === name).map((row) => row.ttvMonths));
    });
    return { byLabel, byTier, all: summarize(rows.map((row) => row.ttvMonths)) };
  }

  // Benchmark for a project: its own level when the sample is big enough, then its tier, then the portfolio.
  function benchmarkFor(row, stats, config = CONFIG) {
    const own = row?.level ? stats.byLabel[row.label] : null;
    if (own && own.n >= config.minPeerSample) return { ...own, basis: row.label };
    const tier = row?.tier ? stats.byTier[row.tier] : null;
    if (tier && tier.n >= config.minPeerSample) return { ...tier, basis: row.tier };
    return { ...stats.all, basis: "All projects" };
  }

  return { CONFIG, CORE_LINES, PRODUCT_LINES, classify, extraInputs, applyOverride, allLabels, levelLabels, matchesLabel, productLines, summarize, outlierFences, isOutlier, peerStats, benchmarkFor, isOnPrem, isPhaseTwo };
});
