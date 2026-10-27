import { bindMarketBrainPriorInputLineage } from
  "../../lib/services/marketBrain/marketBrainContract";
import { marketBrainSha256 } from "../../lib/services/marketBrain/marketBrainCanonical";

export function fixtureMarketBrainPriorInputLineage(args: {
  eventId: string;
  asOf: string;
  modelRelease?: string;
  marketPolicy?: "market_inputs_prohibited" | "market_inputs_present" | "unknown";
}) {
  const marketPolicy = args.marketPolicy ?? "market_inputs_prohibited";
  return bindMarketBrainPriorInputLineage({
    eventId: args.eventId,
    modelPath: "fixture",
    modelRelease: args.modelRelease ?? "fixture-independent-prior-r1",
    asOf: args.asOf,
    declaredMarketInputPolicy: marketPolicy,
    components: [{
      id: "fixture_model_input",
      category: "model_artifact",
      release: "fixture_model_input_r1",
      availableAt: args.asOf,
      sha256: marketBrainSha256({ eventId: args.eventId, asOf: args.asOf, fixture: true }),
      marketRelation: marketPolicy === "market_inputs_prohibited"
        ? "excluded_by_construction" : marketPolicy === "market_inputs_present"
        ? "may_include_market_information" : "unknown",
    }],
  });
}
