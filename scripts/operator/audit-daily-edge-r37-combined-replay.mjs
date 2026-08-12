/**
 * READ ONLY. Consolidates the independently generated MLB/WNBA needle-search
 * artifacts into one proposed-r37 promotion replay. It performs no DB writes.
 */
import { readFile, writeFile } from "node:fs/promises";

const DIR = "/tmp/oddsphere-audit";
const FULL = `${DIR}/mlb-full-market-exhaustive.json`;
const MOVE = `${DIR}/mlb-toward-movement-qualifiers-2026-08-12.json`;
const WNBA = `${DIR}/wnba-feature-needle-2026-08-12.json`;
const HISTORY = `${DIR}/deep-market-history-reconstructed-rows-2026-08-11.json`;
const LIFETIME = `${DIR}/lifetime-mlb-wnba-methodology-2026-08-09.json`;
const OUTPUT = `${DIR}/daily-edge-r37-combined-replay-2026-08-12.json`;

const [full, move, wnba, history, lifetime] = await Promise.all(
  [FULL, MOVE, WNBA, HISTORY, LIFETIME].map(async (path) => JSON.parse(await readFile(path, "utf8"))),
);

const named = (market, id) => full.markets[market].namedMarketCandidates.find((row) => row.id === id);
const ml70 = named("moneyline", "sharpapi_money_and_tickets_gte_70__movement_neutral__high_quality__price_minus200_to_plus200");
const total10 = named("total", "sharpapi_money_over_tickets_10__movement_not_against__high_quality__playable_price");
const movement = move.marketLedAudit.proposedTiering.strongPool.incrementalOutsideExistingRanker;
const wnbaSpread = wnba.namedDiagnostics.spreadProjectionRest;

const historicalRows = Array.isArray(history) ? history : history.rows ?? history.analysisRows ?? [];
const mlbById = new Map(historicalRows.map((row) => [row.id, row]));
const moveById = new Map(move.baseRows.map((row) => [row.id, row]));
const wnbaById = new Map(lifetime.analysisRows.map((row) => [row.id, row]));

const cohorts = [
  {
    id: "ml_neutral_consensus_best_angle",
    sport: "mlb",
    market: "moneyline",
    grade: "best_angle",
    rows: ml70.rowIds.map((id) => mlbById.get(id)).filter(Boolean),
    evidence: ml70,
  },
  {
    id: "ml_toward_movement_lean",
    sport: "mlb",
    market: "moneyline",
    grade: "lean",
    rows: movement.rowIds.map((id) => moveById.get(id)).filter(Boolean),
    evidence: movement,
  },
  {
    id: "total_sharpapi_support_lean",
    sport: "mlb",
    market: "total",
    grade: "lean",
    rows: total10.rowIds.map((id) => mlbById.get(id)).filter((row) => row?.side === "under"),
    evidence: {
      train: total10.bySideChronology.under.train,
      validation: total10.bySideChronology.under.validation,
      holdout: total10.bySideChronology.under.holdout,
    },
  },
  {
    id: "wnba_spread_projection_rest_lean",
    sport: "wnba",
    market: "spread",
    grade: "lean",
    rows: wnbaSpread.rowIds.map((id) => wnbaById.get(id)).filter(Boolean),
    evidence: wnbaSpread,
  },
];

function profit(row) {
  const result = row.result;
  const price = Number(row.lockedPrice ?? row.price ?? row.odds);
  if (result === "push") return 0;
  if (result === "loss") return -1;
  if (result !== "win" || !Number.isFinite(price)) return null;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}
function dateOf(row) { return row.date ?? row.slate_date ?? row.slateDate ?? null; }
function metrics(rows) {
  const settled = rows.filter((row) => profit(row) !== null);
  const wins = settled.filter((row) => row.result === "win").length;
  const losses = settled.filter((row) => row.result === "loss").length;
  const pushes = settled.filter((row) => row.result === "push").length;
  const units = settled.reduce((sum, row) => sum + profit(row), 0);
  return {
    n: settled.length,
    dates: new Set(settled.map(dateOf)).size,
    record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`,
    units: +units.toFixed(3),
    roiPct: settled.length ? +(100 * units / settled.length).toFixed(1) : null,
  };
}

const promoted = new Map();
for (const cohort of cohorts) for (const row of cohort.rows) {
  const key = `${cohort.sport}:${cohort.market}:${row.id}`;
  const prior = promoted.get(key);
  if (!prior || cohort.grade === "best_angle") promoted.set(key, { ...cohort, row });
}
const daily = new Map();
for (const item of promoted.values()) {
  const date = dateOf(item.row);
  daily.set(date, (daily.get(date) ?? 0) + 1);
}
const dailyCounts = [...daily.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
const cohortSummary = cohorts.map(({ rows, evidence, ...cohort }) => ({
  ...cohort,
  ...metrics(rows),
  chronology: evidence ? {
    train: evidence.train ?? evidence.chronology?.train ?? null,
    validation: evidence.validation ?? evidence.chronology?.validation ?? null,
    holdout: evidence.holdout ?? evidence.chronology?.holdout ?? null,
  } : null,
}));
const output = {
  generatedAt: new Date().toISOString(),
  databaseWrites: false,
  release: "mlb_daily_edge_decision_2026_08_12_r37",
  scope: "Additive promotions only; no side, probability, projection, stake, no-bet, hold, freshness, or price-gate bypass.",
  cohorts: cohortSummary,
  combined: {
    uniquePromotions: promoted.size,
    bestAngleUpgrades: [...promoted.values()].filter((row) => row.grade === "best_angle").length,
    leanPromotions: [...promoted.values()].filter((row) => row.grade === "lean").length,
    demotions: 0,
    netActionableBoardDelta: promoted.size,
    dates: dailyCounts.length,
    averageAddsPerDate: dailyCounts.length ? +(promoted.size / dailyCounts.length).toFixed(2) : 0,
    maximumAddsOnDate: dailyCounts.length ? Math.max(...dailyCounts.map(([, count]) => count)) : 0,
    dailyCounts,
  },
  rejected: [
    "MLB broad one-point movement trigger (negative train ROI after correction/side-change separation)",
    "MLB movement-based Best Angle ranking (negative train ROI and small sample)",
    "MLB SharpAPI-support Over extension (flat 6-6 validation and 6-6 holdout)",
    "WNBA playable-price Moneyline support (no robust practical-price cohort)",
    "WNBA total support (no cluster-robust candidate and current-writer integration would require a second grade path)",
  ],
};

await writeFile(OUTPUT, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: OUTPUT, cohorts: output.cohorts, combined: output.combined, rejected: output.rejected }, null, 2));
