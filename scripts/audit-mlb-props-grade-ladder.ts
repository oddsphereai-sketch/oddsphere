import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

type LockedRow = {
  id: number;
  slate_date: string;
  market_key: string;
  side: "over" | "under";
  play_grade: "BEST_ANGLE" | "LEAN" | "WATCHLIST";
  tracking_cohort: "actionable" | "model_observation";
  locked_american_odds: number;
  locked_expected_value: number | null;
  locked_edge: number | null;
  locked_final_probability: number;
  confidence: number;
  result_status: string;
  metadata_json: Record<string, unknown>;
};

type WindowName =
  | "discovery"
  | "calibration"
  | "validation1"
  | "validation2"
  | "untouchedValidation";

type PromotionPolicy = {
  marketSide: string;
  minimumExpectedValue: number;
  maximumExpectedValue: number;
  minimumEdge: number;
  maximumEdge: number;
  minimumAmericanOdds: number;
};

const outputPath = process.argv[2] ?? "/tmp/mlb-props-grade-ladder-audit.json";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error(
    "Grade-ladder audit requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const windows: Record<WindowName, readonly [string, string]> = {
  discovery: ["2026-07-16", "2026-07-19"],
  calibration: ["2026-07-20", "2026-07-21"],
  validation1: ["2026-07-22", "2026-07-23"],
  validation2: ["2026-07-24", "2026-07-25"],
  untouchedValidation: ["2026-07-26", "2026-07-27"],
};
const capReasons = new Set([
  "PLAYER_HITTER_SIGNAL_LIMIT",
  "SLATE_HITTER_SIGNAL_LIMIT",
  "CORRELATED_HITTER_MARKET_CAPPED",
  "HITTER_LEAN_PRICE_TOO_SHORT",
]);

const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
void main();

