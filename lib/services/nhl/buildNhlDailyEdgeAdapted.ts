/**
 * Phase 7L Phase 3 — NHL Daily Edge pipeline + adapter entry.
 *
 * Single entry point that the /api/lab/daily-edge route's NHL branch
 * calls. Reads all NHL data for the slate, runs the regular model per game,
 * and returns a DailyEdgeResponse-shaped object the shell can render.
 *
 * Read-only — no DB writes. Pure pipeline.
 */

import { supabase } from "../../db/supabase";
import {
  buildNhlFeatureSnapshot,
  nhlGameTypeFromExternalId,
  nhlSeasonStartYearFromExternalId,
} from "./featureSnapshot";
import {
  NHL_REGULAR_MODEL_RELEASE,
  NHL_REGULAR_TRANSITION_MODEL_RELEASES,
  type NhlFeatureSnapshot,
  type NhlModelOutput,
} from "../../automodel/nhlRegularModelV1";
import {
  adaptNhlGameToDto,
  buildNhlDailyEdgeResponse,
  type NhlAdapterGameInput,
  type NhlPerMarketBest,
  type NhlWriterVerdicts,
} from "./adaptNhlToDailyEdgeResponse";
import {
  fetchBdlNhlRosters,
  fetchBdlNhlTeamMetricsWithPriorFallback,
} from "../../providers/nhl/_ballDontLieNhlClient";
import {
  aggregateNhlRosterPrior,
  normalizeNhlPlayerName,
  type NhlRosterPrior,
} from "../../automodel/nhlRosterPrior2026";
import {
  fetchSharpNhlOpportunities,
  type SharpNhlOpportunity,
} from "../../providers/nhl/_sharpApiNhlClient";
import { normalizeNhlTeamName } from "../../providers/nhl/_teamNameNormalizer";
import type { DailyEdgeResponse } from "../../../app/lab/lib/labTypes";
import { resolvedNhlSplitsByGame, type ResolvedNhlSplitsEvent } from "./nhlResolvedSplits";
import { loadNhlRegularStateForSlate } from "./loadNhlRegularState";
import { isBlockedSportsbook } from "../../config/blockedSportsbooks";
import { buildNhlTwoSidedPriceTrail } from "./nhlPriceTrail";
import {
  canonicalizeNhlLineRows,
  resolveNhlLockedPriceQuote,
  selectNhlBestPriceQuote,
  type NhlCanonicalLineRow,
  type NhlSelectedPriceQuote,
} from "./nhlLineBoard";
import { buildNhlRegularMarketAwareForecast } from "./nhlTargetExcludedTotalMarket";

export const NHL_DAILY_EDGE_READER_RELEASE =
  "nhl_daily_edge_reader_2026_10_09_r13_target_excluded_total_reconciliation" as const;

type NhlStoredSnapshot = {
  model_output?: NhlModelOutput;
  feature_inputs?: NhlFeatureSnapshot;
  evaluated_quotes?: Partial<Record<"moneyline" | "total" | "spread", NhlSelectedPriceQuote | null>>;
  market_at_lock?: { lines_snapshot?: NhlCanonicalLineRow[] };
  captured_at?: string | null;
};

type NhlStoredRecord = {
  game_id: number;
  market: string;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  play_grade: string | null;
  no_bet: boolean | null;
  locked_at: string | null;
  model_version: string;
  snapshot_json: unknown;
};

export function nhlVerdictFromStoredDecision(
  playGrade: string | null,
  noBet: boolean | null,
): NhlModelOutput["moneyline"]["verdict"] {
  if (noBet === true) return "pass";
  switch (playGrade) {
    case "best_angle":
    case "best_signal":
      return "best_angle";
    case "lean":
    case "model_only":
      return "lean";
    case "watchlist":
    case "market_watch":
    case "market_aligned":
    case "provisional":
      return "watchlist";
    default:
      return "pass";
  }
}

/**
 * Bucket SharpAPI NHL opportunities by `"AWAY@HOME"` matchup key (normalized
 * to our DB abbreviations). Multiple opportunities per matchup are expected
 * (one per market × side × book).
 */
