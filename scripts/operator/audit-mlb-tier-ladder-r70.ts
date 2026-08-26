/**
 * READ ONLY. MLB Daily Edge Moneyline tier-ladder audit.
 *
 * Protocol: docs/model-audits/2026-08-26-mlb-tier-ladder-predeclaration.md
 * Never invokes a writer, cron, provider, or database mutation.
 */
import { supabase } from "../../lib/db/supabase";
import {
  MLB_DAILY_EDGE_DECISION_RELEASE_ID,
  MLB_MODEL_LAYER_VERSION_IDS,
} from "../../lib/automodel/mlbModelLayerVersions";

type Outcome = "win" | "loss" | "push" | null;
type WindowName = "development" | "validation" | "confirmation" | "current";
type Row = Record<string, unknown>;
type AuditRow = {
  row: Row;
  window: WindowName;
  outcome: Outcome;
  release: string | null;
  head: string | null;
  baselineAction: boolean;
  baselineTier: "best_angle" | "lean" | "watchlist" | "no_play" | "operational";
  finalSideChanged: boolean;
  reasons: string[];
  signedGap: number | null;
  movement: string;
  movementPp: number | null;
  projectionGap: number | null;
  publicConflict: boolean;
  dataBlocked: boolean;
  ev: number | null;
  priorSameSideAction: boolean;
  refreshTransitions: number;
  clvPp: number | null;
  clvBeat: boolean | null;
};

