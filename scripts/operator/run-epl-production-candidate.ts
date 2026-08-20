import { buildEplDailyEdgePreview, type EplStoredPriceObservation } from "../../lib/services/epl/buildEplDailyEdgePreview";
import { buildEplShadowSlate } from "../../lib/services/epl/buildEplShadowSlate";
import { seedEplSlate, writeEplPredictionRecords } from "../../lib/services/epl/eplProductionPipeline";
import { readFileSync } from "node:fs";

async function main() {
  const vercelConfig = readFileSync("vercel.json", "utf8");
  const scheduledInVercel = vercelConfig.includes("/api/cron/epl-daily-refresh")
    && vercelConfig.includes("/api/cron/epl-pregame-lock");
  const slate = await buildEplShadowSlate();
  let allBookPrices: EplStoredPriceObservation[] = [];
  const response = await buildEplDailyEdgePreview(slate, { captureAllBookPrices: (rows) => { allBookPrices = rows; } });
  const seed = await seedEplSlate({ slate, apply: false });
  const writer = await writeEplPredictionRecords({ slate, response, apply: false });
  const grades = writer.proposed.reduce<Record<string, number>>((counts, row) => {
    const label = row.play_grade ?? "Unavailable";
    counts[label] = (counts[label] ?? 0) + 1;
    return counts;
  }, {});
  const markets = writer.proposed.reduce<Record<string, number>>((counts, row) => {
    counts[row.market] = (counts[row.market] ?? 0) + 1;
    return counts;
  }, {});
  const gradesByMarket = writer.proposed.reduce<Record<string, Record<string, number>>>((counts, row) => {
    const label = row.play_grade ?? "Unavailable";
    counts[row.market] ??= {};
    counts[row.market][label] = (counts[row.market][label] ?? 0) + 1;
    return counts;
  }, {});
  const sidesByMarket = writer.proposed.reduce<Record<string, Record<string, number>>>((counts, row) => {
    const side = row.pick ?? "Unavailable";
    counts[row.market] ??= {};
    counts[row.market][side] = (counts[row.market][side] ?? 0) + 1;
    return counts;
  }, {});
  const priceCoverage = {
    current: writer.proposed.filter((row) => row.odds_american !== null).length,
    opening: writer.proposed.filter((row) => {
      const snapshot = row.snapshot_json as { opening_price?: number | null } | null;
      return snapshot?.opening_price !== null && snapshot?.opening_price !== undefined;
    }).length,
    total: writer.proposed.length,
    missingCurrent: writer.proposed.filter((row) => row.odds_american === null).map((row) => `${row.matchup}:${row.market}:${row.pick ?? "no-side"}`),
  };
  const allOutcomeRows = response.games.flatMap((game) => [
    ...(game.markets.moneyline.soccerPriceBoard?.rows ?? []).map((row) => ({ market: "match_result", row })),
    ...(game.soccerDoubleChanceMarket?.soccerPriceBoard?.rows ?? []).map((row) => ({ market: "double_chance", row })),
    ...(game.markets.total.soccerPriceBoard?.rows ?? []).map((row) => ({ market: "total", row })),
    ...(game.markets.first_inning.soccerPriceBoard?.rows ?? []).map((row) => ({ market: "btts", row })),
  ]);
  const allOutcomeTrailCoverage = {
    expected: response.games.length * 10,
    currentRows: allOutcomeRows.length,
    rowsWithTrail: allOutcomeRows.filter(({ row }) => (row.odds_trail?.length ?? 0) > 0).length,
    providerOpenings: allOutcomeRows.filter(({ row }) => row.odds_trail?.some((stop) => stop.source === "provider_opening")).length,
    byMarket: Object.fromEntries(["match_result", "double_chance", "total", "btts"].map((market) => {
      const rows = allOutcomeRows.filter((entry) => entry.market === market);
      return [market, { rows: rows.length, withTrail: rows.filter(({ row }) => (row.odds_trail?.length ?? 0) > 0).length }];
    })),
  };
  const allBookCapture = {
    rows: allBookPrices.length,
    books: [...new Set(allBookPrices.map((row) => row.sportsbook).filter(Boolean))].sort(),
    fixtures: new Set(allBookPrices.map((row) => row.providerId)).size,
    byMarket: Object.fromEntries(["match_result", "double_chance", "total", "btts"].map((market) => [market, allBookPrices.filter((row) => row.market === market).length])),
  };
  const splitCoverage = {
    fixturesWithMoneylineSplits: response.games.filter((game) => (game.markets.moneyline.publicSplits?.length ?? 0) > 0).length,
    fixturesWithTotalSplits: response.games.filter((game) => (game.markets.total.publicSplits?.length ?? 0) > 0).length,
    fixturesPendingOrUnavailable: response.games.filter((game) => game.status.sharpSignalPending).length,
  };
  const doubleChanceSelectionChanges = response.games.flatMap((game) => {
    const market = game.soccerDoubleChanceMarket;
    const rows = market?.soccerPriceBoard?.rows ?? [];
    const formerValueSelection = [...rows].sort((a, b) => (b.edge_pp ?? Number.NEGATIVE_INFINITY) - (a.edge_pp ?? Number.NEGATIVE_INFINITY))[0]?.label ?? null;
    if (!market || !formerValueSelection || formerValueSelection === market.pick) return [];
    return [{ matchup: `${game.awayTeam}@${game.homeTeam}`, formerValueSelection, forecastAnchoredSelection: market.pick, grade: market.verdict.label }];
  });
  const derivedForecasts = slate.matches.map((match, index) => ({
    matchup: `${match.awayTeam.abbreviation}@${match.homeTeam.abbreviation}`,
    homeGoals: Number(match.prediction.lambdaHome.toFixed(3)),
    awayGoals: Number(match.prediction.lambdaAway.toFixed(3)),
    likelyScore: `${match.prediction.likelyScore.away}-${match.prediction.likelyScore.home}`,
    likelyScoreProbability: Number(match.prediction.likelyScore.probability.toFixed(4)),
    representativeScore: match.prediction.representativeScore
      ? `${match.prediction.representativeScore.away}-${match.prediction.representativeScore.home}`
      : null,
    representativeScoreProbability: match.prediction.representativeScore
      ? Number(match.prediction.representativeScore.probability.toFixed(4))
      : null,
    medianTotal: match.prediction.medianTotal,
    mostLikelyTotal: match.prediction.mostLikelyTotal,
    expectedTotal: Number(match.prediction.expectedTotal.toFixed(3)),
    over25: Number(match.prediction.probabilities.over25.toFixed(4)),
    totalSide: match.prediction.probabilities.over25 >= 0.5 ? "Over" : "Under",
    bttsYes: Number(match.prediction.probabilities.bttsYes.toFixed(4)),
    bttsSide: match.prediction.probabilities.bttsYes >= 0.5 ? "Yes" : "No",
    displayed: {
      expectedGoals: response.games[index]?.soccerProjection?.expectedGoals ?? null,
      likelyScore: response.games[index]?.soccerProjection?.likelyScore ?? null,
      matchResult: response.games[index]?.markets.moneyline.pick ?? null,
      doubleChance: response.games[index]?.soccerDoubleChanceMarket?.pick ?? null,
      total: response.games[index]?.markets.total.pick ?? null,
      totalProbability: response.games[index]?.markets.total.modelProb ?? null,
      totalGrade: response.games[index]?.markets.total.verdict.label ?? null,
      btts: response.games[index]?.markets.first_inning.pick ?? null,
      bttsProbability: response.games[index]?.markets.first_inning.modelProb ?? null,
      bttsGrade: response.games[index]?.markets.first_inning.verdict.label ?? null,
      coherentScore: response.games[index]?.soccerProjection?.representativeScore ?? null,
    },
  }));
  const activation = {
    refreshCron: process.env.EPL_CRON_ENABLED === "true",
    lockCron: process.env.EPL_LOCK_CRON_ENABLED === "true",
    databaseWrites: process.env.EPL_DB_WRITES_ENABLED === "true",
    historicalCacheWrites: process.env.EPL_FOUNDATION_CACHE_WRITES_ENABLED === "true",
    publication: process.env.EPL_PUBLICATION_ENABLED === "true",
    settlement: process.env.EPL_PIPELINE_ENABLED === "true",
    productionReader: process.env.PREMIER_LEAGUE_DAILY_EDGE_ENABLED === "true",
    scheduledInVercel,
  };
  const criticalFindings = [
    ...(slate.matches.length !== 10 ? [`expected 10 fixtures, received ${slate.matches.length}`] : []),
    ...(seed.errors.length > 0 ? seed.errors.map((error) => `seed: ${error}`) : []),
    ...(writer.errors.length > 0 ? writer.errors.map((error) => `writer: ${error}`) : []),
    ...(priceCoverage.current !== priceCoverage.total ? [`selected-price coverage ${priceCoverage.current}/${priceCoverage.total}`] : []),
    ...(allOutcomeTrailCoverage.currentRows !== allOutcomeTrailCoverage.expected ? [`all-outcome rows ${allOutcomeTrailCoverage.currentRows}/${allOutcomeTrailCoverage.expected}`] : []),
    ...(!scheduledInVercel ? ["EPL refresh/lock routes are not scheduled"] : []),
    ...(!process.env.BALLDONTLIE_API_KEY ? ["BALLDONTLIE_API_KEY missing"] : []),
    ...(!process.env.SHARPAPI_KEY ? ["SHARPAPI_KEY missing"] : []),
  ];
  const warnings = [
    ...(priceCoverage.opening === 0 ? ["Provider-native opening rows are unavailable; the earliest verified same-book capture is the operational Opening."] : []),
    ...(splitCoverage.fixturesPendingOrUnavailable > 0 ? [`Sharp splits endpoint returned no rows for ${splitCoverage.fixturesPendingOrUnavailable}/${slate.matches.length} fixtures; display remains unavailable and does not affect grades.`] : []),
    ...(slate.providerHealth.recentXgTeamCoverage < 1 ? [`Recent xG is available for ${Math.round(slate.providerHealth.recentXgTeamCoverage * 100)}% of slate teams; real score and non-xG stat context remain visible.`] : []),
    "Total and BTTS use the released r11 chronological validation gates; no Best Angle path is enabled.",
  ];
  console.log(JSON.stringify({
    mode: "local_production_candidate_dry_run",
    competition: "english_premier_league",
    round: slate.round,
    fixtures: slate.matches.length,
    modelRelease: slate.modelRelease,
    calibrationRelease: slate.calibrationRelease,
    seed,
    predictionRecords: { proposed: writer.proposed.length, markets, grades, gradesByMarket, sidesByMarket, priceCoverage, allOutcomeTrailCoverage, allBookCapture, splitCoverage, doubleChanceSelectionChanges, lockedNow: writer.proposed.filter((row) => row.locked_at !== null).length },
    derivedForecasts,
    providerHealth: slate.providerHealth,
    readiness: { codeCandidateReady: criticalFindings.length === 0, criticalFindings, warnings },
    activation,
  }, null, 2));
  if (criticalFindings.length > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
