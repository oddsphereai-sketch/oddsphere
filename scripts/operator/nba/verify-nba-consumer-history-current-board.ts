/** Read-only verification of the member-only NBA consumer movement chronology. */
import { buildNbaDailyEdgePipeline } from "../../../lib/services/nba/buildNbaDailyEdgeAdapted";
import { currentDailyEdgeBoardDate } from "../../../lib/dates/slateDate";

async function main() {
  const date = process.argv[2] ?? currentDailyEdgeBoardDate("nba");
  const result = await buildNbaDailyEdgePipeline(date);

  const games = result.nbaDto.games.map((game) => ({
  externalId: game.game_external_id,
  matchup: `${game.away_abbr}@${game.home_abbr}`,
  finalScore: `${game.projection.away_score}-${game.projection.home_score}`,
  markets: (["moneyline", "spread", "total"] as const).map((market) => {
    const intel = market === "moneyline" ? game.intelligence.ml
      : market === "spread" ? game.intelligence.spread : game.intelligence.total;
    const evidence = result.memberEvidenceByGame.get(game.game_external_id)?.[market];
    return {
      market,
      pickSide: intel.pick_side,
      grade: intel.grade,
      currentBook: intel.current_price.sportsbook,
      currentLine: intel.consensus_line,
      currentPrice: intel.current_price.odds_american,
      movementBook: evidence?.movementReferenceSportsbook ?? null,
      selectedTrail: evidence?.oddsTrail.map((stop) => ({
        label: stop.label,
        book: stop.sportsbook,
        line: stop.line,
        price: stop.american,
        observedAt: stop.observedAt,
      })) ?? [],
      opposingTrail: evidence?.opposingOddsTrail?.stops.map((stop) => ({
        label: stop.label,
        book: stop.sportsbook,
        line: stop.line,
        price: stop.american,
        observedAt: stop.observedAt,
      })) ?? [],
      sharpSplitBook: evidence?.sportsbookSplits?.sourceBook ?? null,
    };
  }),
  }));

  console.log(JSON.stringify({ date, games }, null, 2));
}

void main();
