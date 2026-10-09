/**
 * SELECT-only production-parity rehearsal for NHL r17.
 *
 * Replays the exact r16 current snapshots through the shipped r17 helper and
 * reports score, side, grade, target-exclusion, and coherence changes. It does
 * not call a provider and does not write to the database.
 */

import { supabase } from "../../lib/db/supabase";
import {
  NHL_REGULAR_MODEL_RELEASE,
  resolveNhlPriceAwareVerdict,
  type NhlFeatureSnapshot,
  type NhlModelOutput,
} from "../../lib/automodel/nhlRegularModelV1";
import {
  buildNhlRegularMarketAwareForecast,
  type NhlTotalMarketLineRow,
} from "../../lib/services/nhl/nhlTargetExcludedTotalMarket";
import { selectNhlBestPriceQuote } from "../../lib/services/nhl/nhlLineBoard";

const INCUMBENT = "nhl_regular_2026_r16_exact_quote_price_mapping";

type Row = {
  game_id: number;
  slate_date: string;
  game_date: string;
  matchup: string;
  market: "moneyline" | "total" | "spread";
  pick: string;
  side: "home" | "away" | "over" | "under";
  odds_american: number | null;
  line_value: number | null;
  play_grade: string | null;
  no_bet: boolean | null;
  locked_at: string | null;
  model_version: string;
  snapshot_json: {
    model_output?: NhlModelOutput;
    feature_inputs?: NhlFeatureSnapshot;
    captured_at?: string | null;
    market_at_lock?: { lines_snapshot?: NhlTotalMarketLineRow[] };
  } | null;
};

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row]);
  return grouped;
}

function grade(row: Row): "best_angle" | "lean" | "watchlist" | "pass" {
  if (row.no_bet) return "pass";
  if (row.play_grade === "best_signal" || row.play_grade === "best_angle") return "best_angle";
  if (row.play_grade === "market_watch" || row.play_grade === "watchlist") return "watchlist";
  return "lean";
}

function sideFor(model: NhlModelOutput, market: Row["market"], home: string): Row["side"] {
  if (market === "total") return model.total.pick.startsWith("OVER") ? "over" : "under";
  const pick = market === "moneyline" ? model.moneyline.pick : model.puck_line.pick;
  return pick.startsWith(home) ? "home" : "away";
}

async function main(): Promise<void> {
  const from = process.argv.find((value) => value.startsWith("--from="))?.slice("--from=".length) ?? "2026-10-09";
  const { data, error } = await supabase.from("prediction_records")
    .select("game_id,slate_date,game_date,matchup,market,pick,side,odds_american,line_value,play_grade,no_bet,locked_at,model_version,snapshot_json")
    .eq("sport", "nhl")
    .in("model_version", [INCUMBENT, NHL_REGULAR_MODEL_RELEASE])
    .gte("slate_date", from)
    .in("market", ["moneyline", "total", "spread"])
    .order("game_date", { ascending: true });
  if (error) throw new Error(error.message);
  const games = [...groupBy((data ?? []) as unknown as Row[], (row) => row.game_id).entries()]
    .flatMap(([gameId, rows]) => {
      const current = rows.filter((row) => row.model_version === NHL_REGULAR_MODEL_RELEASE);
      const selected = current.length === 3 ? current : rows.filter((row) => row.model_version === INCUMBENT);
      return selected.length === 3 ? [[gameId, selected] as const] : [];
    });
  const output = [];
  for (const [gameId, rows] of games) {
    const first = rows[0]!;
    const stored = first.snapshot_json;
    if (!stored?.feature_inputs || !stored.model_output) continue;
    const currentRows = stored.market_at_lock?.lines_snapshot ?? [];
    const cutoff = stored.captured_at ?? first.locked_at ?? new Date().toISOString();
    const { data: historyData, error: historyError } = await supabase.from("line_history")
      .select("market_type,sportsbook,side,line_value,odds_american,recorded_at")
      .eq("game_id", gameId)
      .eq("market_type", "total")
      .lte("recorded_at", cutoff)
      .order("recorded_at", { ascending: true });
    if (historyError) throw new Error(historyError.message);
    const historyRows = ((historyData ?? []) as Array<{
      market_type: string;
      sportsbook: string;
      side: string;
      line_value: number | null;
      odds_american: number | null;
      recorded_at: string | null;
    }>).map((row) => ({ ...row, observed_at: row.recorded_at }));
    const candidate = buildNhlRegularMarketAwareForecast({
      snapshot: stored.feature_inputs,
      currentRows,
      historyRows,
    });
    const home = stored.feature_inputs.home.abbreviation;
    const marketRows = rows.map((row) => {
      const modelMarket = row.market === "moneyline"
        ? candidate.model.moneyline
        : row.market === "total"
          ? candidate.model.total
          : candidate.model.puck_line;
      const side = sideFor(candidate.model, row.market, home);
      const line = row.market === "moneyline"
        ? null
        : row.market === "total"
          ? stored.feature_inputs!.market.market_total_line
          : candidate.model.puck_line.puck_line_value;
      const quote = selectNhlBestPriceQuote({ rows: currentRows, market: row.market, side, line });
      const afterGrade = resolveNhlPriceAwareVerdict(
        row.market,
        modelMarket.verdict,
        quote?.odds_american ?? null,
        modelMarket.probability,
      );
      return {
        market: row.market,
        before: { pick: row.pick, side: row.side, grade: grade(row), price: row.odds_american },
        after: {
          pick: modelMarket.pick,
          side,
          grade: afterGrade,
          price: quote?.odds_american ?? null,
          sportsbook: quote?.sportsbook ?? null,
        },
        sideChanged: row.side !== side,
        gradeChanged: grade(row) !== afterGrade,
      };
    });
    output.push({
      gameId,
      date: first.slate_date,
      startsAt: first.game_date,
      game: first.matchup,
      locked: first.locked_at !== null,
      storedRelease: first.model_version,
      release: NHL_REGULAR_MODEL_RELEASE,
      score: {
        before: { away: stored.model_output.projected_away_goals, home: stored.model_output.projected_home_goals },
        after: { away: candidate.model.projected_away_goals, home: candidate.model.projected_home_goals },
      },
      totalRead: candidate.targetExcludedTotalRead,
      targetExclusionStatus: candidate.targetExclusionStatus,
      targetExclusionCoherent: marketRows
        .filter((row) => row.market === "total")
        .every((row) => (
          candidate.targetExcludedTotalRead === null
          || row.after.sportsbook === null
          || row.after.sportsbook.toLowerCase().replace(/[^a-z0-9]/g, "")
            === candidate.targetExcludedTotalRead.excluded_sportsbook_family
        )),
      moneylineProbabilityDelta: candidate.model.moneyline.probability - candidate.seedModel.moneyline.probability,
      markets: marketRows,
    });
  }
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    incumbent: INCUMBENT,
    candidate: NHL_REGULAR_MODEL_RELEASE,
    games: output.length,
    markets: output.length * 3,
    sideChanges: output.flatMap((row) => row.markets).filter((row) => row.sideChanged).length,
    gradeChanges: output.flatMap((row) => row.markets).filter((row) => row.gradeChanged).length,
    rows: output,
  }, null, 2));
}

void main();
