/** Offline-only comparison of a candidate forecast against an existing frozen grade policy. */
import { readFile, writeFile } from "node:fs/promises";
import { nbaPlayerPropsArtifactSha256 } from "../../../lib/services/nba/nbaPlayerPropsArtifactChecksum";

type Grade = "Best Angle" | "Lean" | "Watchlist" | "No Play";
type Row = Record<string, unknown> & {
  scopeKey: string;
  featureCutoff: string;
  market: string;
  finalSide: string;
  outcomeSide: string;
  finalProbability: number;
  rawFinalProbability: number;
  targetExcludedProbability: number;
  targetExcludedReferenceBooks: number;
  americanPrice: number;
  expectedValue: number;
  finalProjection: number;
  line: number;
  projectionStandardDeviation: number;
  playerGamesPrior: number;
  minutesStandardDeviation10: number | null;
  teamBackToBack: boolean;
};

function value(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required.`);
  return process.argv[index + 1]!;
}

const implied = (price: number) => price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
const ev = (probability: number, price: number) => probability * (price > 0 ? price / 100 : 100 / Math.abs(price)) - (1 - probability);
const unitReturn = (won: boolean, price: number) => won ? (price > 0 ? price / 100 : 100 / Math.abs(price)) : -1;

function signal(row: Row, family: string): number {
  const targetPrice = implied(row.americanPrice);
  if (family === "raw_model_probability") return row.rawFinalProbability;
  if (family === "projection_distance") return Math.abs(row.finalProjection - row.line) / Math.max(0.25, row.projectionStandardDeviation);
  if (family === "target_excluded_probability") return row.targetExcludedProbability;
  if (family === "target_price_probability") return targetPrice;
  if (family === "market_consensus") return (row.targetExcludedProbability + targetPrice) / 2;
  if (family === "model_market_consensus") return (row.rawFinalProbability + row.targetExcludedProbability + targetPrice) / 3;
  if (family === "target_excluded_expected_value") return ev(row.targetExcludedProbability, row.americanPrice);
  const probability = family === "model_market_conservative_expected_value"
    ? Math.min(row.rawFinalProbability, row.targetExcludedProbability)
    : (row.rawFinalProbability + row.targetExcludedProbability) / 2;
  return ev(probability, row.americanPrice);
}

function eligible(row: Row, gate: string): boolean {
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

function directGrade(row: Row, config: Record<string, any>): Grade {
  let grade: Grade = "No Play";
  const policy = config.policy;
  if (config.kind === "ranked") {
    const isEligible = eligible(row, policy.eligibilityGate);
    const score = signal(row, policy.signalFamily);
    const best = signal(row, policy.bestSignalFamily);
    const priceQualified = row.americanPrice >= policy.minimumAmericanPrice;
    if (isEligible && priceQualified && score >= policy.leanThreshold && best >= policy.bestThreshold) {
      grade = config.bestAngleQualified === false ? "Lean" : "Best Angle";
    } else if (isEligible && priceQualified && score >= policy.leanThreshold) grade = "Lean";
    else if (isEligible && score >= policy.leanThreshold) grade = "Watchlist";
  } else if (config.kind === "threshold_relative_best") {
    if (row.finalProbability >= policy.bestProbability && row.expectedValue >= policy.bestEv
      && row.targetExcludedProbability >= policy.bestMarketProbability && row.targetExcludedReferenceBooks >= 1) grade = "Best Angle";
    else if (row.finalProbability >= policy.leanProbability && row.expectedValue >= policy.leanEv
      && row.targetExcludedProbability >= policy.leanMarketProbability
      && (!policy.leanRequiresReferenceBook || row.targetExcludedReferenceBooks >= 1)) grade = "Lean";
    else if (row.finalProbability >= policy.watchProbability && row.expectedValue >= policy.watchEv) grade = "Watchlist";
    if ((grade === "Best Angle" || grade === "Lean") && config.relativeBest) {
      grade = signal(row, config.relativeBest.signalFamily) >= config.relativeBest.threshold ? "Best Angle" : "Lean";
    }
  }
  if ((grade === "Best Angle" || grade === "Lean") && row.finalProbability < 0.5) return "Watchlist";
  return grade;
}

const easternDate = (iso: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(iso));

async function main() {
  const parity = JSON.parse(await readFile(value("--parity"), "utf8"));
  const artifact = JSON.parse(await readFile(value("--artifact"), "utf8"));
  if (process.argv.includes("--promote-pr-one-per-slate")) {
    artifact.gradePolicies.points_rebounds = {
      kind: "slate_relative_lean",
      policy: {
        signalFamily: "target_price_probability",
        eligibilityGate: "all",
        maxPerSlate: 1,
        minimumProbability: 0.5,
        minimumExpectedValue: -0.03,
        minimumAmericanPrice: -130,
        requireReferenceBook: false,
      },
      publicQualified: false,
    };
  }
  const rows = (parity.rows as Row[]).map((row) => ({ ...row, grade: directGrade(row, artifact.gradePolicies[row.market]) }));
  const selected = new Set<string>();
  for (const market of Object.keys(artifact.gradePolicies)) {
    const config = artifact.gradePolicies[market];
    if (config.kind !== "slate_relative_lean") continue;
    const groups = new Map<string, Array<Row & { grade: Grade }>>();
    for (const row of rows.filter((item) => item.market === market)) {
      const date = easternDate(row.featureCutoff);
      groups.set(date, [...(groups.get(date) ?? []), row]);
    }
    for (const slateRows of groups.values()) {
      const policy = config.policy;
      const candidates = slateRows
        .filter((row) => eligible(row, policy.eligibilityGate))
        .filter((row) => row.finalProbability >= policy.minimumProbability)
        .filter((row) => row.expectedValue >= policy.minimumExpectedValue)
        .filter((row) => row.americanPrice >= policy.minimumAmericanPrice)
        .filter((row) => !policy.requireReferenceBook || row.targetExcludedReferenceBooks >= 1)
        .sort((left, right) => signal(right, policy.signalFamily) - signal(left, policy.signalFamily)
          || right.finalProbability - left.finalProbability || right.expectedValue - left.expectedValue
          || left.scopeKey.localeCompare(right.scopeKey));
      for (const row of candidates.slice(0, policy.maxPerSlate)) selected.add(row.scopeKey);
    }
  }
  const graded = rows.map((row) => selected.has(row.scopeKey) && row.grade !== "Best Angle" && row.grade !== "Lean"
    ? { ...row, grade: "Lean" as const } : row);
  const summarize = (subset: typeof graded) => {
    const wins = subset.filter((row) => row.finalSide === row.outcomeSide).length;
    const units = subset.reduce((sum, row) => sum + unitReturn(row.finalSide === row.outcomeSide, row.americanPrice), 0);
    return { records: subset.length, wins, losses: subset.length - wins, hitRate: subset.length ? wins / subset.length : null,
      units, roi: subset.length ? units / subset.length : null };
  };
  const output = {
    mode: "offline_research_only",
    actionable: false,
    all: summarize(graded),
    actionableSummary: summarize(graded.filter((row) => row.grade === "Best Angle" || row.grade === "Lean")),
    byGrade: Object.fromEntries((["Best Angle", "Lean", "Watchlist", "No Play"] as Grade[])
      .map((grade) => [grade, summarize(graded.filter((row) => row.grade === grade))])),
    byMarket: Object.fromEntries([...new Set(graded.map((row) => row.market))].map((market) => [market, {
      all: summarize(graded.filter((row) => row.market === market)),
      actionable: summarize(graded.filter((row) => row.market === market && (row.grade === "Best Angle" || row.grade === "Lean"))),
    }])),
  };
  if (process.argv.includes("--parity-output")) {
    await writeFile(value("--parity-output"), `${JSON.stringify({
      ...parity,
      release: "nba_player_props_frozen_runtime_parity_2026_10_22_r2",
      rows: graded,
    }, null, 2)}\n`, "utf8");
  }
  const candidateArtifactPath = process.argv.includes("--candidate-artifact")
    ? value("--candidate-artifact") : null;
  const candidateArtifactOutput = process.argv.includes("--candidate-artifact-output")
    ? value("--candidate-artifact-output") : null;
  if (candidateArtifactPath && candidateArtifactOutput) {
    const candidate = JSON.parse(await readFile(candidateArtifactPath, "utf8"));
    const { payloadSha256: _discarded, ...candidatePayload } = candidate;
    void _discarded;
    const payload = {
      ...candidatePayload,
      release: "nba_player_props_frozen_runtime_artifact_2026_10_22_r3_canonical_checksum",
      sourceTournamentRelease: "nba_player_props_model_tournament_2026_10_22_r12_robust_rebounds_full_refit",
      sourceGradeRelease: "nba_player_props_exact_price_grade_2026_10_22_r11_preserved_plus_pr_promotion",
      gradePolicies: artifact.gradePolicies,
    };
    const composed = {
      ...payload,
      payloadSha256: nbaPlayerPropsArtifactSha256(payload),
    };
    await writeFile(candidateArtifactOutput, `${JSON.stringify(composed, null, 2)}\n`, "utf8");
  }
  await writeFile(value("--output"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

void main();
