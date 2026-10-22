/**
 * Offline-only NBA player-props exact-price grade recalibration.
 *
 * Candidate selection uses the reliability-fit and grade-policy windows only.
 * The confirmation window is read exactly once after every market policy is
 * frozen. This script never writes production or member state.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Grade = "Best Angle" | "Lean" | "Watchlist" | "No Play";
type Side = "over" | "under";
type WindowName = "reliabilityFit" | "gradePolicy" | "confirmation";
type SignalFamily =
  | "final_probability"
  | "raw_probability"
  | "projection_distance"
  | "target_excluded_probability"
  | "target_excluded_expected_value"
  | "model_market_conservative_expected_value"
  | "model_market_average_expected_value";
type EligibilityGate = "all" | "established_role" | "not_back_to_back" | "established_role_not_back_to_back";

type Row = Readonly<{
  gameId: number;
  playerId: number;
  scopeKey: string;
  featureCutoff: string;
  market: string;
  independentSide: Side;
  finalSide: Side;
  outcomeSide: Side;
  line: number;
  finalProjection: number;
  projectionStandardDeviation: number;
  rawFinalProbability: number;
  finalProbability: number;
  targetExcludedProbability: number;
  targetExcludedBooks: number;
  targetExcludedReferenceBooks: number;
  americanPrice: number;
  expectedValue: number;
  playerGamesPrior: number;
  minutesStandardDeviation10: number | null;
  teamBackToBack: boolean;
}>;

type Dataset = Readonly<{
  release: string;
  mode: "offline_research_only";
  actionable: false;
  sourceDatasetRelease: string;
  sourceTournamentRelease: string;
  immutableInputsSha256: string;
  rows: Readonly<Record<WindowName, readonly Row[]>>;
}>;

type CandidatePolicy = Readonly<{
  signalFamily: SignalFamily;
  eligibilityGate: EligibilityGate;
  minimumProbability: number;
  minimumExpectedValue: number;
  minimumAmericanPrice: number;
  requireReferenceBook: boolean;
  maxPerSlate: null | 1 | 2 | 3;
}>;

type BestPolicy = Readonly<{
  minimumProbability: number;
  minimumExpectedValue: number;
  requireReferenceBook: boolean;
}>;

type FrozenMarketPolicy = Readonly<{
  lean: CandidatePolicy;
  best: BestPolicy | null;
  preconfirmationQualified: boolean;
  preconfirmationReasons: readonly string[];
}>;

type GradedRow = Row & Readonly<{ grade: Grade }>;
type ArtifactPolicy = Readonly<Record<string, string | number | boolean | null>>;
type ArtifactGradeConfig = Readonly<{
  kind: "ranked" | "threshold_relative_best" | "slate_relative_lean";
  policy: ArtifactPolicy;
  bestAngleQualified?: boolean;
  publicQualified?: boolean;
  relativeBest?: Readonly<{ signalFamily: string; threshold: number }> | null;
}>;
type ArtifactGradePolicies = Record<string, ArtifactGradeConfig>;

function value(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required.`);
  return process.argv[index + 1]!;
}

function optionalValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : null;
}

const MARKETS = [
  "points",
  "rebounds",
  "assists",
  "threes",
  "points_rebounds_assists",
  "points_rebounds",
  "points_assists",
  "rebounds_assists",
] as const;

const SIGNALS: readonly SignalFamily[] = [
  "final_probability",
  "raw_probability",
  "projection_distance",
  "target_excluded_probability",
  "target_excluded_expected_value",
  "model_market_conservative_expected_value",
  "model_market_average_expected_value",
];

const GATES: readonly EligibilityGate[] = [
  "all",
  "established_role",
  "not_back_to_back",
  "established_role_not_back_to_back",
];

async function main(): Promise<void> {
  const inputPath = path.resolve(value("--input"));
  const artifactPath = path.resolve(value("--artifact"));
  const outputPath = path.resolve(value("--output"));
  const dataset = JSON.parse(await readFile(inputPath, "utf8")) as Dataset;
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
    release: string;
    sourceGradeRelease: string;
    gradePolicies: ArtifactGradePolicies;
  };
  if (dataset.mode !== "offline_research_only" || dataset.actionable !== false) {
    throw new Error("Grade recalibration accepts only an offline non-actionable dataset.");
  }

  const reusePolicyReport = optionalValue("--reuse-policy-report");
  const frozenPolicies = reusePolicyReport
    ? (JSON.parse(await readFile(path.resolve(reusePolicyReport), "utf8")) as {
      candidatePolicies: Record<(typeof MARKETS)[number], FrozenMarketPolicy>;
    }).candidatePolicies
    : Object.fromEntries(MARKETS.map((market) => {
      const reliability = dataset.rows.reliabilityFit.filter((row) => row.market === market);
      const gradePolicy = dataset.rows.gradePolicy.filter((row) => row.market === market);
      return [market, selectMarketPolicy(reliability, gradePolicy)];
    })) as Record<(typeof MARKETS)[number], FrozenMarketPolicy>;

  const candidateWindows = Object.fromEntries((Object.keys(dataset.rows) as WindowName[]).map((window) => {
    const graded = applyCandidatePolicies(dataset.rows[window], frozenPolicies);
    return [window, summarizeBoard(graded)];
  })) as Record<WindowName, ReturnType<typeof summarizeBoard>>;
  const candidateConfirmationRows = applyCandidatePolicies(dataset.rows.confirmation, frozenPolicies);
  const baselineWindows = Object.fromEntries((Object.keys(dataset.rows) as WindowName[]).map((window) => {
    const graded = applyArtifactPolicies(dataset.rows[window], artifact.gradePolicies);
    return [window, summarizeBoard(graded)];
  })) as Record<WindowName, ReturnType<typeof summarizeBoard>>;
  const baselineConfirmationRows = applyArtifactPolicies(dataset.rows.confirmation, artifact.gradePolicies);

  // This policy was selected by the pooled, preconfirmation-only tournament
  // before any market-specific confirmation result was inspected.  The
  // comparisons below deliberately preserve every other artifact policy so a
  // weak market can be repaired without flattening or rewriting the board.
  const pooledUniversalPolicy = {
    kind: "slate_relative_lean",
    policy: {
      signalFamily: "model_market_conservative_expected_value",
      eligibilityGate: "established_role",
      maxPerSlate: 1,
      minimumProbability: 0.5,
      minimumExpectedValue: -0.03,
      minimumAmericanPrice: -130,
      requireReferenceBook: true,
    },
    publicQualified: false,
  } as const;
  const focusedPolicyComparisons = Object.fromEntries([
    ["rebounds_only", ["rebounds"]],
    ["points_assists_only", ["points_assists"]],
    ["rebounds_assists_only", ["rebounds_assists"]],
    ["weak_markets_combined", ["rebounds", "points_assists", "rebounds_assists"]],
  ].map(([name, markets]) => {
    const policies = structuredClone(artifact.gradePolicies);
    for (const market of markets as string[]) policies[market] = structuredClone(pooledUniversalPolicy);
    const windows = Object.fromEntries((Object.keys(dataset.rows) as WindowName[]).map((window) => {
      const baseline = applyArtifactPolicies(dataset.rows[window], artifact.gradePolicies);
      const candidate = applyArtifactPolicies(dataset.rows[window], policies);
      return [window, compareBoards(baseline, candidate)];
    }));
    const candidateConfirmation = applyArtifactPolicies(dataset.rows.confirmation, policies);
    return [name as string, {
      markets,
      replacementPolicy: pooledUniversalPolicy,
      windows,
      clusteredConfirmation: {
        games: clusterInterval(candidateConfirmation.filter(actionable), (row) => String(row.gameId)),
        players: clusterInterval(candidateConfirmation.filter(actionable), (row) => String(row.playerId)),
        pairedDeltaByGame: pairedClusterDelta(
          baselineConfirmationRows,
          candidateConfirmation,
          (row) => String(row.gameId),
        ),
        pairedDeltaByPlayer: pairedClusterDelta(
          baselineConfirmationRows,
          candidateConfirmation,
          (row) => String(row.playerId),
        ),
      },
    }];
  }));
  const coherentPriceComparisons = Object.fromEntries((Object.keys(dataset.rows) as WindowName[]).map((window) => {
    const baseline = applyArtifactPolicies(dataset.rows[window], artifact.gradePolicies);
    const candidate = applyPositiveEvEqualBoardPolicy(dataset.rows[window], artifact.gradePolicies);
    return [window, compareBoards(baseline, candidate)];
  }));
  const coherentPriceConfirmationRows = applyPositiveEvEqualBoardPolicy(
    dataset.rows.confirmation,
    artifact.gradePolicies,
  );

  const candidateByMarket = Object.fromEntries(MARKETS.map((market) => {
    const policy = frozenPolicies[market];
    const reliability = applyCandidatePolicies(dataset.rows.reliabilityFit.filter((row) => row.market === market), { [market]: policy });
    const gradePolicy = applyCandidatePolicies(dataset.rows.gradePolicy.filter((row) => row.market === market), { [market]: policy });
    const confirmation = candidateConfirmationRows.filter((row) => row.market === market);
    return [market, {
      policy,
      reliabilityFit: summarizeBoard(reliability),
      gradePolicy: summarizeBoard(gradePolicy),
      confirmation: summarizeBoard(confirmation),
    }];
  })) as Record<(typeof MARKETS)[number], Readonly<{
    policy: FrozenMarketPolicy;
    reliabilityFit: ReturnType<typeof summarizeBoard>;
    gradePolicy: ReturnType<typeof summarizeBoard>;
    confirmation: ReturnType<typeof summarizeBoard>;
  }>>;

  const candidateActionable = candidateConfirmationRows.filter(actionable);
  const baselineByScope = new Map(baselineConfirmationRows.map((row) => [row.scopeKey, row.grade]));
  const candidateByScope = new Map(candidateConfirmationRows.map((row) => [row.scopeKey, row.grade]));
  const changed = dataset.rows.confirmation.flatMap((row) => {
    const before = baselineByScope.get(row.scopeKey) ?? "No Play";
    const after = candidateByScope.get(row.scopeKey) ?? "No Play";
    return before === after ? [] : [{ scopeKey: row.scopeKey, market: row.market, before, after }];
  });
  const promotions = changed.filter((row) => gradeRank(row.after) < gradeRank(row.before));
  const demotions = changed.filter((row) => gradeRank(row.after) > gradeRank(row.before));
  const confirmationReasons: string[] = [];
  const candidateConfirmation = candidateWindows.confirmation.actionable;
  if (candidateConfirmation.records < 40) confirmationReasons.push("fewer_than_40_confirmation_actionables");
  if ((candidateConfirmation.hitRate ?? 0) < 0.55) confirmationReasons.push("confirmation_hit_below_55_percent");
  if ((candidateConfirmation.roi ?? -1) <= 0) confirmationReasons.push("confirmation_roi_not_positive");
  if (candidateConfirmation.nonnegativeEvShare !== 1) confirmationReasons.push("nonnegative_exact_price_ev_not_universal");
  for (const market of MARKETS) {
    const marketSummary = candidateByMarket[market].confirmation.actionable as Summary;
    if (marketSummary.records === 0) confirmationReasons.push(`${market}_has_zero_confirmation_actionables`);
    if (marketSummary.records >= 5 && (marketSummary.hitRate ?? 0) < 0.45) {
      confirmationReasons.push(`${market}_confirmation_hit_below_45_percent`);
    }
    if (marketSummary.records >= 5 && (marketSummary.roi ?? -1) < -0.10) {
      confirmationReasons.push(`${market}_confirmation_roi_below_minus_10_percent`);
    }
  }
  const baselineCount = baselineWindows.confirmation.actionable.records;
  if (candidateConfirmation.records < Math.floor(baselineCount * 0.55)) {
    confirmationReasons.push("actionable_board_below_55_percent_of_baseline");
  }
  if (promotions.length === 0) confirmationReasons.push("no_tested_promotions");
  if (demotions.length === 0) confirmationReasons.push("no_tested_demotions");

  const report = {
    release: "nba_player_props_grade_recalibration_audit_2026_10_22_r2_rebound_focused_comparison",
    mode: "offline_research_only",
    actionable: false,
    sourceDatasetRelease: dataset.release,
    sourceTournamentRelease: dataset.sourceTournamentRelease,
    sourceArtifactRelease: artifact.release,
    sourceGradeRelease: artifact.sourceGradeRelease,
    immutableInputsSha256: dataset.immutableInputsSha256,
    methodology: {
      candidateSelectionWindows: ["reliabilityFit", "gradePolicy"],
      confirmationWindowExcludedFromSelection: true,
      exactPriceEvRequired: true,
      targetBookExcludedEvidenceRequired: true,
      noProviderOrDatabaseWrites: true,
    },
    candidatePolicies: frozenPolicies,
    candidateByMarket,
    baselineWindows,
    baselineClusteredConfirmation: {
      games: clusterInterval(baselineConfirmationRows.filter(actionable), (row) => String(row.gameId)),
      players: clusterInterval(baselineConfirmationRows.filter(actionable), (row) => String(row.playerId)),
    },
    candidateWindows,
    focusedPolicyComparisons,
    coherentPriceCandidate: {
      description: "preserve each artifact market/slate actionable count while replacing negative-EV rows with target-excluded positive-EV rows ranked by conservative model/market value",
      windows: coherentPriceComparisons,
      clusteredConfirmation: {
        games: clusterInterval(coherentPriceConfirmationRows.filter(actionable), (row) => String(row.gameId)),
        players: clusterInterval(coherentPriceConfirmationRows.filter(actionable), (row) => String(row.playerId)),
        pairedDeltaByGame: pairedClusterDelta(
          baselineConfirmationRows,
          coherentPriceConfirmationRows,
          (row) => String(row.gameId),
        ),
        pairedDeltaByPlayer: pairedClusterDelta(
          baselineConfirmationRows,
          coherentPriceConfirmationRows,
          (row) => String(row.playerId),
        ),
      },
    },
    boardImpact: {
      baselineActionables: baselineCount,
      candidateActionables: candidateConfirmation.records,
      promotions: promotions.length,
      demotions: demotions.length,
      changed: changed.length,
      promotionByMarket: countBy(promotions, (row) => row.market),
      demotionByMarket: countBy(demotions, (row) => row.market),
    },
    clusteredConfirmation: {
      games: clusterInterval(candidateActionable, (row) => String(row.gameId)),
      players: clusterInterval(candidateActionable, (row) => String(row.playerId)),
    },
    confirmationVerdict: {
      qualified: confirmationReasons.length === 0,
      reasons: confirmationReasons,
    },
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    release: report.release,
    candidateByMarket: Object.fromEntries(MARKETS.map((market) => [market, {
      policy: frozenPolicies[market],
      confirmation: candidateByMarket[market].confirmation.actionable,
    }])),
    baseline: baselineWindows.confirmation.actionable,
    baselineClusteredConfirmation: report.baselineClusteredConfirmation,
    candidate: candidateWindows.confirmation.actionable,
    focusedPolicyComparisons,
    coherentPriceCandidate: report.coherentPriceCandidate,
    boardImpact: report.boardImpact,
    clusteredConfirmation: report.clusteredConfirmation,
    confirmationVerdict: report.confirmationVerdict,
  }, null, 2)}\n`);
}

function applyPositiveEvEqualBoardPolicy(
  rows: readonly Row[],
  policies: ArtifactGradePolicies,
): GradedRow[] {
  const baseline = applyArtifactPolicies(rows, policies);
  const baselineByScope = new Map(baseline.map((row) => [row.scopeKey, row]));
  const selected = new Set<string>();
  for (const market of MARKETS) {
    const marketRows = rows.filter((row) => row.market === market);
    for (const [slateDate, slate] of groupBy(marketRows, (row) => easternDate(row.featureCutoff))) {
      const targetCount = baseline.filter((row) => row.market === market
        && easternDate(row.featureCutoff) === slateDate && actionable(row)).length;
      if (targetCount === 0) continue;
      const candidates = slate
        .filter((row) => row.finalProbability >= 0.5)
        .filter((row) => row.expectedValue >= 0)
        .filter((row) => row.targetExcludedProbability >= 0.5)
        .filter((row) => row.targetExcludedBooks >= 1 && row.targetExcludedReferenceBooks >= 1)
        .sort((left, right) => {
          const leftBaseline = Number(actionable(baselineByScope.get(left.scopeKey) ?? { grade: "No Play" }));
          const rightBaseline = Number(actionable(baselineByScope.get(right.scopeKey) ?? { grade: "No Play" }));
          return rightBaseline - leftBaseline
            || artifactSignal(right, "model_market_conservative_expected_value")
              - artifactSignal(left, "model_market_conservative_expected_value")
            || right.finalProbability - left.finalProbability
            || right.expectedValue - left.expectedValue
            || left.scopeKey.localeCompare(right.scopeKey);
        });
      for (const row of candidates.slice(0, targetCount)) selected.add(row.scopeKey);
    }
  }
  return rows.map((row) => {
    const prior = baselineByScope.get(row.scopeKey)!;
    if (!selected.has(row.scopeKey)) {
      if (!actionable(prior)) return prior;
      return { ...prior, grade: row.finalProbability >= 0.5 ? "Watchlist" : "No Play" };
    }
    if (prior.grade === "Best Angle") return prior;
    return { ...prior, grade: "Lean" };
  });
}

function compareBoards(baseline: readonly GradedRow[], candidate: readonly GradedRow[]) {
  const baselineByScope = new Map(baseline.map((row) => [row.scopeKey, row]));
  const candidateByScope = new Map(candidate.map((row) => [row.scopeKey, row]));
  const changes = [...new Set([...baselineByScope.keys(), ...candidateByScope.keys()])].flatMap((scopeKey) => {
    const before = baselineByScope.get(scopeKey);
    const after = candidateByScope.get(scopeKey);
    const beforeGrade = before?.grade ?? "No Play";
    const afterGrade = after?.grade ?? "No Play";
    return beforeGrade === afterGrade ? [] : [{
      scopeKey,
      market: after?.market ?? before?.market ?? "unknown",
      before: beforeGrade,
      after: afterGrade,
      won: (after ?? before)!.finalSide === (after ?? before)!.outcomeSide,
    }];
  });
  const baselineActionable = baseline.filter(actionable);
  const candidateActionable = candidate.filter(actionable);
  const promoted = changes.filter((row) => gradeRank(row.after) < gradeRank(row.before));
  const demoted = changes.filter((row) => gradeRank(row.after) > gradeRank(row.before));
  return {
    baseline: summarizeBoard(baseline),
    candidate: summarizeBoard(candidate),
    boardImpact: {
      baselineActionables: baselineActionable.length,
      candidateActionables: candidateActionable.length,
      promotions: promoted.length,
      promotionWins: promoted.filter((row) => row.won).length,
      demotions: demoted.length,
      demotionWinsRemoved: demoted.filter((row) => row.won).length,
      changed: changes.length,
      promotionByMarket: countBy(promoted, (row) => row.market),
      demotionByMarket: countBy(demoted, (row) => row.market),
    },
  };
}

function candidatePolicies(): CandidatePolicy[] {
  const policies: CandidatePolicy[] = [];
  for (const signalFamily of SIGNALS) for (const eligibilityGate of GATES) {
    for (const minimumProbability of [0.50, 0.52, 0.54, 0.56, 0.58, 0.60]) {
      for (const minimumExpectedValue of [0, 0.01, 0.02, 0.03, 0.05, 0.08]) {
        for (const minimumAmericanPrice of [-200, -150, -130, -120, -110]) {
          for (const requireReferenceBook of [false, true]) {
            for (const maxPerSlate of [null, 1, 2, 3] as const) {
              policies.push({ signalFamily, eligibilityGate, minimumProbability, minimumExpectedValue,
                minimumAmericanPrice, requireReferenceBook, maxPerSlate });
            }
          }
        }
      }
    }
  }
  return policies;
}

function selectMarketPolicy(reliabilityRows: readonly Row[], gradeRows: readonly Row[]): FrozenMarketPolicy {
  const minimum = Math.max(6, Math.min(12, Math.floor(Math.min(reliabilityRows.length, gradeRows.length) * 0.025)));
  const evaluated = candidatePolicies().map((lean) => {
    const reliability = summarizeSelected(selectRows(reliabilityRows, lean));
    const grade = summarizeSelected(selectRows(gradeRows, lean));
    const qualified = reliability.records >= minimum && grade.records >= minimum
      && (reliability.hitRate ?? 0) >= 0.54 && (grade.hitRate ?? 0) >= 0.54
      && (reliability.roi ?? -1) > 0 && (grade.roi ?? -1) > 0;
    const weakestHit = Math.min(reliability.hitRate ?? 0, grade.hitRate ?? 0);
    const weakestRoi = Math.min(reliability.roi ?? -1, grade.roi ?? -1);
    const coverage = Math.min(reliability.records / Math.max(1, reliabilityRows.length), grade.records / Math.max(1, gradeRows.length));
    const score = weakestRoi + 0.5 * (weakestHit - 0.5) + 0.08 * Math.min(0.20, coverage);
    return { lean, reliability, grade, qualified, score };
  });
  const qualified = evaluated.filter((row) => row.qualified);
  const pool = qualified.length > 0 ? qualified : evaluated.filter((row) =>
    row.reliability.records >= minimum && row.grade.records >= minimum
    && (row.reliability.hitRate ?? 0) >= 0.52 && (row.grade.hitRate ?? 0) >= 0.52);
  const selected = (pool.length > 0 ? pool : evaluated).sort((left, right) =>
    right.score - left.score
    || Math.min(right.reliability.records, right.grade.records) - Math.min(left.reliability.records, left.grade.records)
    || policyKey(left.lean).localeCompare(policyKey(right.lean)))[0]!;
  const best = selectBestPolicy(
    selectRows(reliabilityRows, selected.lean),
    selectRows(gradeRows, selected.lean),
  );
  const reasons: string[] = [];
  if (!selected.qualified) reasons.push("no_policy_positive_at_54_percent_in_both_preconfirmation_windows");
  if (!best) reasons.push("best_angle_tier_not_preconfirmation_qualified");
  return {
    lean: selected.lean,
    best,
    preconfirmationQualified: reasons.length === 0 || (selected.qualified && reasons.length === 1),
    preconfirmationReasons: reasons,
  };
}

function selectBestPolicy(reliabilityRows: readonly Row[], gradeRows: readonly Row[]): BestPolicy | null {
  const candidates: BestPolicy[] = [];
  for (const minimumProbability of [0.56, 0.58, 0.60, 0.62, 0.65, 0.68]) {
    for (const minimumExpectedValue of [0.03, 0.05, 0.08, 0.10, 0.15]) {
      for (const requireReferenceBook of [false, true]) {
        candidates.push({ minimumProbability, minimumExpectedValue, requireReferenceBook });
      }
    }
  }
  const minimum = Math.max(3, Math.min(6, Math.floor(Math.min(reliabilityRows.length, gradeRows.length) * 0.20)));
  const evaluated = candidates.map((policy) => {
    const reliability = summarizeSelected(reliabilityRows.filter((row) => bestEligible(row, policy)));
    const grade = summarizeSelected(gradeRows.filter((row) => bestEligible(row, policy)));
    const qualified = reliability.records >= minimum && grade.records >= minimum
      && (reliability.hitRate ?? 0) >= 0.57 && (grade.hitRate ?? 0) >= 0.57
      && (reliability.roi ?? -1) > 0.02 && (grade.roi ?? -1) > 0.02;
    const score = Math.min(reliability.roi ?? -1, grade.roi ?? -1)
      + 0.5 * (Math.min(reliability.hitRate ?? 0, grade.hitRate ?? 0) - 0.5);
    return { policy, qualified, score };
  }).filter((row) => row.qualified)
    .sort((left, right) => right.score - left.score || bestPolicyKey(left.policy).localeCompare(bestPolicyKey(right.policy)));
  return evaluated[0]?.policy ?? null;
}

function selectRows(rows: readonly Row[], policy: CandidatePolicy): Row[] {
  const selectedEligible = rows.filter((row) => eligible(row, policy));
  if (policy.maxPerSlate === null) return selectedEligible;
  const bySlate = groupBy(selectedEligible, (row) => easternDate(row.featureCutoff));
  return [...bySlate.values()].flatMap((slate) => [...slate].sort((left, right) =>
    signal(right, policy.signalFamily) - signal(left, policy.signalFamily)
    || right.finalProbability - left.finalProbability
    || right.expectedValue - left.expectedValue
    || left.scopeKey.localeCompare(right.scopeKey)).slice(0, policy.maxPerSlate!));
}

function eligible(row: Row, policy: CandidatePolicy): boolean {
  const established = row.playerGamesPrior >= 10 && (row.minutesStandardDeviation10 ?? Infinity) <= 5;
  if (policy.eligibilityGate === "established_role" && !established) return false;
  if (policy.eligibilityGate === "not_back_to_back" && row.teamBackToBack) return false;
  if (policy.eligibilityGate === "established_role_not_back_to_back" && (!established || row.teamBackToBack)) return false;
  return row.finalProbability >= policy.minimumProbability
    && row.expectedValue >= policy.minimumExpectedValue
    && row.targetExcludedProbability >= 0.5
    && row.targetExcludedBooks >= 1
    && row.americanPrice >= policy.minimumAmericanPrice
    && (!policy.requireReferenceBook || row.targetExcludedReferenceBooks >= 1);
}

function bestEligible(row: Row, policy: BestPolicy): boolean {
  return row.finalProbability >= policy.minimumProbability
    && row.expectedValue >= policy.minimumExpectedValue
    && (!policy.requireReferenceBook || row.targetExcludedReferenceBooks >= 1);
}

function applyCandidatePolicies(
  rows: readonly Row[],
  policies: Partial<Record<string, FrozenMarketPolicy>>,
): GradedRow[] {
  const selected = new Set<string>();
  for (const [market, policy] of Object.entries(policies)) {
    if (!policy) continue;
    for (const row of selectRows(rows.filter((item) => item.market === market), policy.lean)) selected.add(row.scopeKey);
  }
  return rows.map((row) => {
    const policy = policies[row.market];
    if (!policy || !selected.has(row.scopeKey)) {
      const watch = row.finalProbability >= 0.5 && row.expectedValue >= 0 && row.targetExcludedProbability >= 0.5;
      return { ...row, grade: watch ? "Watchlist" : "No Play" };
    }
    return { ...row, grade: policy.best && bestEligible(row, policy.best) ? "Best Angle" : "Lean" };
  });
}

function applyArtifactPolicies(rows: readonly Row[], policies: ArtifactGradePolicies): GradedRow[] {
  const direct = rows.map((row) => ({ ...row, grade: artifactDirectGrade(row, policies[row.market]) }));
  const selected = new Set<string>();
  for (const market of MARKETS) {
    const config = policies[market];
    if (!config || config.kind !== "slate_relative_lean") continue;
    const policy = config.policy;
    for (const slate of groupBy(rows.filter((row) => row.market === market), (row) => easternDate(row.featureCutoff)).values()) {
      const candidates = slate.filter((row) => artifactEligibility(row, policy.eligibilityGate as string))
        .filter((row) => row.finalProbability >= Number(policy.minimumProbability))
        .filter((row) => row.expectedValue >= Number(policy.minimumExpectedValue))
        .filter((row) => row.americanPrice >= Number(policy.minimumAmericanPrice))
        .filter((row) => policy.requireReferenceBook !== true || row.targetExcludedReferenceBooks >= 1)
        .sort((left, right) => artifactSignal(right, policy.signalFamily as string) - artifactSignal(left, policy.signalFamily as string)
          || right.finalProbability - left.finalProbability || right.expectedValue - left.expectedValue
          || left.scopeKey.localeCompare(right.scopeKey));
      for (const row of candidates.slice(0, Number(policy.maxPerSlate))) selected.add(row.scopeKey);
    }
  }
  return direct.map((row) => selected.has(row.scopeKey) && !actionable(row)
    ? { ...row, grade: "Lean" as const } : row);
}

function artifactDirectGrade(row: Row, config: ArtifactGradeConfig | undefined): Grade {
  if (!config) return "No Play";
  const policy = config.policy;
  let grade: Grade = "No Play";
  if (config.kind === "ranked") {
    const isEligible = artifactEligibility(row, policy.eligibilityGate as string);
    const score = artifactSignal(row, policy.signalFamily as string);
    const best = artifactSignal(row, policy.bestSignalFamily as string);
    const priceQualified = row.americanPrice >= Number(policy.minimumAmericanPrice);
    if (isEligible && priceQualified && score >= Number(policy.leanThreshold) && best >= Number(policy.bestThreshold)) {
      grade = config.bestAngleQualified === false ? "Lean" : "Best Angle";
    } else if (isEligible && priceQualified && score >= Number(policy.leanThreshold)) grade = "Lean";
    else if (isEligible && score >= Number(policy.leanThreshold)) grade = "Watchlist";
  } else if (config.kind === "threshold_relative_best") {
    if (row.finalProbability >= Number(policy.bestProbability) && row.expectedValue >= Number(policy.bestEv)
      && row.targetExcludedProbability >= Number(policy.bestMarketProbability) && row.targetExcludedReferenceBooks >= 1) {
      grade = "Best Angle";
    } else if (row.finalProbability >= Number(policy.leanProbability) && row.expectedValue >= Number(policy.leanEv)
      && row.targetExcludedProbability >= Number(policy.leanMarketProbability)
      && (policy.leanRequiresReferenceBook !== true || row.targetExcludedReferenceBooks >= 1)) grade = "Lean";
    else if (row.finalProbability >= Number(policy.watchProbability) && row.expectedValue >= Number(policy.watchEv)) grade = "Watchlist";
    if (actionable({ ...row, grade }) && config.relativeBest) {
      grade = artifactSignal(row, config.relativeBest.signalFamily) >= Number(config.relativeBest.threshold) ? "Best Angle" : "Lean";
    }
  }
  return actionable({ ...row, grade }) && row.finalProbability < 0.5 ? "Watchlist" : grade;
}

function artifactEligibility(row: Row, gate: string): boolean {
  const established = row.playerGamesPrior >= 10 && (row.minutesStandardDeviation10 ?? Infinity) <= 5;
  if (gate === "established_role") return established;
  if (gate === "not_back_to_back") return !row.teamBackToBack;
  if (gate === "established_role_not_back_to_back") return established && !row.teamBackToBack;
  if (gate === "over_only") return row.finalSide === "over";
  if (gate === "under_only") return row.finalSide === "under";
  if (gate === "established_role_over") return established && row.finalSide === "over";
  if (gate === "established_role_under") return established && row.finalSide === "under";
  return true;
}

function artifactSignal(row: Row, family: string): number {
  if (family === "raw_model_probability") return row.rawFinalProbability;
  if (family === "projection_distance") return Math.abs(row.finalProjection - row.line) / Math.max(0.25, row.projectionStandardDeviation);
  if (family === "target_excluded_probability") return row.targetExcludedProbability;
  if (family === "target_price_probability") return implied(row.americanPrice);
  if (family === "market_consensus") return (row.targetExcludedProbability + implied(row.americanPrice)) / 2;
  if (family === "model_market_consensus") return (row.rawFinalProbability + row.targetExcludedProbability + implied(row.americanPrice)) / 3;
  if (family === "target_excluded_expected_value") return priceEv(row.targetExcludedProbability, row.americanPrice);
  const probability = family === "model_market_conservative_expected_value"
    ? Math.min(row.rawFinalProbability, row.targetExcludedProbability)
    : (row.rawFinalProbability + row.targetExcludedProbability) / 2;
  return priceEv(probability, row.americanPrice);
}

function signal(row: Row, family: SignalFamily): number {
  if (family === "final_probability") return row.finalProbability;
  if (family === "raw_probability") return row.rawFinalProbability;
  if (family === "projection_distance") return Math.abs(row.finalProjection - row.line) / Math.max(0.25, row.projectionStandardDeviation);
  if (family === "target_excluded_probability") return row.targetExcludedProbability;
  if (family === "target_excluded_expected_value") return priceEv(row.targetExcludedProbability, row.americanPrice);
  const probability = family === "model_market_conservative_expected_value"
    ? Math.min(row.rawFinalProbability, row.targetExcludedProbability)
    : (row.rawFinalProbability + row.targetExcludedProbability) / 2;
  return priceEv(probability, row.americanPrice);
}

type Summary = ReturnType<typeof summarizeSelected> & Readonly<{ nonnegativeEvShare: number | null }>;

function summarizeBoard(rows: readonly GradedRow[]) {
  const actionables = rows.filter(actionable);
  const bestAngles = rows.filter((row) => row.grade === "Best Angle");
  const leans = rows.filter((row) => row.grade === "Lean");
  const watchlists = rows.filter((row) => row.grade === "Watchlist");
  const noPlays = rows.filter((row) => row.grade === "No Play");
  return {
    all: summarizeSelected(rows),
    actionable: { ...summarizeSelected(actionables), nonnegativeEvShare: share(actionables, (row) => row.expectedValue >= 0) },
    bestAngle: summarizeSelected(bestAngles),
    lean: summarizeSelected(leans),
    watchlist: summarizeSelected(watchlists),
    noPlay: summarizeSelected(noPlays),
    boardShare: rows.length > 0 ? actionables.length / rows.length : null,
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, {
      all: summarizeSelected(rows.filter((row) => row.market === market)),
      actionable: summarizeSelected(actionables.filter((row) => row.market === market)),
    }])),
  };
}

function summarizeSelected(rows: readonly Row[]) {
  const wins = rows.filter((row) => row.finalSide === row.outcomeSide).length;
  const units = rows.reduce((sum, row) => sum + unitReturn(row.finalSide === row.outcomeSide, row.americanPrice), 0);
  return {
    records: rows.length,
    wins,
    losses: rows.length - wins,
    hitRate: rows.length > 0 ? wins / rows.length : null,
    units,
    roi: rows.length > 0 ? units / rows.length : null,
    overs: rows.filter((row) => row.finalSide === "over").length,
    unders: rows.filter((row) => row.finalSide === "under").length,
    games: new Set(rows.map((row) => row.gameId)).size,
    players: new Set(rows.map((row) => row.playerId)).size,
    averageProbability: rows.length > 0 ? mean(rows.map((row) => row.finalProbability)) : null,
    averageImpliedProbability: rows.length > 0 ? mean(rows.map((row) => implied(row.americanPrice))) : null,
  };
}

function clusterInterval(rows: readonly Row[], key: (row: Row) => string) {
  const clusters = [...groupBy(rows, key).values()];
  if (clusters.length === 0) return { clusters: 0, hitRate95: null, roi95: null };
  let state = 0x9e3779b9;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const hitRates: number[] = [];
  const rois: number[] = [];
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const sample = Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]!).flat();
    const summary = summarizeSelected(sample);
    hitRates.push(summary.hitRate ?? 0);
    rois.push(summary.roi ?? 0);
  }
  hitRates.sort((a, b) => a - b); rois.sort((a, b) => a - b);
  return {
    clusters: clusters.length,
    hitRate95: [quantile(hitRates, 0.025), quantile(hitRates, 0.975)],
    roi95: [quantile(rois, 0.025), quantile(rois, 0.975)],
  };
}

function pairedClusterDelta(
  baseline: readonly GradedRow[],
  candidate: readonly GradedRow[],
  key: (row: Row) => string,
) {
  const baselineClusters = groupBy(baseline.filter(actionable), key);
  const candidateClusters = groupBy(candidate.filter(actionable), key);
  const keys = [...new Set([...baselineClusters.keys(), ...candidateClusters.keys()])].sort();
  if (keys.length === 0) return { clusters: 0, hitRateDelta95: null, roiDelta95: null };
  let state = 0x85ebca6b;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const hitDeltas: number[] = [];
  const roiDeltas: number[] = [];
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const sampledKeys = Array.from({ length: keys.length }, () => keys[Math.floor(random() * keys.length)]!);
    const baselineSample = sampledKeys.flatMap((clusterKey) => baselineClusters.get(clusterKey) ?? []);
    const candidateSample = sampledKeys.flatMap((clusterKey) => candidateClusters.get(clusterKey) ?? []);
    const baselineSummary = summarizeSelected(baselineSample);
    const candidateSummary = summarizeSelected(candidateSample);
    hitDeltas.push((candidateSummary.hitRate ?? 0) - (baselineSummary.hitRate ?? 0));
    roiDeltas.push((candidateSummary.roi ?? 0) - (baselineSummary.roi ?? 0));
  }
  hitDeltas.sort((a, b) => a - b); roiDeltas.sort((a, b) => a - b);
  return {
    clusters: keys.length,
    hitRateDelta95: [quantile(hitDeltas, 0.025), quantile(hitDeltas, 0.975)],
    roiDelta95: [quantile(roiDeltas, 0.025), quantile(roiDeltas, 0.975)],
  };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) ?? []), row]);
  return result;
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  return Object.fromEntries([...groupBy(rows, key)].map(([name, values]) => [name, values.length]));
}

function actionable(row: { grade: Grade }): boolean {
  return row.grade === "Best Angle" || row.grade === "Lean";
}

function gradeRank(grade: Grade): number {
  return grade === "Best Angle" ? 0 : grade === "Lean" ? 1 : grade === "Watchlist" ? 2 : 3;
}

function implied(price: number): number {
  return price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
}

function priceEv(probability: number, price: number): number {
  return probability * (price > 0 ? price / 100 : 100 / Math.abs(price)) - (1 - probability);
}

function unitReturn(won: boolean, price: number): number {
  return won ? (price > 0 ? price / 100 : 100 / Math.abs(price)) : -1;
}

function easternDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

function policyKey(policy: CandidatePolicy): string {
  return JSON.stringify(policy);
}

function bestPolicyKey(policy: BestPolicy): string {
  return JSON.stringify(policy);
}

function share<T>(rows: readonly T[], predicate: (row: T) => boolean): number | null {
  return rows.length > 0 ? rows.filter(predicate).length / rows.length : null;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values: readonly number[], probability: number): number | null {
  if (values.length === 0) return null;
  return values[Math.max(0, Math.min(values.length - 1, Math.floor(probability * (values.length - 1))))]!;
}

void main();
