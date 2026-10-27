import { bindMarketBrainPriorInputLineage } from
  "../../lib/services/marketBrain/marketBrainContract";
import {
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_SHA256,
  readNflV1WeekOneOutcomeArtifactForecast,
} from "../../lib/services/football/nflV1WeekOneOutcome";

export const NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE = NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE;
export const NFL_MARKET_BRAIN_FIXTURE_EVENT_IDS = [
  "1392216", "1392217", "1392218", "1392219", "1392220", "1392221", "1392222", "1392223",
  "1392224", "1392225", "1392226", "1392227", "1392228", "1392229", "1392230", "1392231",
] as const;

export function fixtureMarketBrainPriorDistributions(eventId: string) {
  const forecast = readNflV1WeekOneOutcomeArtifactForecast(eventId);
  if (!forecast) throw new Error(`Missing frozen NFL fixture artifact row ${eventId}.`);
  return {
    marginDistribution: forecast.marginDistribution,
    totalDistribution: forecast.totalDistribution,
  };
}

export function fixtureMarketBrainPriorInputLineage(args: {
  eventId: string;
  asOf: string;
  marketPolicy?: "market_inputs_prohibited" | "market_inputs_present" | "unknown";
}) {
  if (!readNflV1WeekOneOutcomeArtifactForecast(args.eventId)) {
    throw new Error(`NFL Market Brain fixture event ${args.eventId} is not in the frozen artifact.`);
  }
  const marketPolicy = args.marketPolicy ?? "market_inputs_prohibited";
  return bindMarketBrainPriorInputLineage({
    eventId: args.eventId,
    modelPath: "nfl_week_one_static_artifact",
    modelRelease: NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE,
    asOf: args.asOf,
    declaredMarketInputPolicy: marketPolicy,
    components: [{
      id: "nfl_discrete_score_shape",
      category: "model_artifact",
      release: NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
      availableAt: "2026-08-23T00:00:00.000Z",
      sha256: NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_SHA256,
      marketRelation: marketPolicy === "market_inputs_prohibited"
        ? "excluded_by_construction" : marketPolicy === "market_inputs_present"
        ? "may_include_market_information" : "unknown",
    }],
  });
}