const ACTIVE_HEAD = MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head;
const ML_FIELDS = new Set([
  "home_team_mapped", "away_team_mapped", "start_time", "ml_pick",
  "projected_home_score", "projected_away_score", "home_moneyline_price",
  "away_moneyline_price", "home_probable_pitcher", "away_probable_pitcher",
]);

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function implied(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}
function unit(odds: number | null, outcome: Outcome): number | null {
  if (odds === null || (outcome !== "win" && outcome !== "loss")) return null;
  if (outcome === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}
function outcome(value: unknown): Outcome {
  const grade = Array.isArray(value) ? obj(value[0]) : obj(value);
  const result = String(grade.result ?? "").toLowerCase();
  return result === "win" || result === "loss" || result === "push" ? result : null;
}
function windowName(date: string): WindowName {
  if (date <= "2026-08-14") return "development";
  if (date <= "2026-08-19") return "validation";
  if (date <= "2026-08-24") return "confirmation";
  return "current";
}
function gradeIsAction(entry: Record<string, unknown>): boolean {
  const grade = str(entry.play_grade);
  return entry.best_angle === true || grade === "best_angle" || grade === "lean";
}
function gradeIsNoAction(entry: Record<string, unknown>): boolean {
  return entry.no_bet === true || (!gradeIsAction(entry) && str(entry.play_grade) !== "market_aligned");
}
function readClv(snapshot: Record<string, unknown>, odds: number | null) {
  const closing = obj(snapshot.closing_line_value);
  const direct = num(closing.normalized_clv_pp) ?? num(closing.clv_pp) ?? num(closing.clv_probability_points);
  const closingOdds = num(closing.closing_odds_american) ?? num(closing.american_odds);
  const evaluated = implied(odds);
  const closingP = implied(closingOdds);
  return {
    pp: direct ?? (evaluated !== null && closingP !== null ? 100 * (closingP - evaluated) : null),
    beat: typeof closing.beat_closing_line === "boolean"
      ? closing.beat_closing_line
      : typeof closing.beatClosingLine === "boolean" ? closing.beatClosingLine : null,
  };
}
function audit(row: Row): AuditRow {
  const snapshot = obj(row.snapshot_json);
  const decision = obj(snapshot.decision_pipeline);
  const layers = obj(snapshot.model_layer_versions);
  const resistance = obj(snapshot.ml_signed_market_resistance_standdown);
  const movement = obj(snapshot.line_movement);
  const recal = obj(snapshot.ml_grade_recalibration);
  const completeness = obj(snapshot.mlb_data_completeness);
  const correction = obj(snapshot.champion_candidate_correction);
  const history = Array.isArray(snapshot.prediction_grade_history_v1)
    ? snapshot.prediction_grade_history_v1.map(obj)
    : [];
  const prior = history.at(-1);
  const priorSameSideAction = prior !== undefined
    && prior.pick === row.pick && prior.side === row.side && gradeIsAction(prior);
  const transitionStates = history
    .filter((entry) => entry.pick === row.pick && entry.side === row.side)
    .map((entry) => gradeIsAction(entry) ? "action" : gradeIsNoAction(entry) ? "no_action" : "watch");
  const refreshTransitions = transitionStates.reduce((count, state, index) =>
    index > 0 && state !== transitionStates[index - 1] ? count + 1 : count, 0);
  const missing = Array.isArray(completeness.missing_fields)
    ? completeness.missing_fields.filter((value: unknown): value is string => typeof value === "string")
    : [];
  const reasons = [
    ...(Array.isArray(correction.reasons) ? correction.reasons.filter((value: unknown): value is string => typeof value === "string") : []),
    ...[row.no_bet_reason, row.hold_reason, decision.stand_down_reason].filter((value): value is string => typeof value === "string" && value.length > 0),
  ];
  const probability = num(row.model_probability);
  const odds = num(row.odds_american);
  const priceP = implied(odds);
  const clv = readClv(snapshot, odds);
  const baselineAction = decision.board_action === "bet" || row.best_angle === true || row.play_grade === "best_angle" || row.play_grade === "lean";
  const operationalText = reasons.join(" ").toLowerCase();
  const operational = row.held === true
    || probability === null
    || odds === null
    || missing.some((field: string) => ML_FIELDS.has(field))
    || /missing.*(?:starter|pitcher|price|odds)|starter.*(?:missing|unavailable)|operational|incomplete.*(?:market|price|pitcher)/.test(operationalText);
  return {
    row,
    window: windowName(String(row.slate_date)),
    outcome: outcome(row.prediction_grades),
    release: str(decision.release_id),
    head: str(layers.moneyline_probability_head),
    baselineAction,
    baselineTier: operational ? "operational" : row.best_angle === true || row.play_grade === "best_angle" ? "best_angle" : row.play_grade === "lean" ? "lean" : row.play_grade === "market_aligned" ? "watchlist" : "no_play",
    finalSideChanged: decision.final_side_changed === true || decision.inversion_triggered === true || decision.market_aware_correction_applied === true || decision.raw_side_champion_applied === true,
    reasons,
    signedGap: num(resistance.money_over_tickets_gap),
    movement: str(movement.direction) ?? str(movement.line_direction) ?? "unknown",
    movementPp: num(movement.magnitude_pp) ?? num(movement.magnitude),
    projectionGap: num(recal.same_side_projection_gap),
    publicConflict: recal.public_split_conflict === true,
    dataBlocked: operational,
    ev: probability === null || priceP === null || odds === null ? null : probability * (odds > 0 ? odds / 100 : 100 / Math.abs(odds)) - (1 - probability),
    priorSameSideAction,
    refreshTransitions,
    clvPp: clv.pp,
    clvBeat: clv.beat,
  };
}

function common(row: AuditRow): boolean {
  const probability = num(row.row.model_probability);
  const odds = num(row.row.odds_american);
  return !row.baselineAction && !row.dataBlocked && !row.finalSideChanged
    && probability !== null && probability >= 0.50
    && odds !== null && odds >= -300 && odds <= 200
    && row.projectionGap !== null && row.projectionGap >= 0
    && !row.publicConflict;
}
function adverse(row: AuditRow): number {
  return row.movement === "against_pick" ? row.movementPp ?? Infinity : 0;
}
const candidates = {
  // Freeze a 0.25pp cushion so classification does not flip under the
  // predeclared movement perturbation at the 1.0/1.5pp public boundaries.
  coherent_near_edge_watch: (row: AuditRow) => common(row) && (row.ev ?? -Infinity) >= -0.03 && adverse(row) <= 0.75,
  prior_action_hysteresis_watch: (row: AuditRow) => common(row) && row.priorSameSideAction && (row.ev ?? -Infinity) >= -0.04 && (row.signedGap === null || row.signedGap > -30) && adverse(row) <= 1.25,
  strong_value_resistance_lean: (row: AuditRow) => common(row) && (num(row.row.model_probability) ?? 0) >= 0.58 && (row.ev ?? -Infinity) >= 0 && (num(row.row.odds_american) ?? -Infinity) >= -250 && (row.signedGap === null || row.signedGap > -20) && adverse(row) <= 0.5,
  prior_action_hysteresis_lean: (row: AuditRow) => common(row) && row.priorSameSideAction && (num(row.row.model_probability) ?? 0) >= 0.55 && (row.ev ?? -Infinity) >= 0 && (num(row.row.odds_american) ?? -Infinity) >= -250 && (row.signedGap === null || row.signedGap > -20) && adverse(row) <= 1,
  clean_near_market_lean: (row: AuditRow) => common(row) && (num(row.row.model_probability) ?? 0) >= 0.54 && (row.ev ?? -Infinity) >= 0 && (num(row.row.odds_american) ?? -Infinity) >= -200 && row.movement !== "against_pick" && (row.signedGap === null || row.signedGap > -10),
};

function summarize(rows: AuditRow[]) {
  const settled = rows.filter((row) => row.outcome === "win" || row.outcome === "loss");
  const wins = settled.filter((row) => row.outcome === "win");
  const losses = settled.filter((row) => row.outcome === "loss");
  const units = settled.map((row) => unit(num(row.row.odds_american), row.outcome)).filter((value): value is number => value !== null);
  const totalUnits = units.reduce((sum, value) => sum + value, 0);
  const largestWin = Math.max(0, ...wins.map((row) => unit(num(row.row.odds_american), row.outcome) ?? 0));
  const probs = settled.map((row) => num(row.row.model_probability)).filter((value): value is number => value !== null);
  const observed = settled.length ? wins.length / settled.length : null;
  const expected = probs.length ? probs.reduce((sum, value) => sum + value, 0) / probs.length : null;
  const clvPp = rows.map((row) => row.clvPp).filter((value): value is number => value !== null);
  const clvBeat = rows.map((row) => row.clvBeat).filter((value): value is boolean => value !== null);
  return {
    n: rows.length,
    settled: settled.length,
    record: `${wins.length}-${losses.length}`,
    units: Number(totalUnits.toFixed(3)),
    roiPct: units.length ? Number((100 * totalUnits / units.length).toFixed(2)) : null,
    unitsWithoutLargestWin: Number((totalUnits - largestWin).toFixed(3)),
    observedWinPct: observed === null ? null : Number((100 * observed).toFixed(2)),
    expectedWinPct: expected === null ? null : Number((100 * expected).toFixed(2)),
    calibrationGapPp: observed === null || expected === null ? null : Number((100 * (observed - expected)).toFixed(2)),
    clvN: clvPp.length,
    meanClvPp: clvPp.length ? Number((clvPp.reduce((sum, value) => sum + value, 0) / clvPp.length).toFixed(3)) : null,
    clvBeatN: clvBeat.length,
    clvBeatPct: clvBeat.length ? Number((100 * clvBeat.filter(Boolean).length / clvBeat.length).toFixed(2)) : null,
    multiTransitionPct: rows.length ? Number((100 * rows.filter((row) => row.refreshTransitions > 1).length / rows.length).toFixed(2)) : 0,
  };
}

function bootstrap(rows: AuditRow[]) {
  const settled = rows.filter((row) => row.outcome === "win" || row.outcome === "loss");
  const byDate = new Map<string, AuditRow[]>();
  for (const row of settled) {
    const slateDate = String(row.row.slate_date);
    byDate.set(slateDate, [...(byDate.get(slateDate) ?? []), row]);
  }
  const dates = [...byDate.keys()];
  if (!dates.length) return { draws: 0, positivePct: null, roi95: null };
  let seed = 0x6d2b79f5;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  const rois: number[] = [];
  for (let draw = 0; draw < 10000; draw += 1) {
    let units = 0; let n = 0;
    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[Math.floor(random() * dates.length)]!;
      for (const row of byDate.get(date) ?? []) { units += unit(num(row.row.odds_american), row.outcome) ?? 0; n += 1; }
    }
    rois.push(n ? units / n : 0);
  }
  rois.sort((a, b) => a - b);
  return {
    draws: rois.length,
    positivePct: Number((100 * rois.filter((value) => value > 0).length / rois.length).toFixed(2)),
    roi95: [Number((100 * rois[Math.floor(rois.length * 0.025)]!).toFixed(2)), Number((100 * rois[Math.floor(rois.length * 0.975)]!).toFixed(2))],
  };
}

