/**
 * Read-only, fixed-candidate discovery audit for the active MLB probability
 * heads. It does not write predictions or tune a threshold on holdout rows.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-mlb-current-head-rule-discovery.ts
 */

import { supabase } from "../../lib/db/supabase";
import { MLB_MODEL_LAYER_VERSION_IDS } from "../../lib/automodel/mlbModelLayerVersions";

type Row = Record<string, any>;
type Result = "win" | "loss" | "push";
type Candidate = {
  id: string;
  market: "moneyline" | "total";
  target: "lean" | "best_angle";
  filter: (row: Row) => boolean;
};

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
  if (outcome === "loss") return -1;
  if (odds === null || odds === 0) return null;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
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
    if (settled === "loss") losses++;
    if (settled === "push") pushes++;
    const rowProfit = profit(settled, finite(row.odds_american));
    if (rowProfit !== null) {
      units += rowProfit;
      priced++;
    }
    const probability = finite(row.model_probability);
    if (settled !== "push" && probability !== null && probability > 0 && probability < 1) {
      const observed = settled === "win" ? 1 : 0;
      const p = Math.max(0.001, Math.min(0.999, probability));
      probabilityRows++;
      probabilitySum += p;
      outcomeSum += observed;
      brier += (p - observed) ** 2;
      logLoss -= observed * Math.log(p) + (1 - observed) * Math.log(1 - p);
    }
  }
  const decisions = wins + losses;
  return {
    rows: rows.length,
    record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`,
    units: +units.toFixed(3),
    roiPct: priced ? +(units / priced * 100).toFixed(1) : null,
    winRatePct: decisions ? +(wins / decisions * 100).toFixed(1) : null,
    probability: probabilityRows
      ? {
          mean: +(probabilitySum / probabilityRows).toFixed(4),
          observed: +(outcomeSum / probabilityRows).toFixed(4),
          calibrationGapPp: +((probabilitySum - outcomeSum) / probabilityRows * 100).toFixed(1),
          brier: +(brier / probabilityRows).toFixed(4),
          logLoss: +(logLoss / probabilityRows).toFixed(4),
        }
      : null,
  };
}

function split(row: Row): "train" | "validation" | "holdout" {
  const date = String(row.slate_date);
  if (date <= "2026-07-17") return "train";
  if (date <= "2026-07-22") return "validation";
  return "holdout";
}

function layer(row: Row): Row {
  return row.snapshot_json?.model_layer_versions ?? {};
}

function currentHead(row: Row): boolean {
  const head = layer(row).active_probability_head;
  if (row.market === "moneyline") return head === MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head;
  if (row.market === "total") return head === MLB_MODEL_LAYER_VERSION_IDS.total_probability_head;
  if (row.market === "first_inning") return head === MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head;
  return false;
}

function reconstructCurrentMoneylineHead(row: Row): Row | null {
  if (row.market !== "moneyline" || finalSideChanged(row)) return null;
  const audit = row.snapshot_json?.v2_2_audit;
  const raw = finite(audit?.ml_raw_model_prob);
  const market = finite(audit?.ml_market_prob);
  if (raw === null || market === null || raw <= 0 || raw >= 1 || market <= 0 || market >= 1) return null;
  const unbounded = market + 0.1 * (raw - market);
  const probability = Math.max(market - 0.06, Math.min(market + 0.06, unbounded));
  return {
    ...row,
    model_probability: probability,
    market_probability: market,
    edge: (probability - market) * 100,
  };
}

function publicGrade(row: Row): string {
  if (row.no_bet === true) return "no_play";
  if (row.best_angle === true) return "best_angle";
  return String(row.play_grade ?? "ungraded").toLowerCase();
}

function actionable(row: Row): boolean {
  const grade = publicGrade(row);
  return row.no_bet !== true && row.held !== true && (grade === "lean" || grade === "best_angle");
}

function edgePp(row: Row): number | null {
  const edge = finite(row.edge);
  if (edge === null) return null;
  return row.market === "first_inning" ? edge * 100 : edge;
}

function movement(row: Row): string {
  return String(row.snapshot_json?.line_movement?.direction ?? "unknown");
}

function support(row: Row): boolean {
  return row.snapshot_json?.public_splits?.support === true;
}

function conflict(row: Row): boolean {
  return row.snapshot_json?.public_splits?.conflict === true;
}

function finalSideChanged(row: Row): boolean {
  return row.snapshot_json?.decision_pipeline?.final_side_changed === true ||
    row.snapshot_json?.pick_calibration?.applied === true ||
    row.snapshot_json?.market_aware_side_correction?.applied === true ||
    row.snapshot_json?.ml_flip?.flipped === true ||
    row.snapshot_json?.ou_flip?.flipped === true;
}

function clean(row: Row): boolean {
  return !finalSideChanged(row) &&
    row.held !== true &&
    row.snapshot_json?.v2_2_audit?.provisional !== true &&
    row.snapshot_json?.data_integrity?.held !== true;
}

function priceBetween(row: Row, min: number, max: number): boolean {
  const price = finite(row.odds_american);
  return price !== null && price >= min && price <= max;
}

function projectionAligned(row: Row): boolean {
  if (row.market === "moneyline") {
    const score = row.snapshot_json?.predicted_scores_at_lock;
    const away = finite(score?.away);
    const home = finite(score?.home);
    if (away === null || home === null || away === home) return false;
    return row.side === "away" ? away > home : row.side === "home" ? home > away : false;
  }
  const reconciliation = row.snapshot_json?.total_projection_reconciliation;
  const projected = finite(reconciliation?.reconciled_total) ??
    finite(row.snapshot_json?.v2_2_audit?.posterior_total);
  const line = finite(row.line_value);
  if (projected === null || line === null || projected === line) return false;
  return row.side === "over" ? projected > line : row.side === "under" ? projected < line : false;
}

function totalProjectionGap(row: Row): number | null {
  const reconciliation = row.snapshot_json?.total_projection_reconciliation;
  const projected = finite(reconciliation?.reconciled_total) ??
    finite(row.snapshot_json?.v2_2_audit?.posterior_total);
  const line = finite(row.line_value);
  return projected === null || line === null ? null : Math.abs(projected - line);
}

function mlProjectionGap(row: Row): number | null {
  const score = row.snapshot_json?.predicted_scores_at_lock;
  const away = finite(score?.away);
  const home = finite(score?.home);
  if (away === null || home === null) return null;
  if (row.side === "away") return away - home;
  if (row.side === "home") return home - away;
  return null;
}

function currentRuleWouldAction(row: Row): boolean {
  const edge = edgePp(row);
  const price = finite(row.odds_american);
  const probability = finite(row.model_probability);
  if (!clean(row) || edge === null || price === null || probability === null) return false;
  if (movement(row) === "against_pick" || conflict(row)) return false;
  if (row.market === "moneyline") {
    const gap = mlProjectionGap(row);
    const cleanTight =
      probability >= 0.55 && probability < 0.58 &&
      edge >= 0.5 && price > -220 &&
      gap !== null && Math.abs(gap) < 0.75;
    const tightPrice =
      edge >= -1 && edge < 1 && price >= -160 && price <= -131;
    const midPrice =
      edge >= -1 && edge < 2 && price >= -145 && price <= -121 &&
      (gap === null || gap >= 0);
    const winProfit = price > 0 ? price / 100 : 100 / Math.abs(price);
    const positiveEv = probability * winProfit - (1 - probability) >= 0;
    const genericLean =
      row.snapshot_json?.v2_2_audit?.ml_play_grade === "lean" &&
      probability >= 0.55 && positiveEv && gap !== null && Math.abs(gap) >= 0.5;
    return cleanTight || tightPrice || midPrice || genericLean;
  }
  if (row.market === "total") {
    const gap = totalProjectionGap(row);
    return probability >= 0.54 && edge >= 5 && price > -145 &&
      gap !== null && gap >= 0.25 && projectionAligned(row);
  }
  return false;
}

function basePromotion(row: Row): boolean {
  return !actionable(row) &&
    !currentRuleWouldAction(row) &&
    clean(row) &&
    projectionAligned(row) &&
    movement(row) !== "against_pick" &&
    !conflict(row);
}

const candidates: Candidate[] = [
  {
    id: "ml_clean_55_60_edge_nonnegative",
    market: "moneyline",
    target: "lean",
    filter: (r) => basePromotion(r) && (finite(r.model_probability) ?? 0) >= 0.55 &&
      (finite(r.model_probability) ?? 1) < 0.60 && (edgePp(r) ?? -99) >= 0 && priceBetween(r, -199, 200),
  },
  {
    id: "ml_clean_55_60_edge_2",
    market: "moneyline",
    target: "lean",
    filter: (r) => basePromotion(r) && (finite(r.model_probability) ?? 0) >= 0.55 &&
      (finite(r.model_probability) ?? 1) < 0.60 && (edgePp(r) ?? -99) >= 2 && priceBetween(r, -199, 200),
  },
  {
    id: "ml_clean_plus_money_edge_5",
    market: "moneyline",
    target: "lean",
    filter: (r) => basePromotion(r) && priceBetween(r, 100, 200) &&
      (finite(r.model_probability) ?? 0) >= 0.52 && (edgePp(r) ?? -99) >= 5,
  },
  {
    id: "ml_clean_heavy_favorite_60",
    market: "moneyline",
    target: "lean",
    filter: (r) => basePromotion(r) && priceBetween(r, -199, -146) &&
      (finite(r.model_probability) ?? 0) >= 0.60 && (edgePp(r) ?? -99) >= 0,
  },
  {
    id: "ml_market_confirmed_54_edge_nonnegative",
    market: "moneyline",
    target: "lean",
    filter: (r) => !actionable(r) && clean(r) && projectionAligned(r) &&
      movement(r) === "toward_pick" && support(r) && !conflict(r) &&
      (finite(r.model_probability) ?? 0) >= 0.54 && (edgePp(r) ?? -99) >= 0 &&
      priceBetween(r, -199, 200),
  },
  {
    id: "total_clean_54_edge3_gap035",
    market: "total",
    target: "lean",
    filter: (r) => basePromotion(r) && (finite(r.model_probability) ?? 0) >= 0.54 &&
      (edgePp(r) ?? -99) >= 3 && (totalProjectionGap(r) ?? 0) >= 0.35 && priceBetween(r, -144, 200),
  },
  {
    id: "total_clean_55_edge4_gap050",
    market: "total",
    target: "lean",
    filter: (r) => basePromotion(r) && (finite(r.model_probability) ?? 0) >= 0.55 &&
      (edgePp(r) ?? -99) >= 4 && (totalProjectionGap(r) ?? 0) >= 0.50 && priceBetween(r, -144, 200),
  },
  {
    id: "total_market_confirmed_54_edge3_gap035",
    market: "total",
    target: "lean",
    filter: (r) => !actionable(r) && clean(r) && projectionAligned(r) &&
      movement(r) === "toward_pick" && support(r) && !conflict(r) &&
      (finite(r.model_probability) ?? 0) >= 0.54 && (edgePp(r) ?? -99) >= 3 &&
      (totalProjectionGap(r) ?? 0) >= 0.35 && priceBetween(r, -144, 200),
  },
  {
    id: "total_existing_lean_stronger_to_best",
    market: "total",
    target: "best_angle",
    filter: (r) => publicGrade(r) === "lean" && clean(r) && projectionAligned(r) &&
      movement(r) !== "against_pick" && !conflict(r) &&
      (finite(r.model_probability) ?? 0) >= 0.57 && (edgePp(r) ?? -99) >= 5 &&
      (totalProjectionGap(r) ?? 0) >= 0.75 && priceBetween(r, -134, 200),
  },
];

function qualification(parts: Record<string, ReturnType<typeof metrics>>): string {
  const train = parts.train;
  const validation = parts.validation;
  const holdout = parts.holdout;
  const enough = train.rows >= 3 && validation.rows >= 2 && holdout.rows >= 2;
  const positive = train.units > 0 && validation.units > 0 && holdout.units > 0;
  return enough && positive ? "passes_fixed_chronological_screen" : "does_not_pass";
}

function oppositePrice(row: Row): number | null {
  const key = row.market === "moneyline" ? "odds_source_at_lock_ml" : "odds_source_at_lock_ou";
  const bucket = row.snapshot_json?.[key];
  if (bucket === null || typeof bucket !== "object") return null;
  const opposite =
    row.side === "home" ? bucket.away :
    row.side === "away" ? bucket.home :
    row.side === "over" ? bucket.under :
    row.side === "under" ? bucket.over :
    null;
  return finite(opposite?.odds);
}

function flippedRow(row: Row): Row | null {
  const settled = result(row);
  const price = oppositePrice(row);
  if (settled === null || price === null) return null;
  const flippedResult: Result = settled === "win" ? "loss" : settled === "loss" ? "win" : "push";
  return {
    ...row,
    odds_american: price,
    model_probability: finite(row.model_probability) === null ? null : 1 - row.model_probability,
    prediction_grades: { result: flippedResult },
  };
}

async function pageAll(): Promise<Row[]> {
  const output: Row[] = [];
  const pageSize = 250;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select([
        "id", "game_id", "slate_date", "market", "pick", "side", "line_value",
        "odds_american", "model_probability", "market_probability", "edge",
        "play_grade", "best_angle", "no_bet", "held", "launch_day", "locked_at",
        "snapshot_json", "prediction_grades(result,actual_total)",
      ].join(","))
      .eq("sport", "mlb")
      .in("market", ["moneyline", "total", "first_inning"])
      .gte("slate_date", "2026-06-07")
      .not("locked_at", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    output.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < pageSize) return output;
  }
}

async function main() {
  const allRows = (await pageAll()).filter((row) =>
    row.launch_day !== true && row.held !== true && result(row) !== null
  );
  const rows = allRows.filter((row) =>
    row.launch_day !== true && row.held !== true && result(row) !== null && currentHead(row)
  );
  const reconstructedPreHeadMl = allRows
    .filter((row) => row.market === "moneyline" && row.slate_date < "2026-07-11")
    .flatMap((row) => {
      const reconstructed = reconstructCurrentMoneylineHead(row);
      return reconstructed === null ? [] : [reconstructed];
    });
  const candidateResults = candidates.map((candidate) => {
    const selected = rows.filter((row) => row.market === candidate.market && candidate.filter(row));
    const parts = {
      train: metrics(selected.filter((row) => split(row) === "train")),
      validation: metrics(selected.filter((row) => split(row) === "validation")),
      holdout: metrics(selected.filter((row) => split(row) === "holdout")),
    };
    return {
      id: candidate.id,
      market: candidate.market,
      target: candidate.target,
      combined: metrics(selected),
      ...parts,
      classification: qualification(parts),
      affectedDates: [...new Set(selected.map((row) => row.slate_date))],
      selectedRows: selected.map((row) => ({
        id: row.id,
        date: row.slate_date,
        side: row.side,
        price: row.odds_american,
        probability: row.model_probability,
        edgePp: edgePp(row),
        movement: movement(row),
        support: support(row),
        projectionGap: row.market === "total" ? totalProjectionGap(row) : mlProjectionGap(row),
        result: result(row),
      })),
    };
  });

  const mlFlipPools = {
    movement_against_and_public_conflict: rows.filter((r) =>
      r.market === "moneyline" && !actionable(r) && clean(r) &&
      movement(r) === "against_pick" && conflict(r)
    ),
    movement_against_model_55_60: rows.filter((r) =>
      r.market === "moneyline" && !actionable(r) && clean(r) &&
      movement(r) === "against_pick" &&
      (finite(r.model_probability) ?? 0) >= 0.55 &&
      (finite(r.model_probability) ?? 1) < 0.60
    ),
  };
  const mlFlipResults = Object.fromEntries(Object.entries(mlFlipPools).map(([id, original]) => {
    const flipped = original.flatMap((row) => {
      const next = flippedRow(row);
      return next === null ? [] : [next];
    });
    return [id, {
      original: metrics(original),
      flipped: metrics(flipped),
      pairedRows: flipped.length,
      note: "A flip must beat the original side in train, validation, and untouched holdout.",
    }];
  }));

  const fiBestAngles = rows.filter((row) => row.market === "first_inning" && publicGrade(row) === "best_angle");
  const fiMovement = {
    all: metrics(fiBestAngles),
    against: metrics(fiBestAngles.filter((row) => movement(row) === "against_pick")),
    toward: metrics(fiBestAngles.filter((row) => movement(row) === "toward_pick")),
    neutralOrUnknown: metrics(fiBestAngles.filter((row) =>
      movement(row) !== "against_pick" && movement(row) !== "toward_pick"
    )),
  };

  console.log(JSON.stringify({
    mode: "read_only_current_head_fixed_rule_discovery",
    noWrites: true,
    noLiveChanges: true,
    splitPolicy: {
      train: "2026-07-11..2026-07-17",
      validation: "2026-07-18..2026-07-22",
      untouchedHoldout: "2026-07-23..latest settled",
    },
    dataset: {
      rows: rows.length,
      byMarket: Object.fromEntries(["moneyline", "total", "first_inning"].map((market) => [
        market,
        rows.filter((row) => row.market === market).length,
      ])),
    },
    fixedPromotionCandidates: candidateResults,
    preHeadCurrentMoneylineReconstruction: {
      policy: "Supporting evidence only: the current k=0.1/cap=6 head is replayed from persisted raw-model and market probabilities; it is not exact current-head evidence.",
      eligibleRows: reconstructedPreHeadMl.length,
      mlClean55To60EdgeNonnegativeIncremental: metrics(
        reconstructedPreHeadMl.filter((row) =>
          basePromotion(row) &&
          (finite(row.model_probability) ?? 0) >= 0.55 &&
          (finite(row.model_probability) ?? 1) < 0.60 &&
          (edgePp(row) ?? -99) >= 0 &&
          priceBetween(row, -199, 200)
        ),
      ),
    },
    fixedMoneylineFlipCandidates: mlFlipResults,
    firstInningBestAngleMovementAudit: fiMovement,
    policy: "No candidate is deployable unless it passes every chronological segment and the mandatory model-change safety protocol.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
