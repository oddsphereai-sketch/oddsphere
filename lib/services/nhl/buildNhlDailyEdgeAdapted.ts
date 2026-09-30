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
  nhlRegularModelV1,
  type NhlFeatureSnapshot,
  type NhlModelOutput,
} from "../../automodel/nhlRegularModelV1";
import {
  adaptNhlGameToDto,
  buildNhlDailyEdgeResponse,
  type NhlAdapterGameInput,
  type NhlPerMarketBest,
} from "./adaptNhlToDailyEdgeResponse";
import { fetchBdlNhlTeamMetricsWithPriorFallback } from "../../providers/nhl/_ballDontLieNhlClient";
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
import { canonicalizeNhlLineRows } from "./nhlLineBoard";

export const NHL_DAILY_EDGE_READER_RELEASE =
  "nhl_daily_edge_reader_2026_09_29_r6_t60_market_refresh_transition" as const;

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
  const bdlKey = process.env.BALLDONTLIE_API_KEY;
  if (bdlKey) {
    try {
      const provider = await fetchBdlNhlTeamMetricsWithPriorFallback(featureSeason, bdlKey);
      providerMetricsByTeam = provider.metrics;
      providerFeatureSeason = provider.sourceSeason;
    } catch (error) {
      console.warn(`nhl daily-edge: BALLDONTLIE team metrics unavailable: ${(error as Error).message}`);
    }
  }

  // Read the writer-owned active-release tuple for both unlocked and locked
  // games. Recomputing an unlocked r6 card without the writer's persisted
  // opponent-adjusted state silently falls back to r5 scoring and can publish
  // a different score under the r6 deployment. Current lines/prices remain a
  // separate live read below; the prediction tuple comes from the sole writer.
  const { data: recordsData } = await supabase
    .from("prediction_records")
    .select("game_id, locked_at, model_version, snapshot_json")
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
  }>();
  const incoherentPayloadReleaseGames = new Set<string>();
  for (const r of ((recordsData ?? []) as Array<{
    game_id: number;
    locked_at: string | null;
    model_version: string;
    snapshot_json: unknown;
  }>)) {
    const existing = lockedByGame.get(r.game_id);
    // Prefer non-null locked_at over null when multiple rows exist for a game.
    if (existing === undefined || (existing === null && r.locked_at !== null)) {
      lockedByGame.set(r.game_id, r.locked_at);
    }
    const payload = r.snapshot_json as {
      model_output?: NhlModelOutput;
      feature_inputs?: NhlFeatureSnapshot;
    } | null;
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
      });
    }
  }
  for (const [gameId, payload] of predictionPayloadByGame) {
    if (incoherentPayloadReleaseGames.has(`${gameId}:${payload.modelVersion}`)) {
      predictionPayloadByGame.delete(gameId);
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
      const snapshot = storedPayload?.snapshot ?? built.snapshot;
      const model = storedPayload?.model ?? nhlRegularModelV1(snapshot);

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

      /**
       * Find the best-price (highest American odds) row for the picked
       * side and exact displayed line. Exact line matching prevents a total
       * or puck-line pick from borrowing a more attractive alternate-line
       * price under the same side token.
       *
       * Boost / promotional-price filter: some books (e.g. fliff) ingest
       * with both their main line and a heavily-boosted promotional
       * line tagged identically. When 3+ candidates are available,
       * compute the median and drop anything more than
       * BOOST_OUTLIER_THRESHOLD American points away — that catches
       * boosts (often 100+ pp off) while leaving normal book-to-book
       * variance (typically < 20 pp) intact. With 1-2 candidates we
       * have no robust median, so we take what's available.
       *
       * For ML, line_value is not part of the identity. Totals and spreads
       * must match `targetLine` exactly.
       */
      const BOOST_OUTLIER_THRESHOLD = 50; // American points
      function bestPriceFor(
        market: string,
        side: string,
        targetLine: number | null,
      ): { price: number | null; book: string | null; observedAt: string | null } {
        const candidates = lines.filter((l) => {
          if (l.market_type !== market || l.side !== side) return false;
          if (l.odds_american === null) return false;
          if (market === "moneyline") return true;
          return targetLine !== null && l.line_value !== null && Math.abs(l.line_value - targetLine) < 0.01;
        });
        if (candidates.length === 0) return { price: null, book: null, observedAt: null };

        let filtered = candidates;
        if (candidates.length >= 3) {
          const sorted = [...candidates].sort((a, b) => a.odds_american! - b.odds_american!);
          const median = sorted[Math.floor(sorted.length / 2)]!.odds_american!;
          filtered = candidates.filter(
            (c) => Math.abs(c.odds_american! - median) <= BOOST_OUTLIER_THRESHOLD,
          );
          // Defensive: if the filter somehow drops everything (shouldn't
          // happen since the median itself passes), fall back to raw.
          if (filtered.length === 0) filtered = candidates;
        }

        let bestPrice: number | null = null;
        let bestBook: string | null = null;
        let observedAt: string | null = null;
        for (const c of filtered) {
          if (bestPrice === null || c.odds_american! > bestPrice) {
            bestPrice = c.odds_american!;
            bestBook = c.sportsbook;
            observedAt = c.fetched_at;
          }
        }
        return { price: bestPrice, book: bestBook, observedAt };
      }
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
        const row = history.find((h) => {
          if (h.market_type !== market || h.side !== side) return false;
          if (h.sportsbook !== targetBook) return false;
          if (h.odds_american === null) return false;
          if (market === "moneyline") return true;
          return targetLine !== null && h.line_value !== null && Math.abs(h.line_value - targetLine) < 0.01;
        });
        return row?.odds_american ?? null;
      }

      const mlPickIsHome = model.moneyline.pick.startsWith(homeAbbr);
      const mlSide = mlPickIsHome ? "home" : "away";
      const mlBest = bestPriceFor("moneyline", mlSide, null);

      const marketTotalLine = snapshot.market.market_total_line;
      const totalPickIsOver = model.total.pick.startsWith("OVER");
      const totalSide = totalPickIsOver ? "over" : "under";
      const totalBest = bestPriceFor("total", totalSide, marketTotalLine);
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
      const plSide = plPickIsHome ? "home" : "away";
      const predictedPuckLine = model.puck_line.puck_line_value;
      const plLineEntries = lines.filter((l) =>
        l.market_type === "spread"
        && l.side === plSide
        && l.line_value !== null
        && Math.abs(l.line_value - predictedPuckLine) < 0.01
      );
      const plBest = bestPriceFor("spread", plSide, predictedPuckLine);
      const puckLineMarketLine = plLineEntries.find((l) => l.line_value !== null)?.line_value ?? null;

      const liveTrailRows = lines.map((line) => ({
        market_type: line.market_type,
        sportsbook: line.sportsbook,
        side: line.side,
        line_value: line.line_value,
        odds_american: line.odds_american,
        observed_at: line.fetched_at,
      }));
      const historyTrailRows = history
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
        preferredBook: mlBest.book,
      });
      const totalTrail = buildNhlTwoSidedPriceTrail({
        live: liveTrailRows,
        history: historyTrailRows,
        market: "total",
        selectedSide: totalSide,
        opposingSide: totalSide === "over" ? "under" : "over",
        selectedLine: marketTotalLine,
        opposingLine: marketTotalLine,
        preferredBook: totalBest.book,
      });
      const puckLineTrail = buildNhlTwoSidedPriceTrail({
        live: liveTrailRows,
        history: historyTrailRows,
        market: "spread",
        selectedSide: plSide,
        opposingSide: plSide === "home" ? "away" : "home",
        selectedLine: predictedPuckLine,
        opposingLine: -predictedPuckLine,
        preferredBook: plBest.book,
      });

      const oppsForGame = oppsByMatchup.get(`${awayAbbr}@${homeAbbr}`) ?? [];

      const mlOpp = findOpportunityForPick(oppsForGame, "ml", mlPickIsHome, false);
      const totalOpp = findOpportunityForPick(oppsForGame, "total", false, totalPickIsOver);
      const puckLineOpp = findOpportunityForPick(oppsForGame, "puckline", plPickIsHome, false);

      const mlBundle: NhlPerMarketBest = {
        priceAmerican: mlBest.price,
        sportsbook: mlBest.book,
        openAmerican: mlTrail.selected[0]?.american ?? openPriceForSameBook("moneyline", mlSide, mlBest.book, null),
        observedAt: mlBest.observedAt,
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
        priceAmerican: totalBest.price,
        sportsbook: totalBest.book,
        openAmerican: totalTrail.selected[0]?.american ?? openPriceForSameBook("total", totalSide, totalBest.book, marketTotalLine),
        observedAt: totalBest.observedAt,
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
        priceAmerican: plBest.price,
        sportsbook: plBest.book,
        openAmerican: puckLineTrail.selected[0]?.american ?? openPriceForSameBook("spread", plSide, plBest.book, predictedPuckLine),
        observedAt: plBest.observedAt,
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
        lockedAt: lockedByGame.get(g.id) ?? null,
      };
      dtos.push(adaptNhlGameToDto(input));
    } catch (e) {
      console.warn(`nhl daily-edge: game ${g.id} failed: ${(e as Error).message}`);
    }
  }

  return buildNhlDailyEdgeResponse({ date, requestedDate: date, games: dtos });
}
