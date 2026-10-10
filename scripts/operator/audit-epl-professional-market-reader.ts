/* eslint-disable @typescript-eslint/no-explicit-any -- versioned immutable snapshots intentionally span legacy shapes */
import { createClient } from "@supabase/supabase-js";
import { deriveEplMatchResultDecision } from "../../lib/services/epl/eplPreviewGrade";
import { selectEplMatchResultSide } from "../../lib/services/epl/eplShadowModel";

type Side = "home" | "draw" | "away";
type Grade = "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play";
type AuditRow = {
  date: string;
  matchup: string;
  side: Side;
  actual: Side | null;
  grade: Grade;
  probability: number;
  price: number;
  exactEv: number;
  won: boolean | null;
  movement: "toward" | "against" | "flat" | "unknown";
  movementPp: number | null;
  splitsPresent: boolean;
};

const SIDES: Side[] = ["home", "draw", "away"];
const ACTIONABLE = new Set<Grade>(["Best Angle", "Lean"]);

function decimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

function exactEv(probability: number, american: number): number {
  return probability * decimal(american) - 1;
}

function implied(american: number): number {
  return 1 / decimal(american);
}

function actualSide(home: number, away: number): Side {
  return home > away ? "home" : home < away ? "away" : "draw";
}

function gradeResult(value: any): any | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function memberMarket(row: any): any {
  return row.snapshot_json?.member_market_at_capture ?? row.markets?.moneyline ?? row;
}

function memberProjection(row: any): any {
  return row.snapshot_json?.member_projection_at_capture ?? row.soccerProjection;
}

function currentBookMovement(boardRows: any[], selectedSide: Side): { direction: AuditRow["movement"]; pp: number | null } {
  const selected = boardRows.find((item) => item.side === selectedSide);
  const book = String(selected?.sportsbook ?? selected?.odds_trail?.at(-1)?.sportsbook ?? "").toLowerCase();
  if (!selected || !book) return { direction: "unknown", pp: null };
  const openingPrices = Object.fromEntries(SIDES.map((side) => {
    const row = boardRows.find((item) => item.side === side);
    const trail = (row?.odds_trail ?? []).filter((stop: any) => String(stop.sportsbook ?? "").toLowerCase() === book);
    const opening = trail.find((stop: any) => stop.label === "open") ?? trail.find((stop: any) => stop.label === "first");
    return [side, typeof opening?.american === "number" ? opening.american : null];
  })) as Record<Side, number | null>;
  const currentPrices = Object.fromEntries(SIDES.map((side) => {
    const row = boardRows.find((item) => item.side === side);
    return [side, typeof row?.price_american === "number" ? row.price_american : null];
  })) as Record<Side, number | null>;
  if (SIDES.some((side) => openingPrices[side] === null || currentPrices[side] === null)) {
    return { direction: "unknown", pp: null };
  }
  const openingRaw = Object.fromEntries(SIDES.map((side) => [side, implied(openingPrices[side]!)])) as Record<Side, number>;
  const currentRaw = Object.fromEntries(SIDES.map((side) => [side, implied(currentPrices[side]!)])) as Record<Side, number>;
  const openingTotal = SIDES.reduce((sum, side) => sum + openingRaw[side], 0);
  const currentTotal = SIDES.reduce((sum, side) => sum + currentRaw[side], 0);
  const pp = (currentRaw[selectedSide] / currentTotal - openingRaw[selectedSide] / openingTotal) * 100;
  return { direction: pp >= 0.5 ? "toward" : pp <= -0.5 ? "against" : "flat", pp };
}

