import { readFileSync, writeFileSync } from "node:fs";

type JsonObject = Record<string, any>;

const [
  calibrationPath,
  sidePolicyPath,
  gradeLadderPath,
  recoveryPath,
  capEquivalencePath,
  outputPath = "/tmp/mlb-props-category-certification.json",
] = process.argv.slice(2);

if (
  !calibrationPath
  || !sidePolicyPath
  || !gradeLadderPath
  || !recoveryPath
  || !capEquivalencePath
) {
  throw new Error(
    "Usage: npx tsx scripts/audit-mlb-props-category-certification.ts <calibration.json> <side-policy.json> <grade-ladder.json> <recovery.json> <cap-equivalence.json> [output.json]",
  );
}

const calibration = readJson(calibrationPath);
const sidePolicies = readJson(sidePolicyPath);
const gradeLadder = readJson(gradeLadderPath);
const recovery = readJson(recoveryPath);
const capEquivalence = readJson(capEquivalencePath);

const decisions: Record<string, {
  maximumActionableGrade: string;
  actionableDirections: string[];
  disposition: string;
}> = {
  pitcher_strikeouts: {
    maximumActionableGrade: "LEAN",
    actionableDirections: ["over"],
    disposition:
      "Retain Over Leans only; Under actionables lost historically and broad side searches did not validate.",
  },
  pitcher_outs: {
    maximumActionableGrade: "LEAN",
    actionableDirections: ["over"],
    disposition:
      "Retain Over Leans; the locked cohort was positive in every non-empty chronological window. Under becomes Watchlist.",
  },
  pitcher_hits_allowed: {
    maximumActionableGrade: "WATCHLIST",
    actionableDirections: [],
    disposition: "No side policy survived discovery and future validation.",
  },
  pitcher_walks: {
    maximumActionableGrade: "WATCHLIST",
    actionableDirections: [],
    disposition: "No stable probability or side-specific betting improvement.",
  },
  pitcher_earned_runs: {
    maximumActionableGrade: "WATCHLIST",
    actionableDirections: [],
    disposition: "Both historical actionable directions lost; no replacement passed.",
  },
  pitcher_record_a_win: {
    maximumActionableGrade: "RESEARCH",
    actionableDirections: [],
    disposition: "Outcome contract is not available in the audited settlement archive.",
  },
  batter_strikeouts: {
    maximumActionableGrade: "WATCHLIST",
    actionableDirections: [],
    disposition: "Milestone and two-way searches did not produce a stable future policy.",
  },
  batter_hits: {
    maximumActionableGrade: "BEST_ANGLE",
    actionableDirections: ["under"],
    disposition:
      "Under has an uncapped threshold path positive in every future window and is the supported Best Angle direction. Over becomes Watchlist.",
  },
  batter_total_bases: {
    maximumActionableGrade: "WATCHLIST",
    actionableDirections: [],
    disposition: "Both historical actionable sides lost; the apparent Over candidate failed future windows.",
  },
  batter_home_runs: {
    maximumActionableGrade: "LEAN",
    actionableDirections: ["over"],
    disposition:
      "Cap-free multi-book-consensus versus best-price path plus within-slate standardized quality threshold passed every chronological period.",
  },
  batter_rbis: {
    maximumActionableGrade: "WATCHLIST",
    actionableDirections: [],
    disposition: "No profitable two-way or milestone promotion path validated.",
  },
  batter_runs_scored: {
    maximumActionableGrade: "LEAN",
    actionableDirections: ["under"],
    disposition:
      "Retain as a lower-confidence Under Lean; remove the unvalidated special promotion overlay.",
  },
  batter_hits_runs_rbis: {
    maximumActionableGrade: "BEST_ANGLE",
    actionableDirections: ["under"],
    disposition:
      "Line 1.5 Under has an uncapped threshold path positive in every future window and is promoted to Best Angle. Over becomes Watchlist.",
  },
  batter_singles: {
    maximumActionableGrade: "LEAN",
    actionableDirections: ["under"],
    disposition:
      "No Best Angle survives. Under may remain a lower-tier Lean; Over becomes Watchlist.",
  },
  batter_doubles: {
    maximumActionableGrade: "WATCHLIST",
    actionableDirections: [],
    disposition: "The small Under result was too weak and unstable for promotion.",
  },
  batter_triples: {
    maximumActionableGrade: "WATCHLIST",
    actionableDirections: [],
    disposition: "Sparse two-way data and no validated milestone path.",
  },
  batter_walks: {
    maximumActionableGrade: "LEAN",
    actionableDirections: ["under"],
    disposition:
      "Under remains a lower-tier Lean; Over historical actionables lost and become Watchlist.",
  },
  batter_stolen_bases: {
    maximumActionableGrade: "WATCHLIST",
    actionableDirections: [],
    disposition: "Two-way and milestone action policies failed future validation.",
  },
  first_home_run: {
    maximumActionableGrade: "RESEARCH",
    actionableDirections: [],
    disposition: "Outcome contract is not available in the audited settlement archive.",
  },
};

