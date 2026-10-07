import assert from "node:assert/strict";
import { supabase } from "../../lib/db/supabase";
import { isBlockedSportsbook } from "../../lib/config/blockedSportsbooks";
import {
  fetchSharpNhlEventOdds,
  fetchSharpNhlEvents,
  type SharpNhlOddsRow,
} from "../../lib/providers/nhl/_sharpApiNhlClient";
import { normalizeNhlTeamName, type NhlTeamAbbrev } from "../../lib/providers/nhl/_teamNameNormalizer";
import {
  nhlRegularModelV1,
  resolveNhlPriceAwareVerdict,
  type NhlFeatureSnapshot,
  type NhlModelMarket,
} from "../../lib/automodel/nhlRegularModelV1";
import {
  selectMainNhlPuckLinePair,
  selectMainNhlTotalLine,
} from "../../lib/services/nhl/featureSnapshot";
import { canonicalizeNhlLineRows } from "../../lib/services/nhl/nhlLineBoard";

type Game = {
  id: number;
  external_id: number;
  game_date: string;
  home_team_id: number;
  away_team_id: number;
};

type Line = {
  game_id: number;
  market_type: "moneyline" | "spread" | "total";
  sportsbook: string;
  side: "home" | "away" | "over" | "under";
  line_value: number | null;
  odds_american: number | null;
  implied_probability: number | null;
  source_timestamp: string | null;
};

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function implied(american: number | null): number | null {
  if (american === null || american === 0) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function market(raw: string | undefined): Line["market_type"] | null {
  if (raw === "moneyline") return "moneyline";
  if (raw === "puck_line") return "spread";
  if (raw === "total_goals") return "total";
  return null;
}

function side(
  row: SharpNhlOddsRow,
  rowHome: NhlTeamAbbrev,
  rowAway: NhlTeamAbbrev,
): Line["side"] | null {
  const raw = (row.selection_type ?? "").toLowerCase();
  if (raw === "home" || raw === "away" || raw === "over" || raw === "under") return raw;
  const selection = (row.selection ?? "").toLowerCase();
  if (selection.includes("over")) return "over";
  if (selection.includes("under")) return "under";
  if (normalizeNhlTeamName(row.selection) === rowHome) return "home";
  if (normalizeNhlTeamName(row.selection) === rowAway) return "away";
  return null;
}

function normalizeRows(
  rows: SharpNhlOddsRow[],
  game: Game,
  canonicalHome: NhlTeamAbbrev,
  canonicalAway: NhlTeamAbbrev,
): Line[] {
  const prepared: Line[] = [];
  for (const row of rows) {
    if (row.is_alternate_line === true || row.is_main_line === false || row.is_active === false
      || row.is_live === true || row.is_stale_pregame_price === true) continue;
    const rowHome = normalizeNhlTeamName(row.home_team);
    const rowAway = normalizeNhlTeamName(row.away_team);
    if (!rowHome || !rowAway) continue;
    if (!((rowHome === canonicalHome && rowAway === canonicalAway)
      || (rowHome === canonicalAway && rowAway === canonicalHome))) continue;
    const normalizedMarket = market(row.market_type);
    let normalizedSide = side(row, rowHome, rowAway);
    if (!normalizedMarket || !normalizedSide) continue;
    if (normalizedSide === "home" && rowHome !== canonicalHome) normalizedSide = "away";
    else if (normalizedSide === "away" && rowAway !== canonicalAway) normalizedSide = "home";
    if (normalizedMarket === "total" && normalizedSide !== "over" && normalizedSide !== "under") continue;
    if (normalizedMarket !== "total" && normalizedSide !== "home" && normalizedSide !== "away") continue;
    const american = numberOrNull(row.odds_american);
    const sportsbook = (row.sportsbook ?? "").trim().toLowerCase();
    if (!sportsbook || american === null || isBlockedSportsbook(sportsbook)) continue;
    prepared.push({
      game_id: game.id,
      market_type: normalizedMarket,
      sportsbook,
      side: normalizedSide,
      line_value: numberOrNull(row.line),
      odds_american: american,
      implied_probability: implied(american),
      source_timestamp: row.timestamp ?? null,
    });
  }
  return canonicalizeNhlLineRows(prepared);
}

function mlConsensus(lines: Line[]): { home: number | null; books: number } {
  const pairs = new Map<string, { home?: number; away?: number }>();
  for (const line of lines) {
    if (line.market_type !== "moneyline" || (line.side !== "home" && line.side !== "away")) continue;
    const pair = pairs.get(line.sportsbook) ?? {};
    if (line.implied_probability !== null) pair[line.side] = line.implied_probability;
    pairs.set(line.sportsbook, pair);
  }
  const devig = [...pairs.values()].flatMap((pair) => (
    pair.home === undefined || pair.away === undefined || pair.home + pair.away <= 0
      ? []
      : [pair.home / (pair.home + pair.away)]
  ));
  return {
    home: devig.length === 0 ? null : devig.reduce((sum, value) => sum + value, 0) / devig.length,
    books: devig.length,
  };
}

function bestProbability(lines: Line[], marketType: Line["market_type"], wantedSide: Line["side"], lineValue?: number | null): number | null {
  const prices = lines.filter((line) => (
    line.market_type === marketType
    && line.side === wantedSide
    && (lineValue === undefined || lineValue === null || (line.line_value !== null && Math.abs(line.line_value - lineValue) < 0.01))
    && line.odds_american !== null
  )).map((line) => line.odds_american!);
  return prices.length === 0 ? null : implied(Math.max(...prices));
}

function bestPrice(lines: Line[], marketType: Line["market_type"], wantedSide: Line["side"], lineValue?: number | null): number | null {
  const prices = lines.filter((line) => (
    line.market_type === marketType
    && line.side === wantedSide
    && (lineValue === undefined || lineValue === null || (line.line_value !== null && Math.abs(line.line_value - lineValue) < 0.01))
    && line.odds_american !== null
  )).map((line) => line.odds_american!);
  return prices.length === 0 ? null : Math.max(...prices);
}

function marketSnapshot(lines: Line[], previous: NhlModelMarket): NhlModelMarket {
  const consensus = mlConsensus(lines);
  const totalLine = selectMainNhlTotalLine(lines);
  const puckLine = selectMainNhlPuckLinePair(lines);
  return {
    ...previous,
    market_home_prob: consensus.home,
    best_home_ml_prob: bestProbability(lines, "moneyline", "home"),
    best_away_ml_prob: bestProbability(lines, "moneyline", "away"),
    market_open_home_prob: consensus.home,
    market_total_line: totalLine,
    market_open_total_line: totalLine,
    same_book_home_prob_move: 0,
    same_book_total_move: 0,
    market_home_puck_line: puckLine.home,
    market_away_puck_line: puckLine.away,
    market_home_puck_prob: bestProbability(lines, "spread", "home", puckLine.home),
    market_away_puck_prob: bestProbability(lines, "spread", "away", puckLine.away),
    market_book_count: consensus.books,
  };
}

function actionable(verdict: string): boolean {
  return verdict === "best_angle" || verdict === "lean";
}

async function main(): Promise<void> {
  const slateDate = process.argv[2] ?? "2026-10-07";
  const sharpApiKey = process.env.SHARPAPI_KEY;
  assert.ok(sharpApiKey, "SHARPAPI_KEY is required");

  const { data: gameData, error: gameError } = await supabase.from("games")
    .select("id,external_id,game_date,home_team_id,away_team_id")
    .eq("sport", "nhl").eq("slate_date", slateDate);
  if (gameError) throw gameError;
  const games = (gameData ?? []) as Game[];
  const teamIds = [...new Set(games.flatMap((game) => [game.home_team_id, game.away_team_id]))];
  const { data: teamData, error: teamError } = await supabase.from("teams")
    .select("id,abbreviation").in("id", teamIds);
  if (teamError) throw teamError;
  const teamById = new Map((teamData ?? []).map((team) => [Number(team.id), String(team.abbreviation)]));
  const { data: recordData, error: recordError } = await supabase.from("prediction_records")
    .select("game_id,market,play_grade,no_bet,snapshot_json")
    .eq("sport", "nhl").eq("slate_date", slateDate)
    .eq("model_version", "nhl_regular_2026_r14_best_angle_calibration");
  if (recordError) throw recordError;
  const records = recordData ?? [];
  const eventDates = [...new Set(games.map((game) => game.game_date.slice(0, 10)))];
  const events = (await Promise.all(eventDates.map((date) => fetchSharpNhlEvents(date, sharpApiKey)))).flat();

  const results: Array<Record<string, unknown>> = [];
  for (const game of games) {
    const home = normalizeNhlTeamName(teamById.get(game.home_team_id));
    const away = normalizeNhlTeamName(teamById.get(game.away_team_id));
    assert.ok(home && away, `missing canonical teams for game ${game.id}`);
    const event = events.filter((candidate) => (
      normalizeNhlTeamName(candidate.home_team) === home
      && normalizeNhlTeamName(candidate.away_team) === away
      && Math.abs(Date.parse(candidate.start_time ?? "") - Date.parse(game.game_date)) <= 12 * 3_600_000
    )).sort((left, right) => (right.market_count ?? 0) - (left.market_count ?? 0))[0];
    assert.ok(event?.id, `missing provider event for ${away}@${home}`);
    const lines = normalizeRows(await fetchSharpNhlEventOdds(event.id, sharpApiKey), game, home, away);
    const gameRecords = records.filter((record) => Number(record.game_id) === game.id);
    const stored = gameRecords[0]?.snapshot_json as { feature_inputs?: NhlFeatureSnapshot; model_output?: { projected_away_goals: number; projected_home_goals: number } } | undefined;
    assert.ok(stored?.feature_inputs, `missing r14 feature snapshot for game ${game.id}`);
    const snapshot: NhlFeatureSnapshot = {
      ...structuredClone(stored.feature_inputs),
      market: marketSnapshot(lines, stored.feature_inputs.market),
    };
    const candidate = nhlRegularModelV1(snapshot);
    const mlSide = candidate.moneyline.pick.startsWith(home) ? "home" : "away";
    const totalSide = candidate.total.pick.startsWith("OVER") ? "over" : "under";
    const puckSide = candidate.puck_line.pick.startsWith(home) ? "home" : "away";
    const mlPrice = bestPrice(lines, "moneyline", mlSide);
    const totalPrice = bestPrice(lines, "total", totalSide, snapshot.market.market_total_line);
    const puckPrice = bestPrice(lines, "spread", puckSide, candidate.puck_line.puck_line_value);
    const verdicts = {
      moneyline: resolveNhlPriceAwareVerdict("moneyline", candidate.moneyline.verdict, mlPrice, candidate.moneyline.probability),
      total: resolveNhlPriceAwareVerdict("total", candidate.total.verdict, totalPrice, candidate.total.probability),
      spread: resolveNhlPriceAwareVerdict("spread", candidate.puck_line.verdict, puckPrice, candidate.puck_line.probability),
    };
    const priorActionable = Object.fromEntries(gameRecords.map((record) => [record.market, record.no_bet !== true && (record.play_grade === "best_signal" || record.play_grade === "model_only")]));
    results.push({
      game_id: game.id,
      matchup: `${away}@${home}`,
      complete_books: snapshot.market.market_book_count,
      rows: lines.length,
      prior_score: [stored.model_output?.projected_away_goals, stored.model_output?.projected_home_goals],
      candidate_score: [candidate.projected_away_goals, candidate.projected_home_goals],
      decision: candidate.layers.market_decision,
      picks: { moneyline: candidate.moneyline.pick, total: candidate.total.pick, spread: candidate.puck_line.pick },
      prices: { moneyline: mlPrice, total: totalPrice, spread: puckPrice },
      verdicts,
      promotions: Object.entries(verdicts).filter(([key, verdict]) => actionable(verdict) && priorActionable[key] !== true).map(([key]) => key),
      demotions: Object.entries(verdicts).filter(([key, verdict]) => !actionable(verdict) && priorActionable[key] === true).map(([key]) => key),
    });
  }
  console.log(JSON.stringify({ slate_date: slateDate, games: results }, null, 2));
}

void main();