function replay(row: any): AuditRow | null {
  const member = memberMarket(row);
  const context = member?.soccerMatchResultContext;
  const projection = memberProjection(row);
  const boardRows = member?.soccerPriceBoard?.rows ?? [];
  if (!context?.model || !projection?.expectedGoals || boardRows.length !== 3) return null;
  const arbitration = selectEplMatchResultSide({
    lambdaHome: projection.expectedGoals.home,
    lambdaAway: projection.expectedGoals.away,
    likelyScore: { ...projection.likelyScore, probability: projection.likelyScoreProbability ?? 0 },
    probabilities: {
      ...context.model,
      over25: projection.goalOutlookProbabilities?.over25 ?? 0.5,
      under25: projection.goalOutlookProbabilities?.under25 ?? 0.5,
      bttsYes: projection.goalOutlookProbabilities?.bttsYes ?? 0.5,
      bttsNo: projection.goalOutlookProbabilities?.bttsNo ?? 0.5,
    },
  });
  const bySide = new Map<Side, any>(boardRows.map((item: any) => [item.side as Side, item]));
  const decision = deriveEplMatchResultDecision({
    model: context.model,
    market: Object.fromEntries(SIDES.map((side) => [side, bySide.get(side)?.market_probability])) as Record<Side, number>,
    prices: Object.fromEntries(SIDES.map((side) => [side, bySide.get(side)?.price_american])) as Record<Side, number>,
    promotedProxy: false,
    forecastSide: arbitration.side,
  });
  const selected = bySide.get(decision.selectedSide);
  const probability = Number(context.model[decision.selectedSide]);
  const price = Number(selected?.price_american);
  if (!Number.isFinite(probability) || !Number.isFinite(price)) return null;
  const result = gradeResult(row.prediction_grades);
  const actual = Number.isFinite(result?.actual_home_score) && Number.isFinite(result?.actual_away_score)
    ? actualSide(result.actual_home_score, result.actual_away_score)
    : null;
  const movement = currentBookMovement(boardRows, decision.selectedSide);
  return {
    date: String(row.slate_date ?? "current"),
    matchup: String(row.matchup ?? `${row.awayTeam}@${row.homeTeam}`),
    side: decision.selectedSide,
    actual,
    grade: decision.grade.verdict.label as Grade,
    probability,
    price,
    exactEv: exactEv(probability, price),
    won: actual === null ? null : actual === decision.selectedSide,
    movement: movement.direction,
    movementPp: movement.pp,
    splitsPresent: Array.isArray(member.publicSplits) && member.publicSplits.some((split: any) => split.moneyPct !== null || split.betsPct !== null),
  };
}

function summarize(rows: AuditRow[]) {
  const actionables = rows.filter((row) => ACTIONABLE.has(row.grade));
  const settled = actionables.filter((row) => row.won !== null);
  const units = settled.reduce((sum, row) => sum + (row.won ? decimal(row.price) - 1 : -1), 0);
  const exactPriceCoherent = actionables.filter((row) => row.exactEv > 0);
  const exactPriceIncoherent = actionables.filter((row) => row.exactEv <= 0);
  return {
    games: rows.length,
    grades: Object.fromEntries((["Best Angle", "Lean", "Watchlist", "Caution", "No Play"] as Grade[])
      .map((grade) => [grade, rows.filter((row) => row.grade === grade).length])),
    actionables: actionables.length,
    actionableRecord: `${settled.filter((row) => row.won).length}-${settled.filter((row) => !row.won).length}`,
    actionableUnits: units,
    exactPriceCoherentActionables: exactPriceCoherent.length,
    exactPriceIncoherentActionables: exactPriceIncoherent.length,
    exactPriceIncoherentRecord: `${exactPriceIncoherent.filter((row) => row.won).length}-${exactPriceIncoherent.filter((row) => row.won === false).length}`,
    exactPriceIncoherentUnits: exactPriceIncoherent.filter((row) => row.won !== null)
      .reduce((sum, row) => sum + (row.won ? decimal(row.price) - 1 : -1), 0),
    movement: Object.fromEntries((["toward", "against", "flat", "unknown"] as const).map((direction) => {
      const cohort = actionables.filter((row) => row.movement === direction && row.won !== null);
      return [direction, { rows: cohort.length, wins: cohort.filter((row) => row.won).length, losses: cohort.filter((row) => !row.won).length }];
    })),
    splitRows: rows.filter((row) => row.splitsPresent).length,
  };
}

