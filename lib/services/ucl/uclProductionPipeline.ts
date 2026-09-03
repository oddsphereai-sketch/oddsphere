import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { findEplGamesEnteringLock, seedEplSlate, writeEplPredictionRecords, type ClubSoccerPipelineConfig } from "@/lib/services/epl/eplProductionPipeline";
import type { UclSlate } from "./buildUclSlate";
import { UCL_COMPETITION, UCL_EXTERNAL_ID_OFFSET, UCL_EXTERNAL_ID_UPPER_BOUND } from "./uclCompetitionContext";
import { UCL_MODEL_RELEASE } from "./uclModel";

export const UCL_LOCK_MINUTES = 60;

export function uclPipelineConfig(slate: UclSlate): ClubSoccerPipelineConfig {
  return {
    competition: UCL_COMPETITION,
    externalIdOffset: UCL_EXTERNAL_ID_OFFSET,
    externalIdUpperBound: UCL_EXTERNAL_ID_UPPER_BOUND,
    slugPrefix: "ucl",
    providerIdKey: "balldontlie_ucl",
    predictionSource: "ucl_club_model",
    lockMinutes: UCL_LOCK_MINUTES,
    contextForGame: (providerId) => slate.competitionContexts[providerId] ?? null,
  };
}

export function seedUclSlate(input: { slate: UclSlate; apply: boolean }) {
  return seedEplSlate({ ...input, config: uclPipelineConfig(input.slate) });
}

export function writeUclPredictionRecords(input: { slate: UclSlate; response: DailyEdgeResponse; apply: boolean; now?: Date }) {
  return writeEplPredictionRecords({ ...input, config: uclPipelineConfig(input.slate) });
}

export function findUclGamesEnteringLock(now = new Date()) {
  return findEplGamesEnteringLock(now, {
    modelRelease: UCL_MODEL_RELEASE,
    lockMinutes: UCL_LOCK_MINUTES,
    externalIdOffset: UCL_EXTERNAL_ID_OFFSET,
    externalIdUpperBound: UCL_EXTERNAL_ID_UPPER_BOUND,
  });
}