function bucketOpportunitiesByMatchup(
  opps: SharpNhlOpportunity[],
): Map<string, SharpNhlOpportunity[]> {
  const byKey = new Map<string, SharpNhlOpportunity[]>();
  for (const o of opps) {
    if (!o.home_team || !o.away_team) continue;
    const home = normalizeNhlTeamName(o.home_team);
    const away = normalizeNhlTeamName(o.away_team);
    if (!home || !away) continue;
    const key = `${away}@${home}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(o);
  }
  return byKey;
}

/**
 * Pick the best matching opportunity for a (market, side) tuple. Best =
 * highest ev_percentage. SharpAPI NHL market_type values: "moneyline",
 * "total_goals", "puck_line". team_side is "home"|"away" for ML and
 * puck_line; for totals we match on display_selection starting with
 * "Over"/"Under".
 */
function findOpportunityForPick(
  opps: SharpNhlOpportunity[],
  market: "ml" | "total" | "puckline",
  pickIsHome: boolean,
  pickIsOver: boolean,
): SharpNhlOpportunity | null {
  const sharpMarket =
    market === "ml" ? "moneyline" :
    market === "total" ? "total_goals" :
    "puck_line";
  const matching = opps.filter((o) => {
    if (o.market_type !== sharpMarket) return false;
    if (market === "total") {
      const sel = (o.display_selection ?? "").toLowerCase();
      return pickIsOver ? sel.startsWith("over") : sel.startsWith("under");
    }
    // ml + puckline use team_side
    const wantSide = pickIsHome ? "home" : "away";
    // @ts-expect-error — team_side is not in the published type but present in payload
    return (o.team_side ?? "").toLowerCase() === wantSide;
  });
  if (matching.length === 0) return null;
  return matching.reduce((best, cur) => {
    if (!best) return cur;
    return (cur.ev_percentage ?? -Infinity) > (best.ev_percentage ?? -Infinity) ? cur : best;
  }, null as SharpNhlOpportunity | null);
}

/**
 * Reduce a slate of SharpAPI NHL splits events down to one per (home,away)
 * matchup. SharpAPI returns one row per book per event; we collapse to the
 * single most-recent event row whose home/away teams normalize to our DB
 * abbreviations. Returns a map keyed by `"AWAY@HOME"`.
 */
export async function buildNhlDailyEdgeAdapted(date: string): Promise<DailyEdgeResponse> {
  // Fetch cross-book EV opportunities once. Public splits come from the
  // persisted dual-provider resolver after the slate games are loaded.
  let oppsByMatchup = new Map<string, SharpNhlOpportunity[]>();
  const sharpKey = process.env.SHARPAPI_KEY;
  if (sharpKey) {
    try {
      const opps = await fetchSharpNhlOpportunities(date, sharpKey);
      oppsByMatchup = bucketOpportunitiesByMatchup(opps);
    } catch (e) {
      console.warn(`nhl daily-edge: opportunities fetch failed: ${(e as Error).message}`);
    }
  }

  // Load games on this slate.
  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date, status, home_score, away_score")
    .eq("sport", "nhl")
    .eq("slate_date", date);
  if (gamesErr) throw new Error(`NHL games load: ${gamesErr.message}`);
  const games = ((gamesData ?? []) as Array<{
    id: number;
    external_id: number;
    home_team_id: number | null;
    away_team_id: number | null;
    game_date: string;
    status: string;
    home_score: number | null;
    away_score: number | null;
  }>).filter((game) => nhlGameTypeFromExternalId(game.external_id) === 2);

  if (games.length === 0) {
    return buildNhlDailyEdgeResponse({ date, requestedDate: date, games: [] });
  }

  let splitsByGame = new Map<number, ResolvedNhlSplitsEvent>();
  try {
    splitsByGame = await resolvedNhlSplitsByGame(supabase, date);
  } catch (error) {
    console.warn(`nhl daily-edge: persisted splits unavailable: ${(error as Error).message}`);
  }

  // Load teams for the games.
  const teamIds = new Set<number>();
  for (const g of games) {
    if (g.home_team_id !== null) teamIds.add(g.home_team_id);
    if (g.away_team_id !== null) teamIds.add(g.away_team_id);
  }
  const { data: teamsData } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", [...teamIds]);
  const teamById = new Map<number, { id: number; abbreviation: string }>(
    ((teamsData ?? []) as Array<{ id: number; abbreviation: string }>).map((t) => [t.id, t]),
  );

  const featureSeason = nhlSeasonStartYearFromExternalId(games[0]!.external_id);
  const calibratedStateByTeam = await loadNhlRegularStateForSlate(
    supabase,
    featureSeason,
    games.reduce((earliest, game) => game.game_date < earliest ? game.game_date : earliest, games[0]!.game_date),
  );
  let providerMetricsByTeam: Awaited<ReturnType<typeof fetchBdlNhlTeamMetricsWithPriorFallback>>["metrics"] = new Map();
  let providerFeatureSeason: number | null = null;
  const rosterPriorByTeam = new Map<string, NhlRosterPrior>();
  const currentRosterGoaliesByTeam = new Map<string, ReadonlySet<string>>(
    [...teamById.values()].map((team) => [team.abbreviation, new Set<string>()]),
  );
  const bdlKey = process.env.BALLDONTLIE_API_KEY;
  if (bdlKey) {
    try {
      const provider = await fetchBdlNhlTeamMetricsWithPriorFallback(featureSeason, bdlKey);
      providerMetricsByTeam = provider.metrics;
      providerFeatureSeason = provider.sourceSeason;
    } catch (error) {
      console.warn(`nhl daily-edge: BALLDONTLIE team metrics unavailable: ${(error as Error).message}`);
    }
    try {
      const rosters = await fetchBdlNhlRosters(
        featureSeason,
        [...teamById.values()].map((team) => team.abbreviation),
        bdlKey,
      );
      for (const [team, players] of rosters) {
        const prior = aggregateNhlRosterPrior(players);
        if (prior) rosterPriorByTeam.set(team, prior);
        currentRosterGoaliesByTeam.set(team, new Set(
          players
            .filter((player) => player.positionCode === "G")
            .map((player) => normalizeNhlPlayerName(player.fullName)),
        ));
      }
    } catch (error) {
      console.warn(`nhl daily-edge: BALLDONTLIE current rosters unavailable: ${(error as Error).message}`);
    }
  }

  // Read the writer-owned active-release tuple for both unlocked and locked
  // games. Recomputing an unlocked r6 card without the writer's persisted
  // opponent-adjusted state silently falls back to r5 scoring and can publish
  // a different score under the r6 deployment. Unlocked lines/prices remain a
  // separate live read below; locked rows use only their stored prediction and
  // frozen quote tuple from the sole writer.
  const { data: recordsData } = await supabase
    .from("prediction_records")
    .select("game_id, market, pick, side, line_value, odds_american, play_grade, no_bet, locked_at, model_version, snapshot_json")
    .eq("sport", "nhl")
    .in("model_version", [...NHL_REGULAR_TRANSITION_MODEL_RELEASES])
    .in("game_id", games.map((g) => g.id));
  const lockedByGame = new Map<number, string | null>();
  const predictionPayloadByGame = new Map<number, {
    model: NhlModelOutput;
    snapshot: NhlFeatureSnapshot;
    lockedAt: string | null;
    identity: string;
    modelVersion: string;
    storedSnapshot: NhlStoredSnapshot;
  }>();
  const incoherentPayloadReleaseGames = new Set<string>();
  const storedRecords = (recordsData ?? []) as NhlStoredRecord[];
  for (const r of storedRecords) {
    const existing = lockedByGame.get(r.game_id);
    // Prefer non-null locked_at over null when multiple rows exist for a game.
    if (existing === undefined || (existing === null && r.locked_at !== null)) {
      lockedByGame.set(r.game_id, r.locked_at);
    }
    const payload = r.snapshot_json as NhlStoredSnapshot | null;
    if (
      payload?.model_output
      && payload.feature_inputs
      && NHL_REGULAR_TRANSITION_MODEL_RELEASES.includes(
        payload.model_output.model_version as typeof NHL_REGULAR_TRANSITION_MODEL_RELEASES[number],
      )
      && payload.feature_inputs.game_type === 2
      && (r.model_version === NHL_REGULAR_MODEL_RELEASE || r.locked_at !== null)
    ) {
      const identity = JSON.stringify({
        model: payload.model_output,
        snapshot: payload.feature_inputs,
      });
      const prior = predictionPayloadByGame.get(r.game_id);
      if (prior && prior.modelVersion === r.model_version && prior.identity !== identity) {
        incoherentPayloadReleaseGames.add(`${r.game_id}:${r.model_version}`);
        continue;
      }
      const shouldReplace = !prior
        || (prior.lockedAt === null && r.locked_at !== null)
        || (prior.lockedAt === null && r.locked_at === null && r.model_version === NHL_REGULAR_MODEL_RELEASE);
      if (shouldReplace) predictionPayloadByGame.set(r.game_id, {
        model: payload.model_output,
        snapshot: payload.feature_inputs,
        lockedAt: r.locked_at,
        identity,
        modelVersion: r.model_version,
        storedSnapshot: payload,
      });
    }
  }
  for (const [gameId, payload] of predictionPayloadByGame) {
    if (incoherentPayloadReleaseGames.has(`${gameId}:${payload.modelVersion}`)) {
      predictionPayloadByGame.delete(gameId);
    }
  }
  const writerVerdictsByGame = new Map<number, NhlWriterVerdicts>();
  const selectedRecordsByGame = new Map<number, Map<"moneyline" | "total" | "spread", NhlStoredRecord>>();
  for (const r of storedRecords) {
    const payload = predictionPayloadByGame.get(r.game_id);
    if (!payload || r.model_version !== payload.modelVersion) continue;
    if ((payload.lockedAt !== null) !== (r.locked_at !== null)) continue;
    const key = r.market === "spread"
      ? "puckline"
      : r.market === "moneyline" || r.market === "total"
        ? r.market
        : null;
    if (key === null) continue;
    const gameVerdicts = writerVerdictsByGame.get(r.game_id) ?? {};
    gameVerdicts[key] = nhlVerdictFromStoredDecision(r.play_grade, r.no_bet);
    writerVerdictsByGame.set(r.game_id, gameVerdicts);
    if (r.market === "moneyline" || r.market === "total" || r.market === "spread") {
      const gameRecords = selectedRecordsByGame.get(r.game_id) ?? new Map();
      gameRecords.set(r.market, r);
      selectedRecordsByGame.set(r.game_id, gameRecords);
    }
  }

  // Per-game pipeline.
  const dtos = [];
  for (const g of games) {
    const homeAbbr = g.home_team_id !== null ? teamById.get(g.home_team_id)?.abbreviation ?? "?" : "?";
    const awayAbbr = g.away_team_id !== null ? teamById.get(g.away_team_id)?.abbreviation ?? "?" : "?";
    try {
      const splitsEvent = splitsByGame.get(g.id) ?? null;
      const built = await buildNhlFeatureSnapshot({
        gameId: g.id,
        providerMetricsByTeam,
        providerFeatureSeason,
        calibratedStateByTeam,
        rosterPriorByTeam,
        currentRosterGoaliesByTeam,
        marketEvidence: {
          mlHomeBetsPct: splitsEvent?.moneyline?.bets_pct?.home == null ? null : splitsEvent.moneyline.bets_pct.home * 100,
          mlHomeMoneyPct: splitsEvent?.moneyline?.handle_pct?.home == null ? null : splitsEvent.moneyline.handle_pct.home * 100,
          totalOverBetsPct: splitsEvent?.total?.bets_pct?.over == null ? null : splitsEvent.total.bets_pct.over * 100,
          totalOverMoneyPct: splitsEvent?.total?.handle_pct?.over == null ? null : splitsEvent.total.handle_pct.over * 100,
          mlSplitSource: splitsEvent?.internal_resolution?.moneyline?.source ?? null,
          mlSplitConfidence: splitsEvent?.internal_resolution?.moneyline?.confidence ?? "none",
          totalSplitSource: splitsEvent?.internal_resolution?.total?.source ?? null,
          totalSplitConfidence: splitsEvent?.internal_resolution?.total?.confidence ?? "none",
        },
      });
      const storedPayload = predictionPayloadByGame.get(g.id);
      const marketAware = storedPayload ? null : buildNhlRegularMarketAwareForecast({
        snapshot: built.snapshot,
        currentRows: built.meta.market_lines,
        historyRows: built.meta.market_history_lines,
      });
      const snapshot = storedPayload?.snapshot ?? marketAware!.snapshot;
      const model = storedPayload?.model ?? marketAware!.model;

      // Pull lines once for ML + Total + Spread (NHL puck-line is
      // stored under market_type="spread" in our lines table, same
      // convention as NBA). Puck line is an official NHL market, so the
      // real line and price must remain coherent with the tracked read.
      const { data: linesData } = await supabase
        .from("lines")
        .select("market_type, sportsbook, side, line_value, odds_american, fetched_at")
        .eq("game_id", g.id)
        .is("player_id", null)
        .in("market_type", ["moneyline", "total", "spread"]);
      const lines = canonicalizeNhlLineRows(((linesData ?? []) as Array<{
        market_type: string; sportsbook: string; side: string;
        line_value: number | null; odds_american: number | null;
        fetched_at: string | null;
      }>).filter((line) => !isBlockedSportsbook(line.sportsbook)).map((line) => ({
        ...line,
        observed_at: line.fetched_at,
      })));

      // Pull line_history once for the same game so we can surface the
      // first-observed price per (market, side) as "open" alongside
      // current. line_value is included so the spread filter can
      // distinguish the natural puck-line side from the alt line.
      const { data: histData } = await supabase
        .from("line_history")
        .select("market_type, sportsbook, side, line_value, odds_american, recorded_at")
        .eq("game_id", g.id)
        .is("player_id", null)
        .in("market_type", ["moneyline", "total", "spread"])
        .order("recorded_at", { ascending: true });
      const history = ((histData ?? []) as Array<{
        market_type: string; sportsbook: string; side: string;
        line_value: number | null;
        odds_american: number | null; recorded_at: string | null;
      }>);
      const selectedRecords = selectedRecordsByGame.get(g.id);
      const isLocked = storedPayload?.lockedAt !== null && storedPayload?.lockedAt !== undefined;
      const lockCutoff = isLocked ? Date.parse(storedPayload.lockedAt!) : Number.POSITIVE_INFINITY;
      const eligibleHistory = history.filter((row) => {
        if (!isLocked) return true;
        const observed = Date.parse(row.recorded_at ?? "");
        return Number.isFinite(observed) && observed <= lockCutoff;
      });
      const frozenLines = (storedPayload?.storedSnapshot.market_at_lock?.lines_snapshot ?? []).map((line) => ({
        ...line,
        observed_at: line.observed_at
          ?? storedPayload?.storedSnapshot.captured_at
          ?? storedPayload?.lockedAt
          ?? null,
      }));

      /**
       * Open-price for the line-move row. Honest apples-to-apples:
       * returns the first-observed price FROM THE SAME book that is
       * currently quoting the best price. If `targetBook` is null
       * (no current best), returns null. If that book has no history
       * rows, also returns null. Totals and spreads use the same exact-line
       * identity as bestPriceFor.
       */
      function openPriceForSameBook(
        market: string,
        side: string,
        targetBook: string | null,
        targetLine: number | null,
      ): number | null {
        if (targetBook === null) return null;
        const row = eligibleHistory.find((h) => {
          if (h.market_type !== market || h.side !== side) return false;
          if (h.sportsbook !== targetBook) return false;
          if (h.odds_american === null) return false;
          if (market === "moneyline") return true;
          return targetLine !== null && h.line_value !== null && Math.abs(h.line_value - targetLine) < 0.01;
        });
        return row?.odds_american ?? null;
      }

      const mlPickIsHome = model.moneyline.pick.startsWith(homeAbbr);
      const lockedMl = isLocked ? selectedRecords?.get("moneyline") : undefined;
      const mlSide = lockedMl?.side === "home" || lockedMl?.side === "away"
        ? lockedMl.side
        : mlPickIsHome ? "home" : "away";

      const totalPickIsOver = model.total.pick.startsWith("OVER");
      const lockedTotal = isLocked ? selectedRecords?.get("total") : undefined;
      const totalSide = lockedTotal?.side === "over" || lockedTotal?.side === "under"
        ? lockedTotal.side
        : totalPickIsOver ? "over" : "under";
      const marketTotalLine = isLocked && lockedTotal
        ? lockedTotal.line_value
        : snapshot.market.market_total_line;
      // 2026-06-14: the displayed market line MUST be the exact value the
      // model's pick label was built from. nhlRegularModelV1 builds
      // "OVER {snap.market.market_total_line}" — so read the same field here
      // (single source of truth) instead of re-deriving from a separate lines
      // query. snapshot.market.market_total_line = selectMainNhlTotalLine
      // (consensus, blocked-book filtered). Old code took an arbitrary book's
      // first non-null row → card line disagreed with the pick label.
      // Puck-line: stored under market_type="spread". The lines table
      // can carry BOTH the natural puck-line side and an alt-line
      // side under the same `side` tag. Filter to the exact signed line our
      // pick maps to.
      //
      // Model pick string is "{ABBR} -1.5" (laying points) or
      // "{ABBR} +1.5" (taking points). The line_value sign on the
      // matching row will mirror this.
      const plPickIsHome = model.puck_line.pick.startsWith(homeAbbr);
      const lockedSpread = isLocked ? selectedRecords?.get("spread") : undefined;
      const plSide = lockedSpread?.side === "home" || lockedSpread?.side === "away"
        ? lockedSpread.side
        : plPickIsHome ? "home" : "away";
      const predictedPuckLine = isLocked && lockedSpread?.line_value !== null && lockedSpread?.line_value !== undefined
        ? lockedSpread.line_value
        : model.puck_line.puck_line_value;

      const quoteRows: NhlCanonicalLineRow[] = (isLocked ? frozenLines : lines).map((line) => ({
        market_type: line.market_type,
        sportsbook: line.sportsbook,
        side: line.side,
        line_value: line.line_value,
        odds_american: line.odds_american,
        observed_at: line.observed_at ?? null,
        source_timestamp: "source_timestamp" in line ? line.source_timestamp ?? null : null,
      }));
      const lockedQuotes = storedPayload?.storedSnapshot.evaluated_quotes;
      const mlQuote = lockedMl
        ? resolveNhlLockedPriceQuote({
          market: "moneyline",
          side: mlSide,
          line: null,
          price: lockedMl.odds_american,
          lockedAt: storedPayload?.lockedAt ?? null,
          evaluatedQuote: lockedQuotes?.moneyline ?? null,
          frozenLines,
        })
        : selectNhlBestPriceQuote({ rows: quoteRows, market: "moneyline", side: mlSide, line: null });
      const totalQuote = lockedTotal
        ? resolveNhlLockedPriceQuote({
          market: "total",
          side: totalSide,
          line: marketTotalLine,
          price: lockedTotal.odds_american,
          lockedAt: storedPayload?.lockedAt ?? null,
          evaluatedQuote: lockedQuotes?.total ?? null,
          frozenLines,
        })
        : marketTotalLine === null
          ? null
          : selectNhlBestPriceQuote({ rows: quoteRows, market: "total", side: totalSide, line: marketTotalLine });
      const puckLineQuote = lockedSpread
        ? resolveNhlLockedPriceQuote({
          market: "spread",
          side: plSide,
          line: predictedPuckLine,
          price: lockedSpread.odds_american,
          lockedAt: storedPayload?.lockedAt ?? null,
          evaluatedQuote: lockedQuotes?.spread ?? null,
          frozenLines,
        })
        : selectNhlBestPriceQuote({ rows: quoteRows, market: "spread", side: plSide, line: predictedPuckLine });
      const puckLineMarketLine = puckLineQuote?.line_value ?? (lockedSpread?.line_value ?? null);

      const liveTrailRows = quoteRows.map((line) => ({
        market_type: line.market_type,
        sportsbook: line.sportsbook,
        side: line.side,
        line_value: line.line_value,
        odds_american: line.odds_american,
        observed_at: line.observed_at ?? null,
      }));
      const historyTrailRows = eligibleHistory
        .filter((row) => !isBlockedSportsbook(row.sportsbook))
        .map((row) => ({
          market_type: row.market_type,
          sportsbook: row.sportsbook,
          side: row.side,
          line_value: row.line_value,
          odds_american: row.odds_american,
          observed_at: row.recorded_at,
        }));
      const mlTrail = buildNhlTwoSidedPriceTrail({
        live: liveTrailRows,
        history: historyTrailRows,
        market: "moneyline",
        selectedSide: mlSide,
        opposingSide: mlSide === "home" ? "away" : "home",
        selectedLine: null,
        opposingLine: null,
        preferredBook: mlQuote?.sportsbook || null,
      });
      const totalTrail = buildNhlTwoSidedPriceTrail({
        live: liveTrailRows,
        history: historyTrailRows,
        market: "total",
        selectedSide: totalSide,
        opposingSide: totalSide === "over" ? "under" : "over",
        selectedLine: marketTotalLine,
        opposingLine: marketTotalLine,
        preferredBook: totalQuote?.sportsbook || null,
      });
      const puckLineTrail = buildNhlTwoSidedPriceTrail({
        live: liveTrailRows,
        history: historyTrailRows,
        market: "spread",
        selectedSide: plSide,
        opposingSide: plSide === "home" ? "away" : "home",
        selectedLine: predictedPuckLine,
        opposingLine: -predictedPuckLine,
        preferredBook: puckLineQuote?.sportsbook || null,
      });

      // Locked cards render only their immutable stored tuple. Live
      // opportunities remain eligible for unlocked cards but cannot replace
      // a lock-time price denominator or its book association.
      const oppsForGame = isLocked ? [] : (oppsByMatchup.get(`${awayAbbr}@${homeAbbr}`) ?? []);

      const mlOpp = findOpportunityForPick(oppsForGame, "ml", mlPickIsHome, false);
      const totalOpp = findOpportunityForPick(oppsForGame, "total", false, totalPickIsOver);
      const puckLineOpp = findOpportunityForPick(oppsForGame, "puckline", plPickIsHome, false);

      const mlBundle: NhlPerMarketBest = {
        priceAmerican: mlQuote?.odds_american ?? null,
        sportsbook: mlQuote?.sportsbook || null,
        openAmerican: mlTrail.selected[0]?.american ?? openPriceForSameBook("moneyline", mlSide, mlQuote?.sportsbook || null, null),
        observedAt: mlQuote?.observed_at ?? null,
        oddsTrail: mlTrail.selected,
        lineTrail: mlTrail.line,
        opposingOddsTrail: {
          side: mlSide === "home" ? "away" : "home",
          label: mlSide === "home" ? awayAbbr : homeAbbr,
          stops: mlTrail.opposing,
        },
        pinnacleEvPct: mlOpp?.ev_percentage ?? null,
        fairProbability: mlOpp?.fair_probability ?? null,
      };
      const totalBundle: NhlPerMarketBest = {
        priceAmerican: totalQuote?.odds_american ?? null,
        sportsbook: totalQuote?.sportsbook || null,
        openAmerican: totalTrail.selected[0]?.american ?? openPriceForSameBook("total", totalSide, totalQuote?.sportsbook || null, marketTotalLine),
        observedAt: totalQuote?.observed_at ?? null,
        oddsTrail: totalTrail.selected,
        lineTrail: totalTrail.line,
        opposingOddsTrail: {
          side: totalSide === "over" ? "under" : "over",
          label: totalSide === "over" ? "Under" : "Over",
          stops: totalTrail.opposing,
        },
        pinnacleEvPct: totalOpp?.ev_percentage ?? null,
        fairProbability: totalOpp?.fair_probability ?? null,
      };
      const puckLineBundle: NhlPerMarketBest = {
        priceAmerican: puckLineQuote?.odds_american ?? null,
        sportsbook: puckLineQuote?.sportsbook || null,
        openAmerican: puckLineTrail.selected[0]?.american ?? openPriceForSameBook("spread", plSide, puckLineQuote?.sportsbook || null, predictedPuckLine),
        observedAt: puckLineQuote?.observed_at ?? null,
        oddsTrail: puckLineTrail.selected,
        lineTrail: puckLineTrail.line,
        opposingOddsTrail: {
          side: plSide === "home" ? "away" : "home",
          label: `${plSide === "home" ? awayAbbr : homeAbbr} ${-predictedPuckLine > 0 ? "+" : ""}${(-predictedPuckLine).toFixed(1)}`,
          stops: puckLineTrail.opposing,
        },
        pinnacleEvPct: puckLineOpp?.ev_percentage ?? null,
        fairProbability: puckLineOpp?.fair_probability ?? null,
      };

      const input: NhlAdapterGameInput = {
        gameId: g.id,
        externalId: g.external_id,
        homeAbbr,
        awayAbbr,
        gameDateIso: g.game_date,
        status: g.status,
        homeScore: g.home_score,
        awayScore: g.away_score,
        model,
        snapshot,
        mlBundle,
        totalBundle,
        puckLineBundle,
        marketTotalLine,
        puckLineMarketLine,
        splits: splitsEvent,
        lockedAt: storedPayload?.lockedAt ?? lockedByGame.get(g.id) ?? null,
        writerVerdicts: writerVerdictsByGame.get(g.id),
      };
      dtos.push(adaptNhlGameToDto(input));
    } catch (e) {
      console.warn(`nhl daily-edge: game ${g.id} failed: ${(e as Error).message}`);
    }
  }

  return buildNhlDailyEdgeResponse({ date, requestedDate: date, games: dtos });
}
