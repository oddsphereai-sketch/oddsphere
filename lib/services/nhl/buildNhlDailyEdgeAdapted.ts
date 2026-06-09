/**
 * Phase 7L Phase 3 — NHL Daily Edge pipeline + adapter entry.
 *
 * Single entry point that the /api/lab/daily-edge route's NHL branch
 * calls. Reads all NHL data for the slate, runs the v0 model per game,
 * and returns a DailyEdgeResponse-shaped object the shell can render.
 *
 * Read-only — no DB writes. Pure pipeline.
 */

import { supabase } from "../../db/supabase";
import { buildNhlFeatureSnapshot } from "./featureSnapshot";
import { nhlAutoModelV0 } from "../../automodel/nhlAutoModelV0";
import {
  adaptNhlGameToDto,
  buildNhlDailyEdgeResponse,
  type NhlAdapterGameInput,
  type NhlPerMarketBest,
} from "./adaptNhlToDailyEdgeResponse";
import { moneyPuckSeasonStartYear } from "../../providers/nhl/_moneyPuckClient";
import {
  fetchSharpNhlSplits,
  fetchSharpNhlOpportunities,
  type SharpNhlSplitsEvent,
  type SharpNhlOpportunity,
} from "../../providers/nhl/_sharpApiNhlClient";
import { normalizeNhlTeamName } from "../../providers/nhl/_teamNameNormalizer";
import type { DailyEdgeResponse } from "../../../app/lab/lib/labTypes";

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
function reduceSplitsByMatchup(
  events: SharpNhlSplitsEvent[],
): Map<string, SharpNhlSplitsEvent> {
  const byKey = new Map<string, SharpNhlSplitsEvent>();
  for (const ev of events) {
    if (!ev.home_team || !ev.away_team) continue;
    const home = normalizeNhlTeamName(ev.home_team);
    const away = normalizeNhlTeamName(ev.away_team);
    if (!home || !away) continue;
    const key = `${away}@${home}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, ev);
      continue;
    }
    // Prefer the event row with more populated split fields. SharpAPI
    // typically returns BOTH per-book events (bets_pct only) and a
    // "consensus" event (bets_pct + handle_pct). Score both kinds of
    // splits so the consensus event with handle data wins; an explicit
    // "consensus" sportsbook tag also breaks ties in its favor.
    const score = (e: SharpNhlSplitsEvent) =>
      Number(e.moneyline?.bets_pct?.home !== undefined) +
      Number(e.moneyline?.handle_pct?.home !== undefined) +
      Number(e.total?.bets_pct?.over !== undefined) +
      Number(e.total?.handle_pct?.over !== undefined) +
      Number(e.spread?.bets_pct?.home !== undefined) +
      Number(e.spread?.handle_pct?.home !== undefined) +
      (e.sportsbook === "consensus" ? 1 : 0);
    if (score(ev) > score(existing)) byKey.set(key, ev);
  }
  return byKey;
}

export async function buildNhlDailyEdgeAdapted(date: string): Promise<DailyEdgeResponse> {
  const season = moneyPuckSeasonStartYear(new Date());

  // Fetch SharpAPI public splits + cross-book EV opportunities for the
  // slate once. Best-effort: a missing key or upstream error doesn't
  // break the pipeline — the affected fields just come through as null.
  let splitsByMatchup = new Map<string, SharpNhlSplitsEvent>();
  let oppsByMatchup = new Map<string, SharpNhlOpportunity[]>();
  const sharpKey = process.env.SHARPAPI_KEY;
  if (sharpKey) {
    try {
      const events = await fetchSharpNhlSplits(date, sharpKey);
      splitsByMatchup = reduceSplitsByMatchup(events);
    } catch (e) {
      console.warn(`nhl daily-edge: splits fetch failed: ${(e as Error).message}`);
    }
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
  const games = (gamesData ?? []) as Array<{
    id: number;
    external_id: number;
    home_team_id: number | null;
    away_team_id: number | null;
    game_date: string;
    status: string;
    home_score: number | null;
    away_score: number | null;
  }>;

  if (games.length === 0) {
    return buildNhlDailyEdgeResponse({ date, requestedDate: date, games: [] });
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

  // For lock state, look up any existing prediction_records.
  const { data: recordsData } = await supabase
    .from("prediction_records")
    .select("game_id, locked_at")
    .eq("sport", "nhl")
    .in("game_id", games.map((g) => g.id));
  const lockedByGame = new Map<number, string | null>();
  for (const r of ((recordsData ?? []) as Array<{ game_id: number; locked_at: string | null }>)) {
    const existing = lockedByGame.get(r.game_id);
    // Prefer non-null locked_at over null when multiple rows exist for a game.
    if (existing === undefined || (existing === null && r.locked_at !== null)) {
      lockedByGame.set(r.game_id, r.locked_at);
    }
  }

  // Per-game pipeline.
  const dtos = [];
  for (const g of games) {
    const homeAbbr = g.home_team_id !== null ? teamById.get(g.home_team_id)?.abbreviation ?? "?" : "?";
    const awayAbbr = g.away_team_id !== null ? teamById.get(g.away_team_id)?.abbreviation ?? "?" : "?";
    try {
      const { snapshot } = await buildNhlFeatureSnapshot({ gameId: g.id, season });
      const model = nhlAutoModelV0(snapshot);

      // Pull lines once for ML + Total + Spread (NHL puck-line is
      // stored under market_type="spread" in our lines table, same
      // convention as NBA). Puck-line is display-only here — the
      // writer still ignores it; we fetch only to surface the real
      // market line/price alongside the model's puck-line read.
      const { data: linesData } = await supabase
        .from("lines")
        .select("market_type, sportsbook, side, line_value, odds_american")
        .eq("game_id", g.id)
        .is("player_id", null)
        .in("market_type", ["moneyline", "total", "spread"]);
      const lines = ((linesData ?? []) as Array<{
        market_type: string; sportsbook: string; side: string;
        line_value: number | null; odds_american: number | null;
      }>);

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
       * side, with line-value sign filtering for spread markets so we
       * never confuse VGK +1.5 (the natural underdog cover) with VGK
       * -1.5 (the alt "wins by 2+" line) — both arrive tagged
       * `side=home` from different books and must be filtered apart
       * by line_value sign.
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
       * For ML: line_value is always null → no sign filter.
       * For Total: line_value is the O/U number (5.5) → no sign filter.
       * For Spread: line_value carries the signed spread; pickLineSign
       *   ("+"|"-") selects the right side.
       */
      const BOOST_OUTLIER_THRESHOLD = 50; // American points
      function bestPriceFor(
        market: string,
        side: string,
        pickLineSign: "+" | "-" | null,
      ): { price: number | null; book: string | null } {
        const candidates = lines.filter((l) => {
          if (l.market_type !== market || l.side !== side) return false;
          if (l.odds_american === null) return false;
          if (market !== "spread") return true;
          if (l.line_value === null) return false;
          return pickLineSign === "+" ? l.line_value > 0 : l.line_value < 0;
        });
        if (candidates.length === 0) return { price: null, book: null };

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
        for (const c of filtered) {
          if (bestPrice === null || c.odds_american! > bestPrice) {
            bestPrice = c.odds_american!;
            bestBook = c.sportsbook;
          }
        }
        return { price: bestPrice, book: bestBook };
      }
      /**
       * Open-price for the line-move row. Honest apples-to-apples:
       * returns the first-observed price FROM THE SAME book that is
       * currently quoting the best price. If `targetBook` is null
       * (no current best), returns null. If that book has no history
       * rows, also returns null. Spread markets get the same line-
       * value sign filter as bestPriceFor.
       */
      function openPriceForSameBook(
        market: string,
        side: string,
        targetBook: string | null,
        pickLineSign: "+" | "-" | null,
      ): number | null {
        if (targetBook === null) return null;
        const row = history.find((h) => {
          if (h.market_type !== market || h.side !== side) return false;
          if (h.sportsbook !== targetBook) return false;
          if (h.odds_american === null) return false;
          if (market !== "spread") return true;
          if (h.line_value === null) return false;
          return pickLineSign === "+" ? h.line_value > 0 : h.line_value < 0;
        });
        return row?.odds_american ?? null;
      }

      const mlPickIsHome = model.moneyline.pick.startsWith(homeAbbr);
      const mlSide = mlPickIsHome ? "home" : "away";
      const mlBest = bestPriceFor("moneyline", mlSide, null);

      const totalPickIsOver = model.total.pick.startsWith("OVER");
      const totalSide = totalPickIsOver ? "over" : "under";
      const totalLineEntries = lines.filter((l) => l.market_type === "total" && l.side === totalSide);
      const totalBest = bestPriceFor("total", totalSide, null);
      const marketTotalLine = totalLineEntries.find((l) => l.line_value !== null)?.line_value ?? null;

      // Puck-line: stored under market_type="spread". The lines table
      // can carry BOTH the natural puck-line side and an alt-line
      // side under the same `side` tag, distinguished only by the
      // sign of `line_value`. Filter to the side our pick maps to.
      //
      // Model pick string is "{ABBR} -1.5" (laying points) or
      // "{ABBR} +1.5" (taking points). The line_value sign on the
      // matching row will mirror this.
      const plPickIsHome = model.puck_line.pick.startsWith(homeAbbr);
      const plSide = plPickIsHome ? "home" : "away";
      const plPickLineSign: "+" | "-" = model.puck_line.pick.includes("-1.5") ? "-" : "+";
      const plLineEntries = lines.filter((l) =>
        l.market_type === "spread"
        && l.side === plSide
        && l.line_value !== null
        && (plPickLineSign === "+" ? l.line_value > 0 : l.line_value < 0)
      );
      const plBest = bestPriceFor("spread", plSide, plPickLineSign);
      const puckLineMarketLine = plLineEntries.find((l) => l.line_value !== null)?.line_value ?? null;

      const splitsEvent = splitsByMatchup.get(`${awayAbbr}@${homeAbbr}`) ?? null;
      const oppsForGame = oppsByMatchup.get(`${awayAbbr}@${homeAbbr}`) ?? [];

      const mlOpp = findOpportunityForPick(oppsForGame, "ml", mlPickIsHome, false);
      const totalOpp = findOpportunityForPick(oppsForGame, "total", false, totalPickIsOver);
      const puckLineOpp = findOpportunityForPick(oppsForGame, "puckline", plPickIsHome, false);

      const mlBundle: NhlPerMarketBest = {
        priceAmerican: mlBest.price,
        sportsbook: mlBest.book,
        openAmerican: openPriceForSameBook("moneyline", mlSide, mlBest.book, null),
        pinnacleEvPct: mlOpp?.ev_percentage ?? null,
        fairProbability: mlOpp?.fair_probability ?? null,
      };
      const totalBundle: NhlPerMarketBest = {
        priceAmerican: totalBest.price,
        sportsbook: totalBest.book,
        openAmerican: openPriceForSameBook("total", totalSide, totalBest.book, null),
        pinnacleEvPct: totalOpp?.ev_percentage ?? null,
        fairProbability: totalOpp?.fair_probability ?? null,
      };
      const puckLineBundle: NhlPerMarketBest = {
        priceAmerican: plBest.price,
        sportsbook: plBest.book,
        openAmerican: openPriceForSameBook("spread", plSide, plBest.book, plPickLineSign),
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