const actionableHistory =
  gradeLadder.currentLadder?.actionableByMarketSide ?? {};
const categoryRows = Object.entries(calibration.markets ?? {}).map(
  ([market, audit]: [string, any]) => {
    const channels = audit.channels ?? {};
    const sideAudit = Object.fromEntries(
      Object.entries(sidePolicies)
        .filter(([, value]: [string, any]) => value.market === market)
        .map(([key, value]: [string, any]) => [key.split("|")[1], value.sides]),
    );
    return {
      market,
      decision: decisions[market] ?? {
        maximumActionableGrade: "RESEARCH",
        actionableDirections: [],
        disposition: "No certification decision recorded.",
      },
      data: {
        status: audit.status,
        channels: Object.fromEntries(
          Object.entries(channels).map(([contract, value]: [string, any]) => [
            contract,
            {
              status: value.status,
              observations: value.observations ?? 0,
              dateRange: value.dateRange ?? null,
              calibrationDisposition:
                value.summary?.calibrationDisposition ?? null,
            },
          ]),
        ),
      },
      sideSearch: sideAudit,
      lockedHistoricalActionables: {
        over: actionableHistory[`${market}|over`] ?? null,
        under: actionableHistory[`${market}|under`] ?? null,
      },
    };
  },
);

const report = {
  generatedAt: new Date().toISOString(),
  sources: {
    calibration: calibrationPath,
    sidePolicies: sidePolicyPath,
    gradeLadder: gradeLadderPath,
    recovery: recoveryPath,
    capEquivalence: capEquivalencePath,
  },
  methodology: {
    productionWrites: false,
    categoriesAudited: categoryRows.length,
    channelsAudited: Object.keys(sidePolicies).length,
    observationDates:
      calibration.methodology?.odds ?? "See calibration source",
    lockedLedgerCoverage: gradeLadder.coverage,
    identityCoverage: calibration.identityCoverage,
    noFixedMinimumMaximumOrGradeDistribution: true,
    rule:
      "Best Angle requires the strongest repeated chronological evidence; Lean permits positive but wider-uncertainty evidence; Watchlist preserves sortable model evidence without presenting it as actionable.",
  },
  portfolioEvidence: {
    homeRuns: {
      policy: recovery.homeRuns?.policy,
      windows: recovery.homeRuns?.windows,
      combined: recovery.homeRuns?.combined,
      bootstrap: recovery.homeRuns?.dateClusterBootstrap,
      boardDelta: recovery.homeRuns?.priorVsRecovered,
    },
    hitsUnderBestAngle: recovery.hitsUnder,
    strongestUncappedUnderPromotions:
      capEquivalence.variants?.strongestMarketsUncapped,
  },
  categories: categoryRows,
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  categories: categoryRows.length,
  channels: Object.keys(sidePolicies).length,
  lockedRows: gradeLadder.coverage?.rows,
  settledLockedRows: gradeLadder.coverage?.settledRows,
}, null, 2));

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}
