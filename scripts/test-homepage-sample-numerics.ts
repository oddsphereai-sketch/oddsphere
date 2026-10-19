import assert from "node:assert/strict";

import {
  MARKETING_PREVIEW_BY_SPORT,
  MARKETING_PREVIEW_SPORTS,
} from "../app/lab/components/daily-edge/DailyEdgeShell";
import {
  MARKETING_SOCCER_MATCH_RESULT_PRICES,
  marketingModelGapPct,
  marketingNoVigProbability,
  marketingProjectedTotal,
} from "../app/lab/lib/marketingPreviewMath";
import type { MarketEdgeDto } from "../app/lab/lib/labTypes";

type MarketKey = "moneyline" | "total" | "first_inning";

function near(actual: number, expected: number, label: string, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not within ${tolerance} of ${expected}`);
}

function firstInningPair(market: MarketEdgeDto): { selected: number; opposing: number } {
  const board = market.fiMarketBoard;
  assert.ok(board, `${market.pick ?? "First inning"} includes a complete two-sided price board`);
  if (market.pick === "NRFI") {
    assert.notEqual(board.nrfiAmerican, null);
    assert.notEqual(board.yrfiAmerican, null);
    return { selected: board.nrfiAmerican!, opposing: board.yrfiAmerican! };
  }
  assert.equal(market.pick, "YRFI");
  assert.notEqual(board.yrfiAmerican, null);
  assert.notEqual(board.nrfiAmerican, null);
  return { selected: board.yrfiAmerican!, opposing: board.nrfiAmerican! };
}

function twoWayPair(
  sport: string,
  marketKey: MarketKey,
  market: MarketEdgeDto,
): { selected: number; opposing: number } | null {
  if (sport === "soccer" && marketKey === "moneyline") return null;
  if (sport === "mlb" && marketKey === "first_inning") return firstInningPair(market);

  assert.notEqual(market.priceAmerican, null, `${sport} ${marketKey} includes the selected current price`);
  assert.ok(market.opposingOddsTrail, `${sport} ${marketKey} includes the opposing price trail`);
  const opposingCurrent = market.opposingOddsTrail!.stops.at(-1)?.american;
  assert.notEqual(opposingCurrent, null, `${sport} ${marketKey} includes the opposing current price`);
  assert.notEqual(opposingCurrent, undefined, `${sport} ${marketKey} includes the opposing current price`);
  return { selected: market.priceAmerican!, opposing: opposingCurrent! };
}

console.log("\n━━━ homepage illustrative sample numerics ━━━\n");

assert.deepEqual(
  [...MARKETING_PREVIEW_SPORTS],
  ["nfl", "cfb", "nba", "nhl", "mlb", "soccer", "wnba"],
  "all seven preview sports remain wired in the approved order",
);

let auditedMarkets = 0;
for (const sport of MARKETING_PREVIEW_SPORTS) {
  const games = MARKETING_PREVIEW_BY_SPORT[sport].snapshot.games;
  assert.ok(games.length > 0, `${sport} includes at least one illustrative matchup`);

  for (const game of games) {
    assert.ok(game.awayTeamLogo, `${sport} ${game.awayTeam} uses a real team-logo asset`);
    assert.ok(game.homeTeamLogo, `${sport} ${game.homeTeam} uses a real team-logo asset`);
    const totalMarket = game.markets.total;
    assert.notEqual(totalMarket.modelTotal, null, `${sport} ${game.awayTeam}@${game.homeTeam} includes a model total`);
    assert.notEqual(totalMarket.marketTotal, null, `${sport} ${game.awayTeam}@${game.homeTeam} includes a market total`);

    const expectedScoringTotal = game.footballProjection
      ? marketingProjectedTotal(game.footballProjection.expectedAwayPoints, game.footballProjection.expectedHomePoints)
      : game.soccerProjection
        ? marketingProjectedTotal(game.soccerProjection.expectedGoals.away, game.soccerProjection.expectedGoals.home)
        : marketingProjectedTotal(game.projected.away, game.projected.home);
    near(expectedScoringTotal, totalMarket.modelTotal!, `${sport} ${game.awayTeam}@${game.homeTeam} score and total projection agree`);

    if (game.footballProjection) {
      assert.deepEqual(
        game.projected,
        game.footballProjection.representativeScore,
        `${sport} representative final is explicitly separate from expected scoring means`,
      );
      assert.ok(Number.isInteger(game.projected.away) && Number.isInteger(game.projected.home));
    }
    if (game.soccerProjection) {
      assert.deepEqual(
        game.projected,
        game.soccerProjection.representativeScore,
        "soccer representative score is explicitly separate from expected goals",
      );
    }
    if (!game.footballProjection && !game.soccerProjection) {
      for (const marketKey of ["moneyline", "total", "first_inning"] as const) {
        if (sport === "mlb" && marketKey === "first_inning") continue;
        const representative = game.markets[marketKey].keyStats.find((stat) => /^representative final$/i.test(stat.label));
        assert.ok(representative, `${sport} ${marketKey} supplies a representative final separately from expected scoring means`);
        const away = Number.parseFloat(representative!.awayValue ?? "");
        const home = Number.parseFloat(representative!.homeValue ?? "");
        assert.ok(Number.isInteger(away) && Number.isInteger(home), `${sport} ${marketKey} representative final uses whole-number scores`);
      }
    }

    if (sport === "wnba") {
      assert.deepEqual(game.projected, { away: 81.5, home: 77 }, "WNBA retains its decimal expected-points projection");
      const representative = game.markets.moneyline.keyStats.find((stat) => /^representative final$/i.test(stat.label));
      assert.deepEqual(
        { away: Number(representative?.awayValue), home: Number(representative?.homeValue) },
        { away: 82, home: 77 },
        "WNBA supplies a plausible whole-number representative final",
      );
    }

    const totalPick = totalMarket.pick ?? "";
    if (/^Over\b/i.test(totalPick)) {
      assert.ok(totalMarket.modelTotal! > totalMarket.marketTotal!, `${sport} Over selection follows the projected total`);
    } else if (/^Under\b/i.test(totalPick)) {
      assert.ok(totalMarket.modelTotal! < totalMarket.marketTotal!, `${sport} Under selection follows the projected total`);
    } else {
      assert.fail(`${sport} total selection is explicitly Over or Under`);
    }

    for (const marketKey of ["moneyline", "total", "first_inning"] as const) {
      const market = game.markets[marketKey];
      const label = `${sport} ${game.awayTeam}@${game.homeTeam} ${marketKey}`;
      assert.ok(market.guidedGuide.length > 0 && market.guidedWatchOut.length > 0, `${label} includes coherent explanatory copy`);
      assert.notEqual(market.modelProb, null, `${label} includes a model probability`);
      assert.notEqual(market.marketFairProb, null, `${label} includes a market probability`);

      if (sport === "mlb" && marketKey === "first_inning") {
        const projection = market.keyStats.find((stat) => /projected.*(?:first|1st).*inning/i.test(stat.label));
        const projectedRuns = Number.parseFloat(projection?.homeValue ?? projection?.awayValue ?? "");
        assert.ok(Number.isFinite(projectedRuns), `${label} includes a finite opening-inning run projection`);
        if (/^NRFI$/i.test(market.pick ?? "")) {
          assert.ok(projectedRuns < 0.85, `${label} projection supports its NRFI selection`);
        } else if (/^YRFI$/i.test(market.pick ?? "")) {
          assert.ok(projectedRuns >= 1.15, `${label} projection supports its YRFI selection`);
        } else {
          assert.fail(`${label} uses a selectable NRFI or YRFI sample`);
        }
      }

      const selectedTrail = market.oddsTrail ?? [];
      const selectedCurrent = selectedTrail.at(-1)?.american;
      assert.equal(selectedCurrent, market.priceAmerican, `${label} current trail and displayed price agree`);
      assert.equal(selectedTrail.length, 3, `${label} includes opening, prior, and current movement`);

      if (market.publicSplits.length > 0) {
        assert.ok(market.publicSplits.every((row) => row.moneyPct !== null && row.betsPct !== null));
        near(market.publicSplits.reduce((sum, row) => sum + (row.moneyPct ?? 0), 0), 100, `${label} public money splits sum to 100`);
        near(market.publicSplits.reduce((sum, row) => sum + (row.betsPct ?? 0), 0), 100, `${label} public ticket splits sum to 100`);
      }
      const sharpRows = market.recommendationDecision?.sharpBookSplits?.rows ?? [];
      if (sharpRows.length > 0) {
        assert.ok(sharpRows.every((row) => row.moneyPct !== null && row.betsPct !== null));
        near(sharpRows.reduce((sum, row) => sum + (row.moneyPct ?? 0), 0), 100, `${label} sharp money splits sum to 100`);
        near(sharpRows.reduce((sum, row) => sum + (row.betsPct ?? 0), 0), 100, `${label} sharp ticket splits sum to 100`);
      }

      if (sport === "soccer" && marketKey === "moneyline") {
        const prices = MARKETING_SOCCER_MATCH_RESULT_PRICES;
        const expectedFair = marketingNoVigProbability(prices.selected, [prices.draw, prices.away]);
        near(market.marketFairProb!, expectedFair, `${label} uses the three-way no-vig price set`);
        near(market.modelMarketGapPct!, (market.modelProb! - expectedFair) * 100, `${label} model gap follows the three-way price set`);
      } else {
        const pair = twoWayPair(sport, marketKey, market)!;
        const expectedFair = marketingNoVigProbability(pair.selected, [pair.opposing]);
        near(market.marketFairProb!, expectedFair, `${label} uses its current two-sided no-vig prices`);
        near(
          market.modelMarketGapPct!,
          marketingModelGapPct(market.modelProb!, pair.selected, [pair.opposing]),
          `${label} model gap is model probability minus no-vig market probability`,
        );
        if (sport !== "mlb" || marketKey !== "first_inning") {
          assert.equal(market.opposingOddsTrail!.stops.length, 3, `${label} includes a complete opposing movement trail`);
        }
      }

      auditedMarkets += 1;
    }
  }
  console.log(`  ✓ ${sport.toUpperCase()}: scores, selections, prices, probabilities, gaps, movement, splits, and explanations`);
}

assert.equal(auditedMarkets, 27, "all 27 displayed illustrative market controls were audited");
console.log(`\n  ✓ ${auditedMarkets} displayed market controls audited numerically`);
console.log("\nhomepage illustrative sample numerics: passed\n");
