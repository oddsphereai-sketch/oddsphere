/**
 * Read-only MLB totals correction audit.
 *
 * Replays the current correction order from frozen prediction_records evidence
 * and compares every corrected side with the original probability side at each
 * side's real stored price/line. No provider calls, writes, or live changes.
 */
import { supabase } from "../../lib/db/supabase";

type Row = Record<string, any>;
type Side = "over" | "under";
type Result = "win" | "loss" | "push";

type Bet = {
  id: number;
  date: string;
  rule: string;
  originalSide: Side;
  finalSide: Side;
  originalLine: number;
  finalLine: number;
  originalOdds: number;
  finalOdds: number;
  originalProbability: number | null;
  finalProbability: number | null;
  actualTotal: number;
  source: "shipped" | "reconstructed";
  grade: string;
  actionable: boolean;
};

const WINDOWS = [
  { name: "train_2026-06-07_2026-06-21", from: "2026-06-07", to: "2026-06-21" },
  { name: "validation_2026-06-22_2026-07-10", from: "2026-06-22", to: "2026-07-10" },
  { name: "forward_2026-07-11_2026-07-19", from: "2026-07-11", to: "2026-07-19" },
  { name: "current_2026-07-20_forward", from: "2026-07-20", to: "9999-12-31" },
] as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function side(value: unknown): Side | null {
  return value === "over" || value === "under" ? value : null;
}

function opposite(value: Side): Side {
  return value === "over" ? "under" : "over";
}

function gradeRow(row: Row): Row | null {
  const grade = row.prediction_grades;
  return Array.isArray(grade) ? grade[0] ?? null : grade ?? null;
}

function actualTotal(row: Row): number | null {
  const value = gradeRow(row)?.actual_total;
  return finite(value) ? value : null;
}

function priceFor(row: Row, target: Side): { odds: number; line: number } | null {
  const source = row.snapshot_json?.odds_source_at_lock_ou?.[target];
  const odds = source?.odds;
  const line = source?.line ?? row.line_value;
  if (finite(odds) && finite(line)) return { odds, line };
  if (row.pick === target && finite(row.odds_american) && finite(row.line_value)) {
    return { odds: row.odds_american, line: row.line_value };
  }
  return null;
}

function result(target: Side, line: number, total: number): Result {
  if (total === line) return "push";
  if (target === "over") return total > line ? "win" : "loss";
  return total < line ? "win" : "loss";
}

