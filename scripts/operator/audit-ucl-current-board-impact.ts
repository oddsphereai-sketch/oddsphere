/** Read-only same-input incumbent/candidate UCL board-impact audit. */
import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";
import { SharpApiUclMarketProvider, type UclSharpFixtureMarket } from "../../lib/providers/real_api/SharpApiUclMarketProvider";
import { buildEplDailyEdgePreview } from "../../lib/services/epl/buildEplDailyEdgePreview";
import type { EplShadowSlateMatch } from "../../lib/services/epl/buildEplShadowSlate";
import { buildUclSlate } from "../../lib/services/ucl/buildUclSlate";
import { readUclStoredPriceHistory } from "../../lib/services/ucl/uclLineHistoryStore";
import { deriveUclCoherentMarketOutcome } from "../../lib/services/ucl/uclCoherentMarketOutcome";
import { applyUclStoredQuoteFallback } from "../../lib/services/ucl/uclStoredQuoteFallback";
import { UCL_CALIBRATION_RELEASE } from "../../lib/services/ucl/uclModel";
import { deriveUclMatchResultDecision, deriveUclPreviewGrade } from "../../lib/services/ucl/uclPreviewGrade";

type MarketRow = {
  identity: string;
  pick: string | null;
  verdict: string;
  actionable: boolean;
  probability: number | null;
  price: number | null;
  locked: boolean;
};

function forecastSelector(prediction: EplShadowSlateMatch["prediction"]) {
  const side = (["home", "draw", "away"] as const).reduce(
    (best, candidate) => prediction.probabilities[candidate] > prediction.probabilities[best] ? candidate : best,
    "home",
  );
  return { release: prediction.release, side, rawSide: side, applied: false };
}

function rows(response: Awaited<ReturnType<typeof buildEplDailyEdgePreview>>): MarketRow[] {
  return response.games.flatMap((game) => ([
    ["match_result", game.markets.moneyline],
    ["double_chance", game.soccerDoubleChanceMarket],
    ["total", game.markets.total],
    ["btts", game.markets.first_inning],
  ] as const).flatMap(([market, row]) => row ? [{
    identity: `${game.external_id}:${market}`,
    pick: row.pick,
    verdict: row.verdict?.key ?? "unknown",
    actionable: row.verdict?.key === "best_angle" || row.verdict?.key === "lean",
    probability: row.modelProb ?? null,
    price: row.currentPriceAmerican ?? null,
    locked: game.lockState === "locked",
  }] : []));
}

function counts(values: MarketRow[]) {
  return values.reduce<Record<string, number>>((result, row) => {
    result[row.verdict] = (result[row.verdict] ?? 0) + 1;
    return result;
  }, {});
}

async function main() {
  const key = process.env.SHARPAPI_KEY;
  if (!key) throw new Error("SHARPAPI_KEY is required");
  const slate = await buildUclSlate();
  const storedPriceHistory = await readUclStoredPriceHistory(slate.matches.map((match) => match.id));
  const live = new SharpApiUclMarketProvider(new SharpApiClient(key));
  const captured = new Map<string, UclSharpFixtureMarket>();
  const fixtureKey = (fixture: { home: string; away: string; kickoff: string }) => `${fixture.away}@${fixture.home}:${fixture.kickoff}`;
  const captureProvider = {
    loadFixture: async (fixture: { home: string; away: string; kickoff: string }) => {
      const value = await live.loadFixture(fixture);
      captured.set(fixtureKey(fixture), value);
      return value;
    },
  };
  const replayProvider = {
    loadFixture: async (fixture: { home: string; away: string; kickoff: string }) => {
      const value = captured.get(fixtureKey(fixture));
      if (!value) throw new Error(`missing captured UCL fixture ${fixtureKey(fixture)}`);
      return value;
    },
  };
  const common = {
    storedPriceHistory,
    skipForwardEvidence: true as const,
    maxFixtureRecoveryLoads: 0,
    competitionLabel: "Champions League",
    fixtureLoadConcurrency: 1,
    finalizeFixtureMarket: (fixture: UclSharpFixtureMarket, match: EplShadowSlateMatch) => applyUclStoredQuoteFallback({
      fixture,
      providerId: match.id,
      kickoff: match.kickoff,
      history: storedPriceHistory,
    }),
  };
  const candidate = await buildEplDailyEdgePreview(slate, {
    ...common,
    marketProvider: captureProvider,
    cacheNamespace: "ucl-board-impact-candidate",
    cacheIdentity: `${slate.boardDate}:${slate.modelRelease}`,
    authorities: {
      gradeRelease: UCL_CALIBRATION_RELEASE,
      deriveCoherentOutcome: deriveUclCoherentMarketOutcome,
      deriveMatchResultDecision: deriveUclMatchResultDecision,
      derivePreviewGrade: deriveUclPreviewGrade,
      useCoherentMatchResultForecast: true,
      selectMatchResultSide: forecastSelector,
    },
  });
  const incumbent = await buildEplDailyEdgePreview(slate, {
    ...common,
    marketProvider: replayProvider,
    cacheNamespace: "ucl-board-impact-incumbent",
    cacheIdentity: `${slate.boardDate}:incumbent`,
    authorities: {
      gradeRelease: UCL_CALIBRATION_RELEASE,
      deriveCoherentOutcome: (input) => deriveUclCoherentMarketOutcome({
        ...input,
        totalVectors: [],
        bttsVectors: [],
        storedPriceHistory: [],
        modelEvidenceQuality: "standard",
      }),
      deriveMatchResultDecision: deriveUclMatchResultDecision,
      derivePreviewGrade: deriveUclPreviewGrade,
      useCoherentMatchResultForecast: true,
      selectMatchResultSide: forecastSelector,
    },
  });
  const before = rows(incumbent);
  const after = rows(candidate);
  const beforeById = new Map(before.map((row) => [row.identity, row]));
  const afterById = new Map(after.map((row) => [row.identity, row]));
  const paired = [...beforeById.keys()].flatMap((identity) => {
    const left = beforeById.get(identity)!;
    const right = afterById.get(identity);
    return right ? [{ identity, before: left, after: right }] : [];
  });
  const unlocked = paired.filter((row) => !row.before.locked && !row.after.locked);
  const locked = paired.filter((row) => row.before.locked || row.after.locked);
  const promotions = unlocked.filter((row) => !row.before.actionable && row.after.actionable);
  const demotions = unlocked.filter((row) => row.before.actionable && !row.after.actionable);
  const sideChanges = unlocked.filter((row) => row.before.pick !== row.after.pick);
  const probabilityChanges = unlocked.filter((row) => row.before.probability !== row.after.probability);
  console.log(JSON.stringify({
    mode: "read_only_zero_write_same_input",
    fixtures: slate.matches.length,
    markets: paired.length,
    releases: { candidateModel: slate.modelRelease, candidateCalibration: slate.calibrationRelease },
    capturedFixtures: captured.size,
    providerCoverage: { fixtures: captured.size, expected: slate.matches.length },
    lockedRowsExcludedFromDecisionImpact: locked.length,
    before: { counts: counts(unlocked.map((row) => row.before)), actionable: unlocked.filter((row) => row.before.actionable).length },
    after: { counts: counts(unlocked.map((row) => row.after)), actionable: unlocked.filter((row) => row.after.actionable).length },
    promotions,
    demotions,
    sideChanges,
    probabilityChanges,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
