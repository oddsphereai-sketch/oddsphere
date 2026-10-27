import {
  NFL_EXACT_PROVIDER_SCORE_ARTIFACT_RELEASE,
  NFL_EXACT_PROVIDER_SCORE_ARTIFACT_SHA256,
  NFL_EXACT_PROVIDER_SCORE_CONTEXT_RELEASE,
  NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE,
} from "../football/nflExactProviderScoreRuntime";
import { NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE } from
  "../football/nflPlayerPropsCurrentSeasonState";
import {
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_SHA256,
} from "../football/nflV1WeekOneOutcome";
import {
  assertMarketBrainPriorInputLineageQualified,
  type MarketBrainPrior,
  type MarketBrainPriorInputComponent,
  type MarketBrainPriorInputLineage,
} from "./marketBrainContract";

export const NFL_MARKET_BRAIN_PRIOR_ATTESTATION_RELEASE =
  "nfl_market_brain_prior_attestation_2026_10_27_r1_registered_component_manifests" as const;

type ComponentRequirement = {
  category: MarketBrainPriorInputComponent["category"];
  release: string;
  sha256?: string;
};

const STATIC_COMPONENTS: Readonly<Record<string, ComponentRequirement>> = Object.freeze({
  nfl_discrete_score_shape: Object.freeze({
    category: "model_artifact",
    release: NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
    sha256: NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_SHA256,
  }),
});

const EXACT_PROVIDER_COMPONENTS: Readonly<Record<string, ComponentRequirement>> = Object.freeze({
  ...STATIC_COMPONENTS,
  nfl_exact_provider_model_artifact: Object.freeze({
    category: "model_artifact",
    release: NFL_EXACT_PROVIDER_SCORE_ARTIFACT_RELEASE,
    sha256: NFL_EXACT_PROVIDER_SCORE_ARTIFACT_SHA256,
  }),
  nfl_completed_game_state: Object.freeze({
    category: "team_statistics",
    release: NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
  }),
  nfl_pregame_schedule_venue_context: Object.freeze({
    category: "venue_context",
    release: NFL_EXACT_PROVIDER_SCORE_CONTEXT_RELEASE,
  }),
});

/**
 * NFL executable gate. Generic lineage self-consistency is not enough: the
 * path, release, component identities, categories, releases, and frozen bytes
 * must match this versioned registry.
 */
export function assertNflMarketBrainPriorInputLineageQualified(prior: MarketBrainPrior): void {
  assertMarketBrainPriorInputLineageQualified(prior);
  if (prior.kind !== "margin_total_distribution") return;
  const lineage = prior.artifact.inputLineage;
  if (lineage.modelRelease !== prior.release ||
    lineage.declaredMarketInputPolicy !== "market_inputs_prohibited") {
    throw new Error("NFL Market Brain prior lineage is not bound to its registered model release.");
  }
  if (lineage.modelPath === "nfl_exact_provider") {
    if (prior.release !== NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE) {
      throw new Error("NFL Market Brain exact-provider prior release is not registered.");
    }
    assertRegisteredComponents(lineage, EXACT_PROVIDER_COMPONENTS);
    return;
  }
  if (lineage.modelPath === "nfl_week_one_static_artifact") {
    if (prior.release !== NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE) {
      throw new Error("NFL Market Brain static prior release is not registered.");
    }
    assertRegisteredComponents(lineage, STATIC_COMPONENTS);
    return;
  }
  throw new Error(`NFL Market Brain prior model path is not executable: ${lineage.modelPath}`);
}

function assertRegisteredComponents(
  lineage: MarketBrainPriorInputLineage,
  requirements: Readonly<Record<string, ComponentRequirement>>,
): void {
  const expectedIds = Object.keys(requirements).sort();
  const actualIds = lineage.components.map((component) => component.id);
  if (actualIds.length !== expectedIds.length ||
    actualIds.some((id, index) => id !== expectedIds[index])) {
    throw new Error("NFL Market Brain prior component manifest is not registered.");
  }
  for (const component of lineage.components) {
    const requirement = requirements[component.id];
    if (!requirement || component.category !== requirement.category ||
      component.release !== requirement.release ||
      component.marketRelation !== "excluded_by_construction" ||
      (requirement.sha256 !== undefined && component.sha256 !== requirement.sha256)) {
      throw new Error(`NFL Market Brain prior component attestation failed: ${component.id}`);
    }
  }
}
