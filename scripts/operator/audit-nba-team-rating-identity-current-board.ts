/** Read-only incumbent-versus-complete-rating-identity NBA board audit. */

import { supabase } from "../../lib/db/supabase";
import { fetchBbrSeasonTeamRatings } from "../../lib/providers/real_api/_basketballReferenceClient";
import { buildNbaDailyEdgePipeline } from "../../lib/services/nba/buildNbaDailyEdgeAdapted";
import type { NbaTeamRatingsRow } from "../../lib/services/nba/featureSnapshot";
import {
  buildNbaTeamRatingPayload,
  matchBbrRatingToNbaTeam,
  type NbaTeamRow,
} from "../../lib/services/nba/nbaTeamRatingIdentity";

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("Pass an NBA slate date (YYYY-MM-DD).");
const compact = process.argv.includes("--compact");
const ratingSeason = Number(date.slice(0, 4)) + (Number(date.slice(5, 7)) >= 10 ? 1 : 0);

function actionable(grade: string): boolean {
  return grade === "best_angle" || grade === "lean";
}

function expectedReturn(probability: number | null, american: number | null): number | null {
  if (probability === null || american === null || american === 0) return null;
  const profit = american > 0 ? american / 100 : 100 / Math.abs(american);
  return probability * profit - (1 - probability);
}

type CompactMarket = {
  pick: string | null;
  grade: string;
  probability: number | null;
  effectiveConfidence: number;
  expectedValuePct: number | null;
  calibratedExpectedReturn: number | null;
  modelExpectedReturn: number | null;
  price: number | null;
  sportsbook: string | null;
};

type MarketChange = {
  before: CompactMarket;
  after: CompactMarket;
  sideChanged: boolean;
  promotion: boolean;
  demotion: boolean;
};

function compactGame(game: Awaited<ReturnType<typeof buildNbaDailyEdgePipeline>>["nbaDto"]["games"][number]) {
  return {
    matchup: game.matchup,
    tier: game.data_quality_tier,
    projection: game.projection,
    markets: Object.fromEntries((["ml", "spread", "total"] as const).map((slot) => {
      const row = game.intelligence[slot];
      const calibratedExpectedReturn = expectedReturn(
        row.effective_confidence / 100,
        row.current_price.odds_american,
      );
      const modelExpectedReturn = expectedReturn(
        row.model_prob_on_pick,
        row.current_price.odds_american,
      );
      return [row.market, {
        pick: row.pick_label,
        grade: row.grade,
        probability: row.model_prob_on_pick,
        effectiveConfidence: row.effective_confidence,
        expectedValuePct: row.opp_ev_percentage_pick,
        calibratedExpectedReturn,
        modelExpectedReturn,
        price: row.current_price.odds_american,
        sportsbook: row.current_price.sportsbook,
      }];
    })) as Record<string, CompactMarket>,
  };
}

async function main() {
  const [{ data: teams, error: teamError }, { data: storedRatings, error: ratingsError }, provider] = await Promise.all([
    supabase.from("teams").select("id,abbreviation").eq("sport", "nba"),
    supabase.from("nba_team_ratings")
      .select("team_id,season,season_type,off_rating,def_rating,net_rating,pace,off_efg_pct,off_tov_pct,off_orb_pct,off_ft_rate,def_efg_pct,def_tov_pct,def_drb_pct,def_ft_rate_allowed,source,source_url,fetched_at")
      .in("season", [ratingSeason - 1, ratingSeason]),
    fetchBbrSeasonTeamRatings(ratingSeason - 1),
  ]);
  if (teamError) throw teamError;
  if (ratingsError) throw ratingsError;
  if (provider.status !== "ok") throw new Error(`Prior-season BBR fetch failed: ${provider.status}`);
  const teamRows = (teams ?? []) as NbaTeamRow[];
  const recovered = provider.rows.flatMap((rating) => {
    const team = matchBbrRatingToNbaTeam(rating, teamRows);
    return team === null ? [] : [buildNbaTeamRatingPayload(rating, team, ratingSeason - 1, "regular")];
  });
  const overlayKey = (row: { team_id: number; season: number; season_type: string }) => `${row.team_id}|${row.season}|${row.season_type}`;
  const override = new Map<string, NbaTeamRatingsRow>();
  for (const row of (storedRatings ?? []) as NbaTeamRatingsRow[]) override.set(overlayKey(row), row);
  for (const row of recovered) override.set(overlayKey(row), row);

  const [incumbentResult, candidateResult] = await Promise.all([
    buildNbaDailyEdgePipeline(date),
    buildNbaDailyEdgePipeline(date, { teamRatingsOverride: [...override.values()] }),
  ]);
  const incumbent = new Map(incumbentResult.nbaDto.games.map((game) => [game.game_external_id, compactGame(game)]));
  const candidate = new Map(candidateResult.nbaDto.games.map((game) => [game.game_external_id, compactGame(game)]));
  const rows = [...candidate.entries()].map(([externalId, after]) => {
    const before = incumbent.get(externalId);
    if (!before) throw new Error(`Candidate game ${externalId} is missing from incumbent board.`);
    const marketChanges = Object.fromEntries(Object.keys(after.markets).map((market) => {
      const oldRow = before.markets[market];
      const newRow = after.markets[market];
      if (oldRow === undefined || newRow === undefined) throw new Error(`Missing ${market} comparison for ${externalId}.`);
      return [market, {
        before: oldRow,
        after: newRow,
        sideChanged: oldRow.pick !== newRow.pick,
        promotion: !actionable(oldRow.grade) && actionable(newRow.grade),
        demotion: actionable(oldRow.grade) && !actionable(newRow.grade),
      }];
    })) as Record<string, MarketChange>;
    return {
      externalId,
      matchup: after.matchup,
      tierBefore: before.tier,
      tierAfter: after.tier,
      projectionBefore: before.projection,
      projectionAfter: after.projection,
      marketChanges,
    };
  });
  const changes = rows.flatMap((row) => Object.values(row.marketChanges));
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    slateDate: date,
    providerRows: provider.rows.length,
    recoveredPriorRegularRows: recovered.length,
    games: rows.length,
    fallbackGamesBefore: rows.filter((row) => row.tierBefore === "fallback").length,
    fallbackGamesAfter: rows.filter((row) => row.tierAfter === "fallback").length,
    scoreChanges: rows.filter((row) => JSON.stringify(row.projectionBefore) !== JSON.stringify(row.projectionAfter)).length,
    sideChanges: changes.filter((row) => row.sideChanged).length,
    promotions: changes.filter((row) => row.promotion).length,
    demotions: changes.filter((row) => row.demotion).length,
    actionableBefore: rows.reduce((sum, row) => sum + Object.values(row.marketChanges).filter((market) => actionable(market.before.grade)).length, 0),
    actionableAfter: rows.reduce((sum, row) => sum + Object.values(row.marketChanges).filter((market) => actionable(market.after.grade)).length, 0),
    nonpositiveModelEvActionablesAfter: rows.reduce((sum, row) => sum + Object.values(row.marketChanges).filter((market) =>
      actionable(market.after.grade) && !(Number(market.after.modelExpectedReturn) > 0)
    ).length, 0),
    nonpositiveModelEvPromotionsAfter: rows.reduce((sum, row) => sum + Object.values(row.marketChanges).filter((market) =>
      market.promotion && !(Number(market.after.modelExpectedReturn) > 0)
    ).length, 0),
    rows,
  };
  console.log(JSON.stringify(compact ? { ...report, rows: undefined } : report, null, 2));
}

void main();