function hardFailure(row: AuditRow): boolean {
  const text = row.reasons.join(" ").toLowerCase();
  return row.finalSideChanged || row.publicConflict || row.projectionGap === null || row.projectionGap < 0
    || (row.ev !== null && row.ev < -0.03) || adverse(row) > 1.5
    || /correction|inversion|missing|stale|incomplete|conflict|diverg|projection/.test(text);
}

function classification(row: AuditRow) {
  if (row.dataBlocked) return "A_operational_incomplete";
  if (hardFailure(row)) return "B_complete_hard_failure";
  if (Object.values(candidates).slice(2).some((test) => test(row))) return "D_actionable_candidate";
  if (candidates.coherent_near_edge_watch(row) || candidates.prior_action_hysteresis_watch(row)) return "C_coherent_near_edge";
  return "B_complete_hard_failure";
}

async function load() {
  const result = await supabase.from("prediction_records")
    .select("id,game_id,external_id,slate_date,matchup,market,pick,side,odds_american,model_probability,market_probability,edge,expected_value,play_grade,best_angle,no_bet,no_bet_reason,held,hold_reason,locked_at,published_at,calibration_version,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(result)")
    .eq("sport", "mlb").gte("slate_date", "2026-08-10").lte("slate_date", "2026-08-26")
    .order("slate_date", { ascending: true }).order("published_at", { ascending: true }).limit(1000);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as Row[];
}

