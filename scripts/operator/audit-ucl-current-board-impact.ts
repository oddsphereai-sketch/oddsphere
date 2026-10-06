/** Read-only same-input incumbent/candidate UCL board-impact audit. */
import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";
import { SharpApiUclMarketProvider, type UclSharpFixtureMarket } from "../../lib/providers/real_api/SharpApiUclMarketProvider";
import { buildEplDailyEdgePreview } from "../../lib/services/epl/buildEplDailyEdgePreview";
import type { EplShadowSlateMatch } from "../../lib/services/epl/buildEplShadowSlate";
import { buildUclSlate } from "../../lib/services/ucl/buildUclSlate";
import { deriveUclCoherentMarketOutcome } from "../../lib/services/ucl/uclCoherentMarketOutcome";
import { UCL_CALIBRATION_RELEASE } from "../../lib/services/ucl/uclModel";
import { deriveUclMatchResultDecision, deriveUclPreviewGrade } from "../../lib/services/ucl/uclPreviewGrade";

type MarketRow = {
  identity: string;
  pick: string | null;
  verdict: string;
  actionable: boolean;
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
  const candidate = await buildEplDailyEdgePreview(slate, {
    marketProvider: captureProvider,
    cacheNamespace: "ucl-board-impact-candidate",
    cacheIdentity: `${slate.boardDate}:${slate.modelRelease}`,
    skipForwardEvidence: true,
    maxFixtureRecoveryLoads: 0,
    competitionLabel: "Champions League",
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
    marketProvider: replayProvider,
    cacheNamespace: "ucl-board-impact-incumbent",
    cacheIdentity: `${slate.boardDate}:incumbent`,
    skipForwardEvidence: true,
    maxFixtureRecoveryLoads: 0,
    competitionLabel: "Champions League",
    authorities: {
      gradeRelease: "ucl_grade_policy_2026_09_03_r6_owner_approved_epl_v23_transfer",
      deriveCoherentOutcome: (input) => deriveUclCoherentMarketOutcome({ ...input, openingOdds: [] }),
      deriveMatchResultDecision: deriveUclMatchResultDecision,
      derivePreviewGrade: deriveUclPreviewGrade,
      useCoherentMatchResultForecast: false,
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
  const promotions = paired.filter((row) => !row.before.actionable && row.after.actionable);
  const demotions = paired.filter((row) => row.before.actionable && !row.after.actionable);
  const sideChanges = paired.filter((row) => row.before.pick !== row.after.pick);
  console.log(JSON.stringify({
    mode: "read_only_zero_write_same_input",
    fixtures: slate.matches.length,
    markets: paired.length,
    releases: { candidateModel: slate.modelRelease, candidateCalibration: slate.calibrationRelease },
    capturedFixtures: captured.size,
    before: { counts: counts(before), actionable: before.filter((row) => row.actionable).length },
    after: { counts: counts(after), actionable: after.filter((row) => row.actionable).length },
    promotions,
    demotions,
    sideChanges,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
