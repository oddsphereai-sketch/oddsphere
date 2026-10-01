import type { NcaafGame } from "./balldontlieNcaafSlate";
import type { CfbCurrentAdvancedGame } from "./cfbCurrentAdvancedState";
import {
  CFB_V1_DIRECTIONAL_ALIGNMENT_RELEASE,
  CFB_V1_WEEKLY_BASE_ARTIFACT_RELEASE,
  CFB_V1_WEEKLY_RUNTIME_RELEASE,
  cfbV1WeeklyGameProfileCoverage,
  getCfbProfessionalScoreForecast,
  getCfbProfessionalScoreForecasts,
  getFrozenCfbV1Forecasts,
  type CfbV1WeeklyForecastResult,
  type CfbV1WeeklyProfileCoverage,
} from "./cfbProfessionalScoreRuntime";

export {
  CFB_V1_DIRECTIONAL_ALIGNMENT_RELEASE,
  CFB_V1_WEEKLY_BASE_ARTIFACT_RELEASE,
  CFB_V1_WEEKLY_RUNTIME_RELEASE,
  cfbV1WeeklyGameProfileCoverage,
  getFrozenCfbV1Forecasts,
};
export type { CfbV1WeeklyForecastResult, CfbV1WeeklyProfileCoverage };

export function getCfbV1WeeklyForecast(args: {
  game: NcaafGame;
  completedGames?: NcaafGame[];
  advancedGames?: CfbCurrentAdvancedGame[];
}): CfbV1WeeklyForecastResult {
  return getCfbProfessionalScoreForecast(args);
}

export function getCfbV1WeeklyForecasts(args: {
  games: NcaafGame[];
  completedGames?: NcaafGame[];
  advancedGames?: CfbCurrentAdvancedGame[];
}): Map<string, CfbV1WeeklyForecastResult> {
  return getCfbProfessionalScoreForecasts(args);
}
