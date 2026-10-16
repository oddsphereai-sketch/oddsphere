/** SELECT-only NHL moneyline disagreement ledger. */

import { supabase } from "../../lib/db/supabase";
import {
  NHL_REGULAR_MODEL_RELEASE,
  NHL_REGULAR_TRANSITION_MODEL_RELEASES,
  nhlRegularModelV1,
  type NhlFeatureSnapshot,
} from "../../lib/automodel/nhlRegularModelV1";

type Grade = { actual_home_score: number | null; actual_away_score: number | null };
type Row = {
  game_id: number;
  slate_date: string;
  matchup: string;
  model_version: string;
  side: "home" | "away";
  snapshot_json: {
    feature_inputs?: NhlFeatureSnapshot;
    model_output?: {
      expected_goal_diff?: number;
      layers?: { market_decision?: string; roster_prior_active?: boolean };
    };
    goalie_assumption?: {
      home?: { player_name?: string | null; source?: string | null };
      away?: { player_name?: string | null; source?: string | null };
    };
  } | null;
  prediction_grades: Grade | Grade[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function aligned(value: number | null, homeSide: boolean, homeThreshold: number, awayThreshold: number): boolean {
  return value !== null && (homeSide ? value >= homeThreshold : value <= awayThreshold);
}

async function main(): Promise<void> {
  const { data, error } = await supabase.from("prediction_records")
    .select("game_id,slate_date,matchup,model_version,side,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(actual_home_score,actual_away_score)")
    .eq("sport", "nhl")
    .eq("market", "moneyline")
    .in("model_version", [...NHL_REGULAR_TRANSITION_MODEL_RELEASES])
    .not("locked_at", "is", null)
    .order("game_date", { ascending: true });
  if (error) throw new Error(error.message);
  const ledger = ((data ?? []) as unknown as Row[]).flatMap((row) => {
    const grade = one(row.prediction_grades);
    const stored = row.snapshot_json?.feature_inputs;
    if (!grade || grade.actual_home_score === null || grade.actual_away_score === null || !stored) return [];
    const snapshot = structuredClone(stored);
    snapshot.market = {
      ...snapshot.market,
      market_home_prob: null,
      market_open_home_prob: null,
      same_book_home_prob_move: null,
      same_book_total_move: null,
      ml_home_bets_pct: null,
      ml_home_money_pct: null,
      total_over_bets_pct: null,
      total_over_money_pct: null,
      ml_split_source: null,
      ml_split_confidence: "none",
      total_split_source: null,
      total_split_confidence: "none",
      target_excluded_total_read: null,
      target_exclusion_status: "unavailable",
    };
    const independent = nhlRegularModelV1(snapshot);
    const independentHome = independent.moneyline.pick.startsWith(stored.home.abbreviation);
    const marketProbability = stored.market.market_home_prob;
    if (marketProbability === null) return [];
    const marketHome = marketProbability >= 0.5;
    if (marketHome === independentHome) return [];
    const actualHome = grade.actual_home_score > grade.actual_away_score;
    const marketStrength = marketHome ? marketProbability : 1 - marketProbability;
    const move = stored.market.same_book_home_prob_move;
    const moveAligned = move !== null && (marketHome ? move > 0 : move < 0);
    const splits55 = aligned(stored.market.ml_home_bets_pct, marketHome, 55, 45)
      && aligned(stored.market.ml_home_money_pct, marketHome, 55, 45);
    const splits50 = aligned(stored.market.ml_home_bets_pct, marketHome, 50, 50)
      && aligned(stored.market.ml_home_money_pct, marketHome, 50, 50);
    return [{
      date: row.slate_date,
      gameId: row.game_id,
      matchup: row.matchup,
      activeR17: row.model_version === NHL_REGULAR_MODEL_RELEASE,
      release: row.model_version,
      independentPick: independentHome ? stored.home.abbreviation : stored.away.abbreviation,
      marketPick: marketHome ? stored.home.abbreviation : stored.away.abbreviation,
      finalPick: row.side === "home" ? stored.home.abbreviation : stored.away.abbreviation,
      winner: actualHome ? stored.home.abbreviation : stored.away.abbreviation,
      independentCorrect: independentHome === actualHome,
      marketCorrect: marketHome === actualHome,
      marketStrength: Number(marketStrength.toFixed(4)),
      bookCount: stored.market.market_book_count,
      sameBookMove: move,
      moveAligned,
      moveAligned1pp: moveAligned && Math.abs(move!) >= 0.01,
      bets: stored.market.ml_home_bets_pct,
      money: stored.market.ml_home_money_pct,
      splitConfidence: stored.market.ml_split_confidence,
      splits50,
      splits55,
      rosterPriorActive: row.snapshot_json?.model_output?.layers?.roster_prior_active ?? false,
      homeGames: stored.home.current_season_games ?? null,
      awayGames: stored.away.current_season_games ?? null,
      homeGoalie: row.snapshot_json?.goalie_assumption?.home?.player_name ?? null,
      awayGoalie: row.snapshot_json?.goalie_assumption?.away?.player_name ?? null,
    }];
  });

  const summarize = (rows: typeof ledger) => ({
    conflicts: rows.length,
    independent: `${rows.filter((row) => row.independentCorrect).length}-${rows.filter((row) => !row.independentCorrect).length}`,
    market: `${rows.filter((row) => row.marketCorrect).length}-${rows.filter((row) => !row.marketCorrect).length}`,
    byRule: Object.fromEntries([
      ["market_strength_54", (row: typeof ledger[number]) => row.marketStrength >= 0.54],
      ["market_strength_56", (row: typeof ledger[number]) => row.marketStrength >= 0.56],
      ["market_strength_60", (row: typeof ledger[number]) => row.marketStrength >= 0.60],
      ["aligned_move", (row: typeof ledger[number]) => row.moveAligned],
      ["aligned_move_1pp", (row: typeof ledger[number]) => row.moveAligned1pp],
      ["splits_50", (row: typeof ledger[number]) => row.splits50],
      ["splits_55", (row: typeof ledger[number]) => row.splits55],
      ["strength54_move", (row: typeof ledger[number]) => row.marketStrength >= 0.54 && row.moveAligned],
      ["strength54_splits50", (row: typeof ledger[number]) => row.marketStrength >= 0.54 && row.splits50],
      ["current_games_3plus", (row: typeof ledger[number]) => Math.min(row.homeGames ?? 0, row.awayGames ?? 0) >= 3],
    ].map(([name, predicate]) => {
      const selected = rows.filter(predicate as (row: typeof ledger[number]) => boolean);
      return [name as string, {
        selected: selected.length,
        market: `${selected.filter((row) => row.marketCorrect).length}-${selected.filter((row) => !row.marketCorrect).length}`,
        netCorrections: selected.reduce((sum, row) => sum + (row.marketCorrect ? 1 : -1), 0),
      }];
    })),
  });

  console.log(JSON.stringify({
    preR17Selection: summarize(ledger.filter((row) => !row.activeR17)),
    r17Confirmation: summarize(ledger.filter((row) => row.activeR17)),
    full: summarize(ledger),
    ledger,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
