/**
 * Read-only audit for the unified MLB Daily Edge candidate baseline.
 *
 * This report never blends historical rows into exact-current performance.
 * It separately reports:
 *   - exact decision-release evidence;
 *   - broader evidence produced by the current probability heads;
 *   - historical rule cohorts used to decide which sleeves remain actionable.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-mlb-unified-candidate.ts
 */

import { supabase } from "../../lib/db/supabase";
import {
  MLB_DAILY_EDGE_DECISION_RELEASE_ID,
  MLB_MODEL_LAYER_VERSION_IDS,
} from "../../lib/automodel/mlbModelLayerVersions";
import { snapshotHasTrueMoneylineInversion } from "../../lib/services/finalSideDecision";

type Row = Record<string, any>;
type Result = "win" | "loss" | "push";

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function relation(row: Row): Row | null {
  const value = row.prediction_grades;
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function result(row: Row): Result | null {
  const value = String(relation(row)?.result ?? "").toLowerCase();
  return value === "win" || value === "loss" || value === "push" ? value : null;
}

function profit(outcome: Result, odds: number | null): number | null {
  if (outcome === "push") return 0;
  if (odds === null || odds === 0) return null;
  if (outcome === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function expectedValue(row: Row): number | null {
  const probability = finite(row.model_probability);
  const odds = finite(row.odds_american);
  if (probability === null || odds === null || odds === 0) return null;
  const winProfit = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  return probability * winProfit - (1 - probability);
}

function evBucket(row: Row): string {
  const value = expectedValue(row);
  if (value === null) return "missing_ev";
  return value < 0 ? "negative_ev" : "non_negative_ev";
}

function publicGrade(row: Row): string {
  if (row.no_bet === true) return "no_play";
  if (row.best_angle === true) return "best_angle";
  return String(row.play_grade ?? "ungraded").toLowerCase();
}

function actionable(row: Row): boolean {
  if (row.no_bet === true || row.held === true) return false;
  const grade = publicGrade(row);
  return grade === "best_angle" || grade === "lean";
}

function clamp(p: number): number {
  return Math.min(0.999, Math.max(0.001, p));
}

function metrics(rows: Row[]) {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let units = 0;
  let priced = 0;
  let probabilityRows = 0;
  let probabilitySum = 0;
  let outcomeSum = 0;
  let brier = 0;
  let logLoss = 0;

  for (const row of rows) {
    const settled = result(row);
    if (settled === null) continue;
    if (settled === "win") wins++;
    else if (settled === "loss") losses++;
    else pushes++;

    const odds = finite(row.odds_american);
    const rowProfit = profit(settled, odds);
    if (rowProfit !== null) {
      units += rowProfit;
      priced++;
    }

    const probability = finite(row.model_probability);
    if (settled !== "push" && probability !== null && probability > 0 && probability < 1) {
      const observed = settled === "win" ? 1 : 0;
      probabilityRows++;
      probabilitySum += probability;
      outcomeSum += observed;
      brier += (probability - observed) ** 2;
      const p = clamp(probability);
      logLoss -= observed * Math.log(p) + (1 - observed) * Math.log(1 - p);
    }
  }

  const decisions = wins + losses;
  return {
    rows: rows.length,
    settled: wins + losses + pushes,
    record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`,
    units: Number(units.toFixed(3)),
    roiPct: priced ? Number((units / priced * 100).toFixed(1)) : null,
    probability:
      probabilityRows > 0
        ? {
            rows: probabilityRows,
            mean: Number((probabilitySum / probabilityRows).toFixed(4)),
            observed: Number((outcomeSum / probabilityRows).toFixed(4)),
            calibrationGapPp: Number(
              ((probabilitySum - outcomeSum) / probabilityRows * 100).toFixed(1),
            ),
            brier: Number((brier / probabilityRows).toFixed(4)),
            logLoss: Number((logLoss / probabilityRows).toFixed(4)),
          }
        : null,
    winRatePct: decisions ? Number((wins / decisions * 100).toFixed(1)) : null,
  };
}

function group(rows: Row[], key: (row: Row) => string) {
  return Object.fromEntries(
    [...new Set(rows.map(key))]
      .sort()
      .map((value) => [value, metrics(rows.filter((row) => key(row) === value))]),
  );
}

function countGroup(rows: Row[], key: (row: Row) => string) {
  return Object.fromEntries(
    [...new Set(rows.map(key))]
      .sort()
      .map((value) => [value, rows.filter((row) => key(row) === value).length]),
  );
}

function slateWeek(row: Row): string {
  const date = String(row.slate_date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "unknown";
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - ((day + 6) % 7));
  return value.toISOString().slice(0, 10);
}

function chronologicalSplit(row: Row): string {
  const date = String(row.slate_date ?? "");
  if (date <= "2026-07-17") return "train_2026-07-11_to_17";
  if (date <= "2026-07-22") return "validation_2026-07-18_to_22";
  return "untouched_2026-07-23_forward";
}

function decisionRule(row: Row): string {
  return String(
    row.snapshot_json?.decision_pipeline?.action_rule_id ??
      row.snapshot_json?.ml_inversion_grade_resolution?.rule_id ??
      row.snapshot_json?.ml_clean_tight_edge_best_angle_promotion?.rule_id ??
      row.snapshot_json?.ml_tight_market_price_best_angle_promotion?.rule_id ??
      row.snapshot_json?.ml_mid_price_established_price_best_angle_promotion?.rule_id ??
      row.snapshot_json?.ml_mid_price_near_market_lean_promotion?.rule_id ??
      row.snapshot_json?.total_validated_lean?.rule_id ??
      row.snapshot_json?.total_clean_confirmed_best_angle_promotion?.rule_id ??
      "unattributed",
  );
}

function totalCorrectionRule(row: Row): string {
  return String(
    row.snapshot_json?.ou_flip?.rule_id ??
      row.snapshot_json?.totals_correction_rejection?.rule_id ??
      "unattributed",
  );
}

function decisionRelease(row: Row): string {
  return String(layer(row).decision_release_id ?? "unstamped");
}

function probabilityHead(row: Row): string {
  return String(layer(row).active_probability_head ?? row.calibration_version ?? "unstamped");
}

function modelEra(row: Row): string {
  return [
    `model=${String(row.model_version ?? "unstamped")}`,
    `head=${probabilityHead(row)}`,
    `release=${decisionRelease(row)}`,
  ].join("|");
}

function pairedProfitDelta(row: Row): number | null {
  const original = totalOriginalCounterfactual(row);
  if (original === null) return null;
  const settled = result(row);
  const originalSettled = result(original);
  if (settled === null || originalSettled === null) return null;
  const finalProfit = profit(settled, finite(row.odds_american));
  const originalProfit = profit(originalSettled, finite(original.odds_american));
  return finalProfit === null || originalProfit === null ? null : finalProfit - originalProfit;
}

function pairedCorrectionMetrics(rows: Row[]) {
  const deltas = rows.flatMap((row) => {
    const delta = pairedProfitDelta(row);
    return delta === null ? [] : [delta];
  });
  const originals = rows.flatMap((row) => {
    const original = totalOriginalCounterfactual(row);
    return original === null ? [] : [original];
  });
  return {
    corrected: metrics(rows),
    originalCounterfactual: metrics(originals),
    pairedRows: deltas.length,
    pairedUnitDelta: Number(deltas.reduce((sum, value) => sum + value, 0).toFixed(3)),
    correctionHelped: deltas.filter((value) => value > 0).length,
    correctionHurt: deltas.filter((value) => value < 0).length,
    correctionTied: deltas.filter((value) => value === 0).length,
  };
}

function groupPaired(rows: Row[], key: (row: Row) => string) {
  return Object.fromEntries(
    [...new Set(rows.map(key))]
      .sort()
      .map((value) => [value, pairedCorrectionMetrics(rows.filter((row) => key(row) === value))]),
  );
}

function layer(row: Row): Row {
  return row.snapshot_json?.model_layer_versions ?? {};
}

function activeHeadMatches(row: Row): boolean {
  const versions = layer(row);
  if (row.market === "moneyline") {
    return (
      versions.active_probability_head ===
      MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head
    );
  }
  if (row.market === "total") {
    return (
      versions.active_probability_head ===
      MLB_MODEL_LAYER_VERSION_IDS.total_probability_head
    );
  }
  return false;
}

function confidenceBucket(row: Row): string {
  const probability = finite(row.model_probability);
  if (probability === null) return "missing";
  if (probability < 0.55) return "lt_55";
  if (probability < 0.6) return "55_to_59_9";
  return "60_plus";
}

function totalOriginalCounterfactual(row: Row): Row | null {
  const flip = row.snapshot_json?.ou_flip;
  const grade = relation(row);
  const actual = finite(grade?.actual_total);
  const side = flip?.original_probability_side;
  const line = finite(flip?.market_total_internal ?? flip?.original_line);
  const odds = finite(flip?.original_odds);
  if (
    actual === null ||
    line === null ||
    odds === null ||
    (side !== "over" && side !== "under") ||
    actual === line
  ) {
    return null;
  }
  const won = side === "over" ? actual > line : actual < line;
  return {
    ...row,
    odds_american: odds,
    model_probability: finite(flip?.original_model_prob),
    prediction_grades: { result: won ? "win" : "loss" },
  };
}

async function pageAll(): Promise<Row[]> {
  const output: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select([
        "id",
        "game_id",
        "slate_date",
        "market",
        "pick",
        "side",
        "line_value",
        "odds_american",
        "model_probability",
        "market_probability",
        "confidence",
        "play_grade",
        "best_angle",
        "no_bet",
        "held",
        "launch_day",
        "locked_at",
        "model_version",
        "calibration_version",
        "snapshot_json",
        "prediction_grades(result,actual_total)",
      ].join(","))
      .eq("sport", "mlb")
      .in("market", ["moneyline", "total"])
      .gte("slate_date", "2026-06-07")
      .not("locked_at", "is", null)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    output.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) return output;
  }
}

async function currentSlateRows(slateDate: string): Promise<Row[]> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select([
      "id",
      "game_id",
      "slate_date",
      "market",
      "pick",
      "side",
      "line_value",
      "odds_american",
      "model_probability",
      "market_probability",
      "confidence",
      "play_grade",
      "best_angle",
      "no_bet",
      "held",
      "locked_at",
      "model_version",
      "calibration_version",
      "snapshot_json",
    ].join(","))
    .eq("sport", "mlb")
    .in("market", ["moneyline", "total"])
    .eq("slate_date", slateDate)
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

async function main() {
  const now = new Date();
  const currentSlateDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const currentSlate = await currentSlateRows(currentSlateDate);
  const source = (await pageAll()).filter(
    (row) => row.launch_day !== true && row.held !== true && result(row) !== null,
  );
  const daily = source.filter((row) => row.market === "moneyline" || row.market === "total");
  const exact = daily.filter(
    (row) => layer(row).decision_release_id === MLB_DAILY_EDGE_DECISION_RELEASE_ID,
  );
  const currentHeads = daily.filter(activeHeadMatches);
  const ml = currentHeads.filter((row) => row.market === "moneyline");
  const totals = currentHeads.filter((row) => row.market === "total");
  const currentHeadMlActionable = ml.filter(actionable);
  const currentHeadMlNegativeEvGenericLeans = currentHeadMlActionable.filter((row) => {
    const value = expectedValue(row);
    return publicGrade(row) === "lean" && decisionRule(row) === "unattributed" &&
      value !== null && value < 0;
  });
  const currentSlateMlActionable = currentSlate.filter(
    (row) => row.market === "moneyline" && actionable(row),
  );
  const currentSlateMlNegativeEvGenericLeans = currentSlateMlActionable.filter((row) => {
    const value = expectedValue(row);
    return publicGrade(row) === "lean" && decisionRule(row) === "unattributed" &&
      value !== null && value < 0;
  });
  const inversions = source.filter(
    (row) => row.market === "moneyline" && snapshotHasTrueMoneylineInversion(row.snapshot_json),
  );
  const shippedTotalCorrections = source.filter(
    (row) =>
      row.market === "total" &&
      row.snapshot_json?.ou_flip?.flipped === true &&
      row.snapshot_json?.totals_correction_rejection == null,
  );
  const totalOriginals = shippedTotalCorrections.flatMap((row) => {
    const counterfactual = totalOriginalCounterfactual(row);
    return counterfactual === null ? [] : [counterfactual];
  });
  const totalCorrectionStandDowns = source.filter(
    (row) => row.market === "total" && row.snapshot_json?.totals_correction_rejection != null,
  );
  const validatedTotalLeans = source.filter(
    (row) => row.market === "total" && row.snapshot_json?.total_validated_lean != null,
  );
  const confirmedTotalBestAngles = source.filter(
    (row) =>
      row.market === "total" &&
      row.snapshot_json?.total_clean_confirmed_best_angle_promotion != null,
  );
  const latestDate = daily.map((row) => String(row.slate_date)).sort().at(-1) ?? null;
  const latestRows = latestDate === null
    ? []
    : daily.filter((row) => row.slate_date === latestDate);

  const report = {
    mode: "read_only_unified_mlb_candidate_audit",
    noWrites: true,
    authority: {
      expectedDecisionRelease: MLB_DAILY_EDGE_DECISION_RELEASE_ID,
      moneylineProbabilityHead:
        MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
      totalProbabilityHead: MLB_MODEL_LAYER_VERSION_IDS.total_probability_head,
      evidencePolicy:
        "Exact-release results are never blended with current-head or historical rule evidence.",
    },
    releaseIntegrity: {
      latestSettledDate: latestDate,
      latestRows: latestRows.length,
      latestByDecisionRelease: group(
        latestRows,
        (row) => String(layer(row).decision_release_id ?? "unstamped"),
      ),
      exactCurrent: metrics(exact),
      exactCurrentByMarket: group(exact, (row) => row.market),
    },
    currentLiveSlate: {
      slateDate: currentSlateDate,
      rows: currentSlate.length,
      games: new Set(currentSlate.map((row) => row.game_id)).size,
      locked: currentSlate.filter((row) => row.locked_at != null).length,
      unlocked: currentSlate.filter((row) => row.locked_at == null).length,
      byMarket: countGroup(currentSlate, (row) => String(row.market)),
      byDecisionRelease: countGroup(currentSlate, decisionRelease),
      byProbabilityHead: countGroup(currentSlate, probabilityHead),
      byModelVersion: countGroup(currentSlate, (row) => String(row.model_version ?? "unstamped")),
      byPublicGrade: countGroup(currentSlate, publicGrade),
      actionableByMarketAndRule: countGroup(
        currentSlate.filter(actionable),
        (row) => `${row.market}|${decisionRule(row)}`,
      ),
      actionableRows: currentSlate.filter(actionable).map((row) => ({
        id: row.id,
        gameId: row.game_id,
        market: row.market,
        pick: row.pick,
        odds: row.odds_american,
        probability: row.model_probability,
        expectedValuePct:
          expectedValue(row) === null ? null : Number((expectedValue(row)! * 100).toFixed(2)),
        grade: publicGrade(row),
        rule: decisionRule(row),
      })),
      moneylineGenericLeanPositiveEvGateImpact: {
        beforeActionable: currentSlateMlActionable.length,
        demotedNegativeEvGenericLeans: currentSlateMlNegativeEvGenericLeans.length,
        afterActionable:
          currentSlateMlActionable.length - currentSlateMlNegativeEvGenericLeans.length,
        retainedPromotionRules: countGroup(
          currentSlateMlActionable.filter(
            (row) => !currentSlateMlNegativeEvGenericLeans.includes(row),
          ),
          decisionRule,
        ),
        demotedRows: currentSlateMlNegativeEvGenericLeans.map((row) => ({
          id: row.id,
          gameId: row.game_id,
          pick: row.pick,
          odds: row.odds_american,
          probability: row.model_probability,
          expectedValuePct:
            expectedValue(row) === null ? null : Number((expectedValue(row)! * 100).toFixed(2)),
          grade: publicGrade(row),
          rule: decisionRule(row),
        })),
      },
      expectedReleaseRows: currentSlate.filter(
        (row) => decisionRelease(row) === MLB_DAILY_EDGE_DECISION_RELEASE_ID,
      ).length,
      liveMixedRelease: new Set(currentSlate.map(decisionRelease)).size > 1,
      candidateReleaseIsLive:
        currentSlate.length > 0 &&
        currentSlate.every(
          (row) => decisionRelease(row) === MLB_DAILY_EDGE_DECISION_RELEASE_ID,
        ),
    },
    currentProbabilityHeads: {
      moneyline: {
        all: metrics(ml),
        actionable: metrics(currentHeadMlActionable),
        byConfidence: group(ml, confidenceBucket),
        actionableByGrade: group(currentHeadMlActionable, publicGrade),
        actionableByExpectedValueSign: group(currentHeadMlActionable, evBucket),
        negativeEvGenericLean: metrics(currentHeadMlNegativeEvGenericLeans),
        negativeEvGenericLeanByWeek: group(currentHeadMlNegativeEvGenericLeans, slateWeek),
        genericLeanPositiveEvGateCounterfactual: {
          before: metrics(currentHeadMlActionable),
          demoted: metrics(currentHeadMlNegativeEvGenericLeans),
          retained: metrics(
            currentHeadMlActionable.filter((row) => {
              return !currentHeadMlNegativeEvGenericLeans.includes(row);
            }),
          ),
        },
      },
      total: {
        all: metrics(totals),
        actionable: metrics(totals.filter(actionable)),
        byConfidence: group(totals, confidenceBucket),
        actionableByGrade: group(totals.filter(actionable), publicGrade),
      },
    },
    individualDecisionRules: {
      exactCurrentByRule: group(exact, decisionRule),
      currentHeadActionableByRule: group(currentHeads.filter(actionable), decisionRule),
      currentHeadActionableByMarketAndRule: group(
        currentHeads.filter(actionable),
        (row) => `${row.market}|${decisionRule(row)}`,
      ),
      currentHeadActionableByMarketRuleAndSide: group(
        currentHeads.filter(actionable),
        (row) => `${row.market}|${decisionRule(row)}|${String(row.side ?? row.pick ?? "unknown").toLowerCase()}`,
      ),
      currentHeadActionableByMarketGradeAndSide: group(
        currentHeads.filter(actionable),
        (row) => `${row.market}|${publicGrade(row)}|${String(row.side ?? row.pick ?? "unknown").toLowerCase()}`,
      ),
      currentHeadActionableByRuleAndChronologicalSplit: group(
        currentHeads.filter(actionable),
        (row) => `${decisionRule(row)}|${chronologicalSplit(row)}`,
      ),
      currentHeadActionableByRuleAndWeek: group(
        currentHeads.filter(actionable),
        (row) => `${decisionRule(row)}|week_${slateWeek(row)}`,
      ),
      allHistoricalByRuleAndModelEra: group(
        daily.filter(actionable),
        (row) => `${decisionRule(row)}|${modelEra(row)}`,
      ),
    },
    ruleEvidence: {
      genuineMoneylineInversion: {
        allHistoricalLocked: metrics(inversions),
        actionableAtLock: metrics(inversions.filter(actionable)),
        byWeek: group(inversions, slateWeek),
      },
      totalsCorrections: {
        allShippedPaired: pairedCorrectionMetrics(shippedTotalCorrections),
        shippedByRule: groupPaired(shippedTotalCorrections, totalCorrectionRule),
        shippedByRuleAndModelEra: groupPaired(
          shippedTotalCorrections,
          (row) => `${totalCorrectionRule(row)}|${modelEra(row)}`,
        ),
        shippedByRuleAndWeek: groupPaired(
          shippedTotalCorrections,
          (row) => `${totalCorrectionRule(row)}|week_${slateWeek(row)}`,
        ),
        currentStandDownTriggers: metrics(totalCorrectionStandDowns),
        standDownTriggersByRule: group(totalCorrectionStandDowns, totalCorrectionRule),
      },
      totalsReleasedSleeves: {
        validatedLean: metrics(validatedTotalLeans),
        validatedLeanByWeek: group(validatedTotalLeans, slateWeek),
        cleanConfirmedBestAngle: metrics(confirmedTotalBestAngles),
        cleanConfirmedBestAngleByWeek: group(confirmedTotalBestAngles, slateWeek),
      },
    },
    candidateClassification: {
      freezeAsComparisonBaseline: [
        "projection_core_v2_2",
        "moneyline_probability_head_k01_cap6",
        "total_probability_head_k04_cap8",
        "member_facing_lock_writer_authority",
        "shared_sport_prediction_pipeline_lease",
      ],
      evaluateIndividuallyNoExpansion: [
        "generic_moneyline_lean_positive_ev_gate",
        "genuine_final_side_moneyline_inversion",
        "tight_market_price_moneyline_best_angle",
        "validated_total_lean_marker",
        "current_total_best_angle_policy",
        "each_totals_correction_stand_down_family",
      ],
      excludeFromOfficialWagering: [
        "automatic_total_flip",
        "unstamped_or_mixed_release_rows_as_current_evidence",
      ],
      shadowOnly: [
        "any_other_new_moneyline_or_total_promotion_or_demotion",
        "moneyline_60_plus_probability_recalibration",
        "total_55_plus_probability_recalibration",
        "each_total_flip_family_independently",
      ],
    },
  };
  const section = process.argv.find((arg) => arg.startsWith("--section="))?.slice("--section=".length);
  if (section) {
    console.log(JSON.stringify({
      mode: report.mode,
      noWrites: report.noWrites,
      section,
      value: (report as Record<string, unknown>)[section] ?? null,
    }, null, 2));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