async function main() {
  const rows = await readAllRows();
  const settled = rows.filter(isSettled);
  const capDemotedWatchlists = settled.filter((row) =>
    row.play_grade === "WATCHLIST" && reasonCodes(row).some((code) => capReasons.has(code)));
  const selectedPolicies = selectPolicies(capDemotedWatchlists);
  const qualifiedPolicies = selectedPolicies.filter((candidate) =>
    candidate.validation1.count >= 10
    && candidate.validation2.count >= 10
    && candidate.untouchedValidation.count >= 10
    && candidate.validation1.roi !== null
    && candidate.validation1.roi > 0
    && candidate.validation2.roi !== null
    && candidate.validation2.roi > 0
    && candidate.untouchedValidation.roi !== null
    && candidate.untouchedValidation.roi > 0);
  const promotedIds = new Set(
    capDemotedWatchlists
      .filter((row) => qualifiedPolicies.some((candidate) =>
        matchesPolicy(row, candidate.policy)))
      .map((row) => row.id),
  );
  const residualWatchlists = settled.filter((row) =>
    row.play_grade === "WATCHLIST" && !promotedIds.has(row.id));
  const currentActionables = settled.filter((row) =>
    row.play_grade === "BEST_ANGLE" || row.play_grade === "LEAN");
  const recoveredLeans = [
    ...currentActionables,
    ...capDemotedWatchlists.filter((row) => promotedIds.has(row.id)),
  ];

  const report = {
  generatedAt: new Date().toISOString(),
  source: "mlb_prop_tracking_entries locked T-60 rows",
  methodology: {
    noGradeCountTargets: true,
    noFixedDailyPromotionMinimumOrMaximum: true,
    policySelectionUses: ["discovery", "calibration"],
    policySelectionDoesNotUse: [
      "validation1",
      "validation2",
      "untouchedValidation",
    ],
    capReasonCandidatePool: [...capReasons],
    note:
      "Release eras are reported separately. Cross-release threshold research is not described as current-release performance.",
  },
  windows,
  coverage: {
    rows: rows.length,
    settledRows: settled.length,
    dates: [...new Set(rows.map((row) => row.slate_date))],
  },
  currentLadder: {
    combinedByGrade: groupedMetrics(settled, (row) => row.play_grade),
    actionableByMarketSide: groupedMetrics(
      currentActionables,
      (row) => marketSide(row),
    ),
    actionableByWindowAndMarketSide: Object.fromEntries(
      Object.entries(windows).map(([name, window]) => [
        name,
        groupedMetrics(
          inWindow(currentActionables, window),
          (row) => marketSide(row),
        ),
      ]),
    ),
    watchlistByMarketSide: groupedMetrics(
      settled.filter((row) => row.play_grade === "WATCHLIST"),
      (row) => marketSide(row),
    ),
    byWindowAndGrade: Object.fromEntries(
      Object.entries(windows).map(([name, window]) => [
        name,
        groupedMetrics(inWindow(settled, window), (row) => row.play_grade),
      ]),
    ),
    byReleaseAndGrade: groupedMetrics(
      settled,
      (row) => `${releaseId(row)}|${row.play_grade}`,
    ),
  },
  capDemotionAudit: {
    combined: summarize(capDemotedWatchlists),
    byReason: groupedMetrics(
      capDemotedWatchlists,
      (row) => reasonCodes(row).find((code) => capReasons.has(code)) ?? "UNKNOWN",
    ),
    selectedPolicies,
    qualifiedPolicies,
  },
  recoveredLadderCandidate: {
    promotedFromWatchlist: promotedIds.size,
    demotedFromActionable: 0,
    netActionableChange: promotedIds.size,
    promoted: summarize(capDemotedWatchlists.filter((row) => promotedIds.has(row.id))),
    retainedActionables: summarize(currentActionables),
    actionableUnion: summarize(recoveredLeans),
    residualWatchlist: summarize(residualWatchlists),
    byWindow: Object.fromEntries(
      Object.entries(windows).map(([name, window]) => [
        name,
        {
          promoted: summarize(inWindow(
            capDemotedWatchlists.filter((row) => promotedIds.has(row.id)),
            window,
          )),
          actionableUnion: summarize(inWindow(recoveredLeans, window)),
          residualWatchlist: summarize(inWindow(residualWatchlists, window)),
        },
      ]),
    ),
  },
  };

  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

async function readAllRows(): Promise<LockedRow[]> {
  const output: LockedRow[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await supabase
      .from("mlb_prop_tracking_entries")
      .select([
        "id",
        "slate_date",
        "market_key",
        "side",
        "play_grade",
        "tracking_cohort",
        "locked_american_odds",
        "locked_expected_value",
        "locked_edge",
        "locked_final_probability",
        "confidence",
        "result_status",
        "metadata_json",
      ].join(","))
      .order("slate_date")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    const page = (data ?? []) as unknown as LockedRow[];
    output.push(...page);
    if (page.length < 1_000) break;
  }
  return output;
}

function selectPolicies(source: LockedRow[]) {
  const marketSides = [...new Set(source.map((row) => marketSide(row)))];
  return marketSides.flatMap((candidateMarketSide) => {
    const candidates: Array<{
      policy: PromotionPolicy;
      discovery: ReturnType<typeof summarize>;
      calibration: ReturnType<typeof summarize>;
      score: number;
    }> = [];
    for (const minimumExpectedValue of [0.01, 0.02, 0.04, 0.06])
      for (const maximumExpectedValue of [0.04, 0.06, 0.1, 0.15, 1])
        for (const minimumEdge of [0.02, 0.04])
          for (const maximumEdge of [0.06, 0.08, 1])
            for (const minimumAmericanOdds of [-250, -200, -150, -110, 100]) {
              if (
                minimumExpectedValue >= maximumExpectedValue
                || minimumEdge >= maximumEdge
              ) continue;
              const policy = {
                marketSide: candidateMarketSide,
                minimumExpectedValue,
                maximumExpectedValue,
                minimumEdge,
                maximumEdge,
                minimumAmericanOdds,
              };
              const discovery = summarize(
                inWindow(source, windows.discovery).filter((row) =>
                  matchesPolicy(row, policy)),
              );
              const calibration = summarize(
                inWindow(source, windows.calibration).filter((row) =>
                  matchesPolicy(row, policy)),
              );
              const score = selectionScore(discovery, calibration);
              if (Number.isFinite(score)) {
                candidates.push({ policy, discovery, calibration, score });
              }
            }
    const selected = candidates.sort((a, b) =>
      b.score - a.score || b.discovery.count - a.discovery.count)[0];
    if (!selected) return [];
    return [{
      ...selected,
      validation1: summarize(
        inWindow(source, windows.validation1).filter((row) =>
          matchesPolicy(row, selected.policy)),
      ),
      validation2: summarize(
        inWindow(source, windows.validation2).filter((row) =>
          matchesPolicy(row, selected.policy)),
      ),
      untouchedValidation: summarize(
        inWindow(source, windows.untouchedValidation).filter((row) =>
          matchesPolicy(row, selected.policy)),
      ),
    }];
  });
}

function selectionScore(
  discovery: ReturnType<typeof summarize>,
  calibration: ReturnType<typeof summarize>,
): number {
  if (discovery.count < 20 || calibration.count < 12) return -Infinity;
  if (
    discovery.roi === null
    || calibration.roi === null
    || discovery.roi < -0.02
    || calibration.roi < -0.02
  ) return -Infinity;
  return Math.min(discovery.roi, calibration.roi)
    - Math.abs(discovery.roi - calibration.roi) * 0.25
    + Math.log1p(discovery.count + calibration.count) / 100;
}

function matchesPolicy(row: LockedRow, policy: PromotionPolicy): boolean {
  return marketSide(row) === policy.marketSide
    && row.locked_expected_value !== null
    && row.locked_expected_value >= policy.minimumExpectedValue
    && row.locked_expected_value < policy.maximumExpectedValue
    && row.locked_edge !== null
    && row.locked_edge >= policy.minimumEdge
    && row.locked_edge < policy.maximumEdge
    && row.locked_american_odds >= policy.minimumAmericanOdds;
}

function summarize(source: LockedRow[]) {
  const units = source.reduce((sum, row) => sum + oneUnitProfit(row), 0);
  const wins = source.filter((row) => row.result_status === "win").length;
  const probabilities = source.map((row) => row.locked_final_probability);
  return {
    count: source.length,
    wins,
    losses: source.length - wins,
    units: round(units),
    roi: source.length ? round(units / source.length) : null,
    brier: source.length
      ? round(source.reduce((sum, row) => {
        const outcome = row.result_status === "win" ? 1 : 0;
        return sum + (row.locked_final_probability - outcome) ** 2;
      }, 0) / source.length)
      : null,
    meanProbability: probabilities.length
      ? round(probabilities.reduce((sum, probability) => sum + probability, 0)
        / probabilities.length)
      : null,
    observedRate: source.length ? round(wins / source.length) : null,
    activeDates: new Set(source.map((row) => row.slate_date)).size,
  };
}

function groupedMetrics(
  source: LockedRow[],
  keyFor: (row: LockedRow) => string,
) {
  return Object.fromEntries(
    [...Map.groupBy(source, keyFor)].map(([groupKey, group]) => [
      groupKey,
      summarize(group),
    ]),
  );
}

function inWindow(
  source: LockedRow[],
  [from, through]: readonly [string, string],
): LockedRow[] {
  return source.filter((row) => row.slate_date >= from && row.slate_date <= through);
}

function reasonCodes(row: LockedRow): string[] {
  const value = row.metadata_json?.reasonCodes;
  return Array.isArray(value) ? value.map(String) : [];
}

function releaseId(row: LockedRow): string {
  const value = row.metadata_json?.modelReleaseId;
  return typeof value === "string" ? value : "release_missing";
}

function marketSide(row: LockedRow): string {
  return `${row.market_key}|${row.side}`;
}

function isSettled(row: LockedRow): boolean {
  return row.result_status === "win" || row.result_status === "loss";
}

function oneUnitProfit(row: LockedRow): number {
  if (row.result_status !== "win") return -1;
  return row.locked_american_odds > 0
    ? row.locked_american_odds / 100
    : 100 / Math.abs(row.locked_american_odds);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
