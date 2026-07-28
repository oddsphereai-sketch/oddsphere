import { readFileSync, writeFileSync } from "node:fs";

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? "/tmp/mlb-props-two-sided-audit.json";
if (!inputPath) {
  throw new Error(
    "Usage: node scripts/audit-mlb-props-two-sided.mjs <observations.json> [output.json]",
  );
}

const observations = JSON.parse(readFileSync(inputPath, "utf8"));
const windows = {
  discovery: ["0000-00-00", "2026-06-21"],
  calibration: ["2026-06-22", "2026-06-30"],
  validation1: ["2026-07-01", "2026-07-07"],
  validation2: ["2026-07-08", "2026-07-12"],
  untouchedValidation: ["2026-07-16", "2026-07-23"],
};
const markets = {};

for (const [key, source] of Object.entries(observations)) {
  if (!key.endsWith("|two_way")) continue;
  const rows = dedupe(source.filter(valid));
  markets[key] = Object.fromEntries(["over", "under"].map((side) => {
    const candidates = buildPolicies(side).map((policy) => {
      const discovery = summarize(select(inWindow(rows, windows.discovery), policy));
      const calibration = summarize(select(inWindow(rows, windows.calibration), policy));
      return {
        policy,
        discovery,
        calibration,
        score: selectionScore(discovery, calibration),
      };
    }).filter((row) => Number.isFinite(row.score))
      .sort((a, b) => b.score - a.score || b.discovery.count - a.discovery.count);
    const selected = candidates[0] ?? null;
    return [side, selected && {
      policy: selected.policy,
      discovery: selected.discovery,
      calibration: selected.calibration,
      validation1: summarize(select(
        inWindow(rows, windows.validation1),
        selected.policy,
      )),
      validation2: summarize(select(
        inWindow(rows, windows.validation2),
        selected.policy,
      )),
      untouchedValidation: summarize(select(
        inWindow(rows, windows.untouchedValidation),
        selected.policy,
      )),
    }];
  }));
}

for (const sides of Object.values(markets)) {
  for (const result of Object.values(sides)) {
    if (!result) continue;
    result.robust = [
      result.validation1,
      result.validation2,
      result.untouchedValidation,
    ].every((period) => period.count > 0 && period.roi > 0);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  input: inputPath,
  methodology: {
    directionsSearchedIndependently: ["over", "under"],
    policySelectedWith: ["discovery", "calibration"],
    validationsNotUsedForPolicySelection: [
      "validation1",
      "validation2",
      "untouchedValidation",
    ],
  },
  windows,
  markets,
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

function buildPolicies(side) {
  const policies = [];
  for (const minimumMarketEv of [0, 0.01, 0.02, 0.03, 0.05])
    for (const minimumModelAgreement of [-0.1, -0.05, 0, 0.02, 0.05, 0.1])
      for (const minimumMarketProbability of [0.4, 0.45, 0.5, 0.55])
        for (const maximumMarketProbability of [0.6, 0.65, 0.7, 0.8, 0.9]) {
          if (minimumMarketProbability >= maximumMarketProbability) continue;
          policies.push({
            side,
            minimumMarketEv,
            minimumModelAgreement,
            minimumMarketProbability,
            maximumMarketProbability,
          });
        }
  return policies;
}

function select(rows, policy) {
  return rows.flatMap((row) => {
    const over = policy.side === "over";
    const price = over ? row.bestOverDecimal : row.bestUnderDecimal;
    if (!Number.isFinite(price)) return [];
    const marketProbability = over ? row.marketOver : 1 - row.marketOver;
    const modelProbability = over ? row.currentApproxOver : 1 - row.currentApproxOver;
    const marketEv = marketProbability * price - 1;
    if (
      marketEv < policy.minimumMarketEv
      || modelProbability - marketProbability < policy.minimumModelAgreement
      || marketProbability < policy.minimumMarketProbability
      || marketProbability > policy.maximumMarketProbability
    ) return [];
    const won = over ? row.overWon : 1 - row.overWon;
    return [{
      ...row,
      side: policy.side,
      won,
      profit: won ? price - 1 : -1,
    }];
  });
}

function summarize(rows) {
  const units = rows.reduce((sum, row) => sum + row.profit, 0);
  const activeDays = new Set(rows.map((row) => row.date)).size;
  return {
    count: rows.length,
    wins: rows.filter((row) => row.won).length,
    units: round(units),
    roi: rows.length ? round(units / rows.length) : null,
    activeDays,
    averagePerActiveDay: activeDays ? round(rows.length / activeDays) : null,
  };
}

function selectionScore(discovery, calibration) {
  if (discovery.count < 15 || calibration.count < 8) return -Infinity;
  if (discovery.roi < -0.03 || calibration.roi < -0.03) return -Infinity;
  return Math.min(discovery.roi, calibration.roi)
    - Math.abs(discovery.roi - calibration.roi) * 0.25
    + Math.log1p(discovery.count + calibration.count) / 50;
}

function dedupe(source) {
  const best = new Map();
  for (const row of source) {
    const key = `${row.date}|${row.gameId}|${row.playerId}|${row.line}`;
    if (!best.has(key)) best.set(key, row);
  }
  return [...best.values()];
}

function valid(row) {
  return typeof row.date === "string"
    && [row.marketOver, row.currentApproxOver, row.overWon].every(Number.isFinite);
}

function inWindow(rows, [from, through]) {
  return rows.filter((row) => row.date >= from && row.date <= through);
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