async function main() {
  const raw = await load();
  const latest = new Map<string, Row>();
  for (const row of raw) latest.set(`${row.slate_date}:${row.game_id}:${row.market}`, row);
  const all = [...latest.values()].map(audit);
  const ml = all.filter((row) => row.row.market === "moneyline" && row.head === ACTIVE_HEAD);
  const historical = ml.filter((row) => row.window !== "current" && row.row.locked_at && row.outcome !== null);
  const currentDate = ml
    .filter((row) => row.window === "current")
    .map((row) => String(row.row.slate_date))
    .sort()
    .at(-1);
  const current = ml.filter((row) => row.window === "current" && row.row.slate_date === currentDate);
  const candidateReport = Object.fromEntries(Object.entries(candidates).map(([name, test]) => {
    const eligible = historical.filter(test);
    const currentEligible = current.filter(test);
    const confirmation = eligible.filter((row) => row.window === "validation" || row.window === "confirmation");
    return [name, {
      total: summarize(eligible),
      byWindow: Object.fromEntries((["development", "validation", "confirmation"] as const).map((window) => [window, summarize(eligible.filter((row) => row.window === window))])),
      confirmationBootstrap: bootstrap(confirmation),
      current: currentEligible.map((row) => ({ matchup: row.row.matchup, pick: row.row.pick, probability: row.row.model_probability, price: row.row.odds_american, baselineTier: row.baselineTier, priorSameSideAction: row.priorSameSideAction, ev: row.ev, signedGap: row.signedGap, movement: row.movement, movementPp: row.movementPp, reasons: row.reasons })),
    }];
  }));
  const unionTest = (row: AuditRow) => Object.values(candidates).slice(2).some((test) => test(row));
  const unionHistorical = historical.filter(unionTest);
  const unionConfirmation = unionHistorical.filter((row) => row.window === "validation" || row.window === "confirmation");
  const currentClass = current.map((row) => ({
    matchup: row.row.matchup, pick: row.row.pick, probability: row.row.model_probability,
    price: row.row.odds_american, baselineTier: row.baselineTier, class: classification(row),
    priorSameSideAction: row.priorSameSideAction, ev: row.ev, signedGap: row.signedGap,
    movement: row.movement, movementPp: row.movementPp, reasons: row.reasons,
  }));
  const secondary = all.filter((row) => row.window === "current" && row.row.market !== "moneyline");
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(), readOnly: true,
    production: { expectedDecisionRelease: MLB_DAILY_EDGE_DECISION_RELEASE_ID, activeHead: ACTIVE_HEAD },
    rows: { raw: raw.length, latest: all.length, historicalMoneyline: historical.length, currentDate, currentMoneyline: current.length },
    releaseCoverage: Object.fromEntries([...new Set(ml.map((row) => row.release ?? "missing"))].map((release) => [release, ml.filter((row) => (row.release ?? "missing") === release).length])),
    currentBaseline: {
      tiers: Object.fromEntries(["best_angle", "lean", "watchlist", "no_play", "operational"].map((tier) => [tier, current.filter((row) => row.baselineTier === tier).length])),
      classes: Object.fromEntries(["A_operational_incomplete", "B_complete_hard_failure", "C_coherent_near_edge", "D_actionable_candidate"].map((name) => [name, current.filter((row) => classification(row) === name).length])),
      rows: currentClass,
    },
    candidates: candidateReport,
    leanUnion: {
      total: summarize(unionHistorical),
      byWindow: Object.fromEntries((["development", "validation", "confirmation"] as const).map((window) => [window, summarize(unionHistorical.filter((row) => row.window === window))])),
      confirmationBootstrap: bootstrap(unionConfirmation),
      currentPromotions: current.filter(unionTest).filter((row) => !row.baselineAction).map((row) => row.row.matchup),
      currentDemotions: [],
    },
    currentSecondaryControls: secondary.map((row) => ({ matchup: row.row.matchup, market: row.row.market, tier: row.baselineTier, operational: row.dataBlocked, reason: row.row.no_bet_reason ?? row.row.hold_reason ?? null })),
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
