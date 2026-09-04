import type { DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import { SharpApiClient } from "@/lib/providers/real_api/_sharpApiClient";
import { SharpApiUclMarketProvider } from "@/lib/providers/real_api/SharpApiUclMarketProvider";
import {
  buildEplDailyEdgePreview,
  hydrateEplPriceHistory,
  hydrateEplStoredPriceHistory,
  type EplPreviewBuildOptions,
  type EplStoredPriceObservation,
} from "@/lib/services/epl/buildEplDailyEdgePreview";
import { UCL_COMPETITION } from "./uclCompetitionContext";
import { UCL_CALIBRATION_RELEASE } from "./uclModel";
import type { UclSlate } from "./buildUclSlate";
import { deriveUclCoherentMarketOutcome, UCL_COHERENT_MARKET_OUTCOME_RELEASE } from "./uclCoherentMarketOutcome";
import { deriveUclMatchResultDecision, deriveUclPreviewGrade } from "./uclPreviewGrade";
import { uclTeamAsset, uclTeamLogo } from "./uclTeamAssets";

export { hydrateEplPriceHistory as hydrateUclPriceHistory, hydrateEplStoredPriceHistory as hydrateUclStoredPriceHistory };
export type UclStoredPriceObservation = EplStoredPriceObservation;

export type UclPreviewBuildOptions = Pick<EplPreviewBuildOptions, "captureAllBookPrices" | "storedPriceHistory">;

function marketContext(market: MarketEdgeDto): MarketEdgeDto {
  return {
    ...market,
    reviewFlags: [...market.reviewFlags.filter((flag) => !flag.startsWith("epl_")), UCL_CALIBRATION_RELEASE],
    soccerGradeContext: market.soccerGradeContext ? {
      ...market.soccerGradeContext,
      calibration_label: "UCL-owned EPL v23 grade transfer · exact-price EV required",
    } : market.soccerGradeContext,
  };
}

function stageLabel(stage: string, leg: 1 | 2 | null): string {
  const stageText = stage.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return leg ? `${stageText} · Leg ${leg}` : stageText;
}

export async function buildUclDailyEdgePreview(slate: UclSlate, options: UclPreviewBuildOptions = {}): Promise<DailyEdgeResponse> {
  const key = process.env.SHARPAPI_KEY;
  const provider = key ? new SharpApiUclMarketProvider(new SharpApiClient(key)) : null;
  const base = await buildEplDailyEdgePreview(slate, {
    ...options,
    marketProvider: provider,
    cacheNamespace: "ucl",
    cacheIdentity: `${slate.boardDate}:${slate.matches.map((match) => `${match.id}@${match.kickoff}`).join(",")}`,
    skipForwardEvidence: true,
    maxFixtureRecoveryLoads: 0,
    competitionLabel: "Champions League",
    authorities: {
      gradeRelease: UCL_CALIBRATION_RELEASE,
      deriveCoherentOutcome: deriveUclCoherentMarketOutcome,
      deriveMatchResultDecision: deriveUclMatchResultDecision,
      derivePreviewGrade: deriveUclPreviewGrade,
    },
  });
  const matchById = new Map(slate.matches.map((match) => [match.id, match]));
  return {
    ...base,
    date: slate.boardDate,
    requested_date: slate.boardDate,
    games: base.games.map((game) => {
      const match = matchById.get(Number(game.external_id));
      const awayAsset = uclTeamAsset(game.awayTeam);
      const homeAsset = uclTeamAsset(game.homeTeam);
      const context = slate.competitionContexts[Number(game.external_id)];
      const aggregate = context?.aggregateBefore;
      const stage = context ? stageLabel(context.stage, context.leg) : "Stage pending";
      const stageRow = { label: "Competition context", awayValue: aggregate ? `${aggregate.away} aggregate` : null, homeValue: aggregate ? `${aggregate.home} aggregate` : stage, source: "feature_snapshot" as const };
      return {
        ...game,
        id: `soccer-ucl-${game.external_id}`,
        awayTeamDisplayName: match?.awayTeam.name ?? awayAsset?.displayName ?? null,
        homeTeamDisplayName: match?.homeTeam.name ?? homeAsset?.displayName ?? null,
        awayTeamLogo: uclTeamLogo(game.awayTeam),
        awayTeamPrimaryColor: awayAsset?.primaryColor ?? null,
        homeTeamLogo: uclTeamLogo(game.homeTeam),
        homeTeamPrimaryColor: homeAsset?.primaryColor ?? null,
        holdReason: null,
        markets: {
          moneyline: { ...marketContext(game.markets.moneyline), keyStats: [...game.markets.moneyline.keyStats, stageRow] },
          total: marketContext(game.markets.total),
          first_inning: marketContext(game.markets.first_inning),
        },
        soccerDoubleChanceMarket: game.soccerDoubleChanceMarket ? marketContext(game.soccerDoubleChanceMarket) : null,
        soccerCompetitionContext: context ? {
          competition: UCL_COMPETITION,
          stage: context.stage,
          leg: context.leg,
          aggregateBefore: aggregate ? { away: aggregate.away, home: aggregate.home } : null,
          neutralVenue: context.neutralVenue,
          regulationTime: true,
          advancementMarket: false,
          provenance: context.release,
        } : null,
        soccerModelProvenance: game.soccerModelProvenance ? {
          ...game.soccerModelProvenance,
          coherentOutcomeRelease: UCL_COHERENT_MARKET_OUTCOME_RELEASE,
          regulationTime: true,
        } : null,
        breakdown: {
          ...game.breakdown,
          modelBreakdown: `Cross-league UCL club-strength Dixon–Coles model trained only on regulation results available before kickoff. Release ${slate.modelRelease}.`,
        },
      };
    }),
  };
}