async function main() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: settled, error: settledError } = await client.from("prediction_records")
    .select("id,slate_date,matchup,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
    .eq("sport", "soccer")
    .eq("market", "match_result")
    .eq("model_version", "epl_goals_coherent_2026_09_02_r18_structural_target_exclusion")
    .not("locked_at", "is", null)
    .order("slate_date", { ascending: true });
  if (settledError) throw settledError;
  const settledRows = (settled ?? []).flatMap((row: any) => {
    const value = replay(row);
    return value && value.actual !== null ? [value] : [];
  });

  const { data: currentRelease, error: currentReleaseError } = await client.from("prediction_records")
    .select("id", { count: "exact", head: false })
    .eq("sport", "soccer")
    .eq("market", "match_result")
    .eq("model_version", "epl_goals_coherent_2026_10_01_r19_draw_arbitration")
    .not("locked_at", "is", null);
  if (currentReleaseError) throw currentReleaseError;

  const { data: snapshot, error: snapshotError } = await client.from("lab_response_snapshots")
    .select("payload,generated_at")
    .eq("snapshot_key", "soccer::english_premier_league::current-week")
    .single();
  if (snapshotError) throw snapshotError;
  const currentRows: AuditRow[] = ((snapshot.payload as any).games ?? []).flatMap((row: any) => {
    const value = replay(row);
    return value ? [value] : [];
  });
  const currentAllMarkets = ((snapshot.payload as any).games ?? []).flatMap((game: any) => [
    { matchup: `${game.awayTeam}@${game.homeTeam}`, market: "match_result", grade: game.markets?.moneyline?.verdict?.label ?? "No Play" },
    { matchup: `${game.awayTeam}@${game.homeTeam}`, market: "double_chance", grade: game.soccerDoubleChanceMarket?.verdict?.label ?? "No Play" },
    { matchup: `${game.awayTeam}@${game.homeTeam}`, market: "total", grade: game.markets?.total?.verdict?.label ?? "No Play" },
    { matchup: `${game.awayTeam}@${game.homeTeam}`, market: "btts", grade: game.markets?.first_inning?.verdict?.label ?? "No Play" },
  ]);
  const candidateGradeByMatchup = new Map(currentRows.map((row) => [row.matchup, row.grade]));
  const candidateAllMarkets = currentAllMarkets.map((row: any) => row.market === "match_result"
    ? { ...row, grade: candidateGradeByMatchup.get(row.matchup) ?? row.grade }
    : row);
  const boardSummary = (rows: any[]) => ({
    rows: rows.length,
    actionables: rows.filter((row: any) => ACTIONABLE.has(row.grade)).length,
    byMarket: Object.fromEntries(["match_result", "double_chance", "total", "btts"].map((market) => {
      const marketRows = rows.filter((row: any) => row.market === market);
      return [market, {
        actionables: marketRows.filter((row: any) => ACTIONABLE.has(row.grade)).length,
        grades: Object.fromEntries((["Best Angle", "Lean", "Watchlist", "Caution", "No Play"] as Grade[])
          .map((grade) => [grade, marketRows.filter((row: any) => row.grade === grade).length])),
      }];
    })),
  });

  const lossRows = settledRows.filter((row) => ACTIONABLE.has(row.grade) && row.won === false);
  console.log(JSON.stringify({
    mode: "read_only_zero_write",
    releases: {
      model: "epl_goals_coherent_2026_10_01_r19_draw_arbitration",
      grade: "epl_grade_policy_2026_10_10_v25_exact_match_result_price_tiering",
    },
    evidence: {
      replayedSettledRows: settledRows.length,
      currentReleaseLockedRows: currentRelease?.length ?? 0,
      currentSnapshotGeneratedAt: snapshot.generated_at,
      splitsTreatment: "missing_is_neutral",
    },
    settled: summarize(settledRows),
    settledRows,
    current: summarize(currentRows),
    currentAllMarketBoard: {
      incumbent: boardSummary(currentAllMarkets),
      candidate: boardSummary(candidateAllMarkets),
    },
    actionableLosses: lossRows,
    currentRows,
    priceCoherentCounterfactual: {
      settledActionablesRetained: settledRows.filter((row) => ACTIONABLE.has(row.grade) && row.exactEv > 0).length,
      settledActionablesDemotedToWatchlist: settledRows.filter((row) => ACTIONABLE.has(row.grade) && row.exactEv <= 0).length,
      currentActionablesRetained: currentRows.filter((row) => ACTIONABLE.has(row.grade) && row.exactEv > 0).length,
      currentActionablesDemotedToWatchlist: currentRows.filter((row) => ACTIONABLE.has(row.grade) && row.exactEv <= 0).length,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
