/** Trusted future source-unit annotation, separate from factual admission. */
import {PROPS_AI_READER_CLAIMS_RELEASE} from './releases';

export const NBA_READER_PACE_UNIT='nba_point_in_time_possessions_per_game' as const;
export const NBA_READER_UNIT_CONTRACT={release:PROPS_AI_READER_CLAIMS_RELEASE,metric:'game_pace_mean_5',unit:NBA_READER_PACE_UNIT,currentReference:'league_current_season_pace',priorReference:'league_prior_season_pace'} as const;
