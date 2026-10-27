import { bindMarketBrainPriorInputLineage } from
  "../../lib/services/marketBrain/marketBrainContract";
import {
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_SHA256,
} from "../../lib/services/football/nflV1WeekOneOutcome";

export const NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE = NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE;

export function fixtureMarketBrainPriorInputLineage(args: {
  eventId: string;
  asOf: string;
  marketPolicy?: "market_inputs_prohibited" | "market_inputs_present" | "unknown";
}) {
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
