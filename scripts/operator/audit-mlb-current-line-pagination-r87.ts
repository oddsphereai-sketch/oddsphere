/** SELECT-only r86 versus r87 MLB price-board audit. No provider calls and no writes. */

import { supabase } from "../../lib/db/supabase";
import { loadCompleteCurrentGameLines } from "../../lib/services/currentGameLineReader";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";

type Row = {
  game_id: number;
  market: string;
  matchup?: string | null;
  odds_american?: number | null;
  model_probability?: number | null;
  play_grade?: string | null;
  best_angle?: boolean | null;
  no_bet?: boolean | null;
  held?: boolean | null;
  side?: string | null;
  locked_at?: string | null;
  snapshot_json?: {
    decision_pipeline?: { release_id?: string | null } | null;
  } | null;
};

const slateDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

function key(row: Row): string {
  return `${row.game_id}::${row.market}`;
}

function grade(row: Row | null): string {
  if (!row) return "missing";
  if (row.held === true) return "held";
  if (row.no_bet === true) return "no_play";
  if (row.best_angle === true || row.play_grade === "best_angle") return "best_angle";
  if (row.play_grade === "lean") return "lean";
  if (row.play_grade === "market_aligned" || row.play_grade === "market_watch" || row.play_grade === "provisional") return "watchlist";
  return row.play_grade ?? "no_play";
}

function counts(rows: Row[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((out, row) => {
    const value = grade(row);
    out[value] = (out[value] ?? 0) + 1;
    return out;
  }, {});
}

function changed(a: unknown, b: unknown): boolean {
  return a !== b;
}

function probabilityChanged(a: unknown, b: unknown): boolean {
  if (typeof a !== "number" || typeof b !== "number") return a !== b;
  // prediction_records stores six decimals while a dry candidate retains the
  // runtime's full precision. Ignore storage-only rounding in the r86/r87 diff.
  return Math.abs(a - b) > 0.000001;
}

async function main(): Promise<void> {
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id,external_id")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate);
  if (gamesError) throw new Error(gamesError.message);
  const gameIds = (games ?? []).map((row) => Number(row.id));
  const [lines, dry, existingResult] = await Promise.all([
    loadCompleteCurrentGameLines({
      client: supabase,
      gameIds,
      marketTypes: ["moneyline", "total", "first_inning_total"],
      context: `MLB r87 audit ${slateDate}`,
    }),
    createPredictionRecords({ sport: "mlb", slateDate, launchDay: false, apply: false, supabase }),
    supabase
      .from("prediction_records")
      .select("game_id,external_id,matchup,market,pick,side,line_value,odds_american,model_probability,market_probability,edge,play_grade,best_angle,no_bet,no_bet_reason,held,hold_reason,locked_at,snapshot_json")
      .eq("sport", "mlb")
      .eq("slate_date", slateDate)
      .in("market", ["moneyline", "total", "first_inning"]),
  ]);
  if (dry.errors.length > 0) throw new Error(JSON.stringify(dry.errors));
  if (existingResult.error) throw new Error(existingResult.error.message);

  const existing = (existingResult.data ?? []) as Row[];
  const proposed = dry.proposed as unknown as Row[];
  const existingByKey = new Map(existing.map((row) => [key(row), row]));
  const comparisons = proposed.map((candidate) => {
    const prior = existingByKey.get(key(candidate)) ?? null;
    const priorDecision = prior?.snapshot_json?.decision_pipeline ?? {};
    const candidateDecision = candidate.snapshot_json?.decision_pipeline ?? {};
    return {
      matchup: candidate.matchup,
      market: candidate.market,
      locked: prior?.locked_at != null,
      before: {
        price: prior?.odds_american ?? null,
        grade: grade(prior),
        noBet: prior?.no_bet ?? null,
        side: prior?.side ?? null,
        probability: prior?.model_probability ?? null,
        release: priorDecision.release_id ?? null,
      },
      after: {
        price: candidate.odds_american ?? null,
        grade: grade(candidate),
        noBet: candidate.no_bet ?? null,
        side: candidate.side ?? null,
        probability: candidate.model_probability ?? null,
        release: candidateDecision.release_id ?? null,
      },
      changes: {
        price: changed(prior?.odds_american ?? null, candidate.odds_american ?? null),
        grade: changed(grade(prior), grade(candidate)),
        noBet: changed(prior?.no_bet ?? null, candidate.no_bet ?? null),
        side: changed(prior?.side ?? null, candidate.side ?? null),
        probability: probabilityChanged(prior?.model_probability ?? null, candidate.model_probability ?? null),
        held: changed(prior?.held ?? null, candidate.held ?? null),
      },
    };
  });
  const material = comparisons.filter((row) => Object.values(row.changes).some(Boolean));
  const newestLine = lines.map((row) => row.fetched_at).filter((value): value is string => value !== null).sort().at(-1) ?? null;

  console.log(JSON.stringify({
    mode: "select_only_mlb_current_line_pagination_r87",
    noWrites: true,
    providerCalls: 0,
    slateDate,
    games: gameIds.length,
    currentLineRows: lines.length,
    newestLine,
    existingCounts: counts(existing),
    candidateCounts: counts(proposed),
    comparison: {
      rows: comparisons.length,
      materialRows: material.length,
      priceChanges: comparisons.filter((row) => row.changes.price).length,
      gradeChanges: comparisons.filter((row) => row.changes.grade).length,
      noBetChanges: comparisons.filter((row) => row.changes.noBet).length,
      sideChanges: comparisons.filter((row) => row.changes.side).length,
      probabilityChanges: comparisons.filter((row) => row.changes.probability).length,
      heldChanges: comparisons.filter((row) => row.changes.held).length,
    },
    material,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