function profit(outcome: Result, odds: number): number {
  if (outcome === "push") return 0;
  if (outcome === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function summarizeSide(bets: Bet[], which: "original" | "final") {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let units = 0;
  let probabilityCount = 0;
  let probabilitySum = 0;
  let outcomeSum = 0;
  let brierSum = 0;
  let logLossSum = 0;
  for (const bet of bets) {
    const outcome = result(
      which === "original" ? bet.originalSide : bet.finalSide,
      which === "original" ? bet.originalLine : bet.finalLine,
      bet.actualTotal,
    );
    if (outcome === "win") wins++;
    else if (outcome === "loss") losses++;
    else pushes++;
    units += profit(outcome, which === "original" ? bet.originalOdds : bet.finalOdds);
    const probability =
      which === "original" ? bet.originalProbability : bet.finalProbability;
    if (
      outcome !== "push" &&
      probability !== null &&
      probability > 0 &&
      probability < 1
    ) {
      const observed = outcome === "win" ? 1 : 0;
      probabilityCount++;
      probabilitySum += probability;
      outcomeSum += observed;
      brierSum += (probability - observed) ** 2;
      logLossSum += -(
        observed * Math.log(probability) +
        (1 - observed) * Math.log(1 - probability)
      );
    }
  }
  const risk = wins + losses;
  return {
    record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`,
    units: Number(units.toFixed(3)),
    roiPct: risk > 0 ? Number((units / risk * 100).toFixed(1)) : null,
    probabilityMetrics: probabilityCount > 0
      ? {
          rows: probabilityCount,
          brier: Number((brierSum / probabilityCount).toFixed(4)),
          logLoss: Number((logLossSum / probabilityCount).toFixed(4)),
          meanProbability: Number((probabilitySum / probabilityCount).toFixed(4)),
          observedWinRate: Number((outcomeSum / probabilityCount).toFixed(4)),
          calibrationGapPp: Number(
            ((probabilitySum - outcomeSum) / probabilityCount * 100).toFixed(2),
          ),
        }
      : null,
  };
}

function summary(bets: Bet[]) {
  const original = summarizeSide(bets, "original");
  const final = summarizeSide(bets, "final");
  return {
    bets: bets.length,
    original,
    corrected: final,
    correctedMinusOriginalUnits: Number((final.units - original.units).toFixed(3)),
  };
}

function grouped(bets: Bet[]) {
  const rules = [...new Set(bets.map((bet) => bet.rule))].sort();
  return Object.fromEntries(rules.map((rule) => {
    const ruleBets = bets.filter((bet) => bet.rule === rule);
    return [rule, {
      all: summary(ruleBets),
      windows: Object.fromEntries(WINDOWS.map((window) => [
        window.name,
        summary(ruleBets.filter((bet) => bet.date >= window.from && bet.date <= window.to)),
      ])),
    }];
  }));
}

async function pageAll(): Promise<Row[]> {
  const output: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select([
        "id",
        "slate_date",
        "pick",
        "line_value",
        "odds_american",
        "edge",
        "play_grade",
        "best_angle",
        "no_bet",
        "model_probability",
        "market_probability",
        "model_version",
        "calibration_version",
        "snapshot_json",
        "prediction_grades(result,actual_total)",
      ].join(","))
      .eq("sport", "mlb")
      .eq("market", "total")
      .gte("slate_date", "2026-06-07")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    output.push(...(data ?? []));
    if ((data ?? []).length < 1000) return output;
  }
}

function originalEvidence(row: Row): {
  side: Side;
  price: { odds: number; line: number };
  modelProb: number | null;
  marketProb: number | null;
  edgePp: number | null;
  projectedTotal: number | null;
  publicSupport: boolean;
  publicConflict: boolean;
  lineDirection: string | null;
} | null {
  const snapshot = row.snapshot_json ?? {};
  const flip = snapshot.ou_flip ?? {};
  const originalSide =
    side(flip.original_probability_side) ??
    side(flip.original_side) ??
    side(flip.original_pick) ??
    side(row.pick);
  if (originalSide === null) return null;
  const originalSource = snapshot.odds_source_at_lock_ou?.[originalSide];
  const originalOdds =
    finite(flip.original_odds) ? flip.original_odds :
    finite(originalSource?.odds) ? originalSource.odds :
    row.pick === originalSide && finite(row.odds_american) ? row.odds_american :
    null;
  const originalLine =
    finite(flip.original_side_line) ? flip.original_side_line :
    finite(originalSource?.line) ? originalSource.line :
    finite(row.line_value) ? row.line_value :
    null;
  if (!finite(originalOdds) || !finite(originalLine)) return null;

  const v22 = snapshot.v2_2_audit ?? {};
  const reconciliation = snapshot.total_projection_reconciliation ?? {};
  const publicSplits = snapshot.public_splits ?? {};
  const lineMovement = snapshot.line_movement ?? {};
  const correction = snapshot.market_aware_side_correction ?? {};
  return {
    side: originalSide,
    price: { odds: originalOdds, line: originalLine },
    modelProb:
      finite(flip.original_model_prob) ? flip.original_model_prob :
      finite(v22.ou_model_prob) ? v22.ou_model_prob :
      finite(row.model_probability) ? row.model_probability :
      null,
    marketProb:
      finite(v22.ou_market_prob) ? v22.ou_market_prob :
      finite(row.market_probability) ? row.market_probability :
      null,
    edgePp:
      finite(v22.ou_edge_pct) ? v22.ou_edge_pct :
      finite(flip.mid_edge_original_edge_pp) ? flip.mid_edge_original_edge_pp :
      finite(row.edge) ? row.edge :
      null,
    projectedTotal:
      finite(v22.posterior_total) ? v22.posterior_total :
      finite(reconciliation.raw_projected_total) ? reconciliation.raw_projected_total :
      finite(flip.posterior_total_internal) ? flip.posterior_total_internal :
      null,
    publicSupport:
      correction.original_public_split_support === true ||
      (side(publicSplits.picked_side) === originalSide && publicSplits.support === true),
    publicConflict:
      flip.opposing_public_split_conflict === true ||
      correction.original_public_split_conflict === true ||
      (side(publicSplits.picked_side) === originalSide && publicSplits.conflict === true),
    lineDirection:
      typeof correction.original_line_direction === "string"
        ? correction.original_line_direction
        : side(publicSplits.picked_side) === originalSide && typeof lineMovement.direction === "string"
          ? lineMovement.direction
          : null,
  };
}

function makeBet(
  row: Row,
  rule: string,
  original: NonNullable<ReturnType<typeof originalEvidence>>,
  finalSide: Side,
  source: Bet["source"],
): Bet | null {
  const total = actualTotal(row);
  const finalPrice = priceFor(row, finalSide);
  if (total === null || finalPrice === null || finalSide === original.side) return null;
  const flip = row.snapshot_json?.ou_flip ?? {};
  const correction = row.snapshot_json?.market_aware_side_correction ?? {};
  const rawFinalProbability =
    finite(flip.flipped_side_model_prob) ? flip.flipped_side_model_prob :
    finite(correction.raw_corrected_side_model_prob) ? correction.raw_corrected_side_model_prob :
    original.modelProb !== null ? 1 - original.modelProb :
    null;
  return {
    id: row.id,
    date: row.slate_date,
    rule,
    originalSide: original.side,
    finalSide,
    originalLine: original.price.line,
    finalLine: finalPrice.line,
    originalOdds: original.price.odds,
    finalOdds: finalPrice.odds,
    originalProbability: original.modelProb,
    finalProbability: rawFinalProbability,
    actualTotal: total,
    source,
    grade: row.best_angle === true ? "best_angle" : String(row.play_grade ?? "none").toLowerCase(),
    actionable:
      row.no_bet !== true &&
      (row.best_angle === true || ["best_angle", "lean"].includes(String(row.play_grade ?? "").toLowerCase())),
  };
}

function makeStraightBet(row: Row, rule: string): Bet | null {
  const picked = side(row.pick);
  const total = actualTotal(row);
  const pickedPrice = picked === null ? null : priceFor(row, picked);
  if (picked === null || total === null || pickedPrice === null) return null;
  return {
    id: row.id,
    date: row.slate_date,
    rule,
    originalSide: picked,
    finalSide: picked,
    originalLine: pickedPrice.line,
    finalLine: pickedPrice.line,
    originalOdds: pickedPrice.odds,
    finalOdds: pickedPrice.odds,
    originalProbability: finite(row.model_probability) ? row.model_probability : null,
    finalProbability: finite(row.model_probability) ? row.model_probability : null,
    actualTotal: total,
    source: "shipped",
    grade: row.best_angle === true ? "best_angle" : String(row.play_grade ?? "none").toLowerCase(),
    actionable:
      row.no_bet !== true &&
      (row.best_angle === true || ["best_angle", "lean"].includes(String(row.play_grade ?? "").toLowerCase())),
  };
}

function shippedBet(row: Row): Bet | null {
  const original = originalEvidence(row);
  const flip = row.snapshot_json?.ou_flip;
  if (original === null || !flip || flip.flipped !== true) return null;
  const finalSide = side(flip.final_side) ?? side(flip.flipped_pick) ?? side(row.pick);
  if (finalSide === null) return null;
  return makeBet(
    row,
    String(flip.flip_kind ?? flip.rule_id ?? "unknown"),
    original,
    finalSide,
    "shipped",
  );
}

function reconstructedBet(row: Row): Bet | null {
  const original = originalEvidence(row);
  if (original === null) return null;
  const oppositeSide = opposite(original.side);

  if (original.projectedTotal !== null) {
    const meanSide: Side =
      original.projectedTotal > original.price.line ? "over" :
      original.projectedTotal < original.price.line ? "under" :
      original.side;
    if (meanSide !== original.side) {
      return makeBet(row, "mean_side_selector", original, meanSide, "reconstructed");
    }
  }

  if (
    original.modelProb !== null &&
    original.marketProb !== null &&
    original.modelProb <= 0.575 &&
    original.marketProb < 0.5 &&
    original.publicConflict
  ) {
    return makeBet(
      row,
      "market_opposed_public_conflict",
      original,
      oppositeSide,
      "reconstructed",
    );
  }

  if (
    original.lineDirection !== "toward_pick" &&
    (original.publicSupport || original.publicConflict)
  ) {
    return makeBet(
      row,
      "market_aware_split_signal_fade",
      original,
      oppositeSide,
      "reconstructed",
    );
  }

  if (
    original.edgePp !== null &&
    Math.abs(original.edgePp) >= 3 &&
    Math.abs(original.edgePp) < 5
  ) {
    return makeBet(row, "mid_edge_inversion", original, oppositeSide, "reconstructed");
  }

  return null;
}

async function main() {
  const rows = await pageAll();
  const settled = rows.filter((row) => actualTotal(row) !== null);
  const shipped = settled.flatMap((row) => {
    const bet = shippedBet(row);
    return bet === null ? [] : [bet];
  });
  const reconstructed = settled.flatMap((row) => {
    const bet = reconstructedBet(row);
    return bet === null ? [] : [bet];
  });
  const cleanControls = settled.flatMap((row) => {
    if (row.snapshot_json?.ou_flip != null) return [];
    const markers = [
      row.snapshot_json?.total_clean_confirmed_best_angle_promotion
        ? "clean_confirmed_best_angle"
        : null,
      row.snapshot_json?.total_validated_lean
        ? `validated_lean_${row.snapshot_json.total_validated_lean.strength ?? "standard"}`
        : null,
    ].filter((value): value is string => value !== null);
    return markers.flatMap((marker) => {
      const bet = makeStraightBet(row, marker);
      return bet === null ? [] : [bet];
    });
  });
  const currentCorrectionActionables = shipped.filter(
    (bet) => bet.actionable && bet.date >= "2026-07-20",
  );
  const currentPromotionActionables = cleanControls.filter(
    (bet) => bet.actionable && bet.date >= "2026-07-20",
  );
  const coverage = {
    totalRows: rows.length,
    settledRows: settled.length,
    settledWithOriginalEvidence: settled.filter((row) => originalEvidence(row) !== null).length,
    shippedCorrections: shipped.length,
    reconstructedCurrentRuleCandidates: reconstructed.length,
  };
  console.log(JSON.stringify({
    mode: "read_only_totals_correction_audit",
    noWrites: true,
    methodology: {
      correctionOrder: [
        "mean_side_selector",
        "market_opposed_public_conflict",
        "market_aware_split_signal_fade",
        "mid_edge_inversion",
      ],
      prices: "real per-side odds_source_at_lock_ou only, with stored picked-side fallback",
      grading: "actual_total against each side's own stored line",
      caveat:
        "Reconstruction uses frozen production features. It tests current decision rules on available historical evidence; it does not regenerate unavailable raw model features.",
    },
    coverage,
    shipped: {
      all: summary(shipped),
      byRule: grouped(shipped),
      actionable: summary(shipped.filter((bet) => bet.actionable)),
      currentActionableByRuleGrade: Object.fromEntries(
        [...new Set(
          shipped
            .filter((bet) => bet.actionable && bet.date >= "2026-07-20")
            .map((bet) => `${bet.rule}:${bet.grade}`),
        )].sort().map((key) => [
          key,
          summary(
            shipped.filter(
              (bet) =>
                bet.actionable &&
                bet.date >= "2026-07-20" &&
                `${bet.rule}:${bet.grade}` === key,
            ),
          ),
        ]),
      ),
    },
    reconstructedCurrentOrder: {
      all: summary(reconstructed),
      byRule: grouped(reconstructed),
    },
    cleanUncorrectedPromotionControls: {
      note: "Tested actionable promotion rules paired with the correction demotion in decision release r1.",
      all: summary(cleanControls),
      actionable: summary(cleanControls.filter((bet) => bet.actionable)),
      byRule: grouped(cleanControls),
    },
    officialDecisionReleaseR1: {
      correctionAction: "NO_PLAY",
      promotionActions: [
        "clean_confirmed_best_angle => BET 0.25u",
        "validated_lean => BET 0.25u",
      ],
      currentBoardImpact: {
        correctionActionablesRemoved: currentCorrectionActionables.length,
        cleanActionablesRetainedOrPromoted: currentPromotionActionables.length,
        netActionableCountChange:
          currentPromotionActionables.length - currentCorrectionActionables.length,
        removedCohort: summary(currentCorrectionActionables),
        promotedCohort: summary(currentPromotionActionables),
      },
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
